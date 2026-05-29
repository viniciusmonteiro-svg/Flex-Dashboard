import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { CLASSIFICATION_JOINS, CHANNEL_EXPR } from '@/lib/classifyVendor';
import { buildPeriodExpr } from '@/lib/periodExpr';

export interface KpiSummaryCohortRow {
  metric:  string;
  values:  (number | null)[];
  avg:     number | null;
  format:  'integer' | 'currency' | 'ratio';
}

export interface KpiSummaryCohortResponse {
  periods:          string[];
  period_avg_label: string;
  rows:             KpiSummaryCohortRow[];
}

// ─── Helpers (mirrors kpi-summary route) ──────────────────────────────────────

function periodGroupExpr(view: string, colExpr: string): string {
  if (view === 'yearly') {
    return `LEFT((${colExpr}), 4)`;
  }
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

function rowAvg(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function ratioOfTotals(nums: (number | null)[], dens: (number | null)[]): number | null {
  let n = 0, d = 0;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== null && dens[i] !== null) { n += nums[i]!; d += dens[i]!; }
  }
  return d === 0 ? null : n / d;
}

const EXCLUDED = `('Do Not Tag (COGS/Non-S&M)', 'Unclassified')`;

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
    const sfGroupExpr = periodGroupExpr(view, 'created_month');

    // Snap the NetSuite window to full period boundaries
    function snapFrom(mk: string): string {
      if (view === 'yearly')    return `${mk.slice(0, 4)}-01`;
      if (view === 'quarterly') {
        const m = Number(mk.slice(5, 7));
        return `${mk.slice(0, 4)}-${String((Math.ceil(m / 3) - 1) * 3 + 1).padStart(2, '0')}`;
      }
      return mk;
    }
    function snapTo(mk: string): string {
      if (view === 'yearly')    return `${mk.slice(0, 4)}-12`;
      if (view === 'quarterly') {
        const m = Number(mk.slice(5, 7));
        return `${mk.slice(0, 4)}-${String(Math.ceil(m / 3) * 3).padStart(2, '0')}`;
      }
      return mk;
    }
    const nsFrom = from ? snapFrom(from) : null;
    const nsTo   = to   ? snapTo(to)     : null;

    // ── NS S&M Spend (channeled, matching kpi-summary) ───────────────────────
    const nsParams: unknown[] = [];
    const nsConds: string[]   = [`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`];
    if (nsFrom) { nsParams.push(nsFrom); nsConds.push(`${NS_RAW} >= $${nsParams.length}`); }
    if (nsTo)   { nsParams.push(nsTo);   nsConds.push(`${NS_RAW} <= $${nsParams.length}`); }

    const nsRows = await query<{ period_key: string; spend: string }>(
      `SELECT
         ${nsGroupExpr}       AS period_key,
         SUM(n.amount) / 100  AS spend
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       WHERE ${nsConds.join(' AND ')}
       GROUP BY ${nsGroupExpr}
       ORDER BY MIN(${NS_RAW})`,
      nsParams,
    );

    // ── SF Cohort metrics — channeled Closed Won (matching Pipeline/Channel Cohort tabs) ──
    // Groups by created_month so a Q1 deal that closes in Q3 is attributed to Q1.
    // Excludes Unclassified (no primary_channel) — same filter used by both the
    // "Pipeline Cohort" tab (/api/salesforce/channels) and the "Channel Cohort" CAC
    // tables (/api/channel-costs/cac), ensuring the numbers here match those tabs exactly.
    const CHANNELED = `COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')`;
    const sfRows = await query<{ period_key: string; won: string; arr: string }>(
      `SELECT
         ${sfGroupExpr}  AS period_key,
         COUNT(*) FILTER (WHERE stage = 'Closed Won')                                  AS won,
         COALESCE(SUM(monthly_mrr) FILTER (WHERE stage = 'Closed Won'), 0) * 12 / 100 AS arr
       FROM salesforce_opportunities
       WHERE created_month IS NOT NULL AND created_month != ''
         AND ${CHANNELED}
         AND ($1::text IS NULL OR created_month >= $1)
         AND ($2::text IS NULL OR created_month <= $2)
       GROUP BY ${sfGroupExpr}
       ORDER BY MIN(created_month) NULLS LAST`,
      [from, to],
    );

    // ── Merge periods (sorted union) ──────────────────────────────────────────
    const allPeriods = [
      ...new Set([
        ...nsRows.map((r) => r.period_key),
        ...sfRows.map((r) => r.period_key),
      ]),
    ].sort();

    const nsMap = new Map(nsRows.map((r) => [r.period_key, Number(r.spend)]));
    const sfMap = new Map(sfRows.map((r) => [r.period_key, { won: Number(r.won), arr: Number(r.arr) }]));

    const spendVals: (number | null)[] = allPeriods.map((p) => nsMap.get(p) ?? null);
    const wonVals:   (number | null)[] = allPeriods.map((p) => sfMap.get(p)?.won ?? null);
    const arrVals:   (number | null)[] = allPeriods.map((p) => sfMap.get(p)?.arr ?? null);

    // Cohort Portfolio CAC = spend / won
    const cacVals: (number | null)[] = allPeriods.map((_, i) => {
      const s = spendVals[i];
      const w = wonVals[i];
      if (s === null || w === null || w === 0) return null;
      return s / w;
    });

    // Cohort Portfolio ARR : CAC = arr / spend
    const arrCacVals: (number | null)[] = allPeriods.map((_, i) => {
      const a = arrVals[i];
      const s = spendVals[i];
      if (a === null || s === null || s === 0) return null;
      return a / s;
    });

    const n = allPeriods.length;
    const period_avg_label =
      view === 'yearly'    ? `${n}Y / Avg` :
      view === 'quarterly' ? `${n}Q / Avg` :
                             `${n}M / Avg`;

    const rows: KpiSummaryCohortRow[] = [
      { metric: 'Cohort Won Deals (to-date)',  values: wonVals,    avg: rowAvg(wonVals),                     format: 'integer'  },
      { metric: 'Cohort Won ARR ($, to-date)', values: arrVals,    avg: rowAvg(arrVals),                     format: 'currency' },
      { metric: 'Cohort Portfolio CAC',        values: cacVals,    avg: ratioOfTotals(spendVals, wonVals),   format: 'currency' },
      { metric: 'Cohort Portfolio ARR : CAC',  values: arrCacVals, avg: ratioOfTotals(arrVals, spendVals),   format: 'ratio'    },
    ];

    return NextResponse.json({
      periods: allPeriods.map((p) => periodToLabel(p, view)),
      period_avg_label,
      rows,
    } satisfies KpiSummaryCohortResponse);
  } catch (err) {
    console.error('[api/dashboard/kpi-summary-cohort]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
