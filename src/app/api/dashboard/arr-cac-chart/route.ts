import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { buildPeriodExpr } from '@/lib/periodExpr';

export interface ArrCacRow {
  period:        string;        // display label e.g. "Q1 '25"
  won:           number;
  arr:           number;
  all_in_spend:  number;
  arr_cac_ratio: number | null;
}

export interface ArrCacResponse {
  rows: ArrCacRow[];
}

// ─── Helpers (mirrors kpi-summary/route.ts) ───────────────────────────────────

function periodGroupExpr(view: string, colExpr: string): string {
  if (view === 'yearly')    return `LEFT((${colExpr}), 4)`;
  if (view === 'quarterly') {
    return `LEFT((${colExpr}), 4) || '-Q' || CEIL(CAST(SPLIT_PART((${colExpr}), '-', 2) AS int) / 3.0)::int::text`;
  }
  return `LEFT((${colExpr}), 7)`; // monthly
}

function periodToLabel(key: string, view: string): string {
  if (view === 'yearly') return key;
  if (view === 'quarterly') {
    const [year, q] = key.split('-');
    return `${q} ${year}`;
  }
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function snapFrom(mk: string, view: string): string {
  if (view === 'yearly')    return `${mk.slice(0, 4)}-01`;
  if (view === 'quarterly') {
    const m = Number(mk.slice(5, 7));
    return `${mk.slice(0, 4)}-${String((Math.ceil(m / 3) - 1) * 3 + 1).padStart(2, '0')}`;
  }
  return mk;
}

function snapTo(mk: string, view: string): string {
  if (view === 'yearly')    return `${mk.slice(0, 4)}-12`;
  if (view === 'quarterly') {
    const m = Number(mk.slice(5, 7));
    return `${mk.slice(0, 4)}-${String(Math.ceil(m / 3) * 3).padStart(2, '0')}`;
  }
  return mk;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const view       = searchParams.get('view')        ?? 'quarterly';
    const from       = searchParams.get('from')        || null;
    const to         = searchParams.get('to')          || null;
    const periodType = searchParams.get('period_type') ?? 'transaction';

    const NS_RAW      = buildPeriodExpr(periodType);
    const nsGroupExpr = periodGroupExpr(view, NS_RAW);
    // SF groups by close_date — cast to YYYY-MM text so sortable keys match NS keys.
    const SF_RAW      = `TO_CHAR(close_date, 'YYYY-MM')`;
    const sfGroupExpr = periodGroupExpr(view, SF_RAW);

    // Snap NS window to full period boundaries so quarterly/yearly totals aren't clipped
    const nsFrom = from ? snapFrom(from, view) : null;
    const nsTo   = to   ? snapTo(to, view)     : null;

    // ── NetSuite: All-in S&M spend (rows 60xxx–70xxx, no channel exclusions) ──
    const nsParams: unknown[] = [];
    const nsConds: string[]   = [`n.financial_row ~ '^(6|7)'`];
    if (nsFrom) { nsParams.push(nsFrom); nsConds.push(`${NS_RAW} >= $${nsParams.length}`); }
    if (nsTo)   { nsParams.push(nsTo);   nsConds.push(`${NS_RAW} <= $${nsParams.length}`); }

    const nsRows = await query<{ period_key: string; all_in_spend: string }>(
      `SELECT
         ${nsGroupExpr}      AS period_key,
         SUM(n.amount) / 100 AS all_in_spend
       FROM netsuite_actuals n
       WHERE ${nsConds.join(' AND ')}
       GROUP BY ${nsGroupExpr}
       ORDER BY MIN(${NS_RAW})`,
      nsParams,
    );

    // ── Salesforce: Closed Won deals + ARR (grouped by close_date period) ──────
    // Matches "Channel – Close Date" subtab: deals attributed to the period they closed.
    const sfRows = await query<{ period_key: string; won: string; arr: string }>(
      `SELECT
         ${sfGroupExpr}  AS period_key,
         COUNT(*)                                                               AS won,
         COALESCE(SUM(monthly_mrr), 0) * 12 / 100                             AS arr
       FROM salesforce_opportunities
       WHERE stage = 'Closed Won'
         AND close_date IS NOT NULL
         AND COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')
         AND ($1::text IS NULL OR ${SF_RAW} >= $1)
         AND ($2::text IS NULL OR ${SF_RAW} <= $2)
       GROUP BY ${sfGroupExpr}
       ORDER BY MIN(close_date) NULLS LAST`,
      [from, to],
    );

    // ── Merge periods & compute ratio ─────────────────────────────────────────
    const allPeriods = [
      ...new Set([
        ...nsRows.map((r) => r.period_key),
        ...sfRows.map((r) => r.period_key),
      ]),
    ].sort();

    const nsMap = new Map(nsRows.map((r) => [r.period_key, Number(r.all_in_spend)]));
    const sfMap = new Map(sfRows.map((r) => [
      r.period_key,
      { won: Number(r.won), arr: Number(r.arr) },
    ]));

    const rows: ArrCacRow[] = allPeriods.map((key) => {
      const all_in_spend = nsMap.get(key) ?? 0;
      const sf = sfMap.get(key) ?? { won: 0, arr: 0 };
      const arr_cac_ratio =
        sf.arr > 0 && all_in_spend > 0
          ? Math.round((sf.arr / all_in_spend) * 100) / 100
          : null;
      return {
        period:  periodToLabel(key, view),
        won:     sf.won,
        arr:     sf.arr,
        all_in_spend,
        arr_cac_ratio,
      };
    });

    return NextResponse.json({ rows } satisfies ArrCacResponse);
  } catch (err) {
    console.error('[api/dashboard/arr-cac-chart]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
