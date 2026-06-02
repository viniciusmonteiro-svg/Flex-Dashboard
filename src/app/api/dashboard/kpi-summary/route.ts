import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { CLASSIFICATION_JOINS, CHANNEL_EXPR } from '@/lib/classifyVendor';
import { buildPeriodExpr } from '@/lib/periodExpr';
import { buildIntercompanyJoin, INTERCOMPANY_AMOUNT_EXPR } from '@/lib/channelCostQuery';

export interface KpiSummaryRow {
  metric:      string;
  values:      (number | null)[];
  avg:         number | null;
  is_currency: boolean;
}

export interface KpiSummaryResponse {
  periods:          string[];   // display labels e.g. "Q1 2025", "Jan '25", "2025"
  period_avg_label: string;     // e.g. "5Q / Avg"
  rows:             KpiSummaryRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SQL expression that groups a YYYY-MM column into a sortable period key.
 * Keys are sortable lexicographically:
 *   monthly   → "2025-01" … "2025-12"
 *   quarterly → "2025-Q1" … "2025-Q4"
 *   yearly    → "2025"
 */
function periodGroupExpr(view: string, colExpr: string): string {
  if (view === 'yearly') {
    return `LEFT((${colExpr}), 4)`;
  }
  if (view === 'quarterly') {
    return `LEFT((${colExpr}), 4) || '-Q' || CEIL(CAST(SPLIT_PART((${colExpr}), '-', 2) AS int) / 3.0)::int::text`;
  }
  return `LEFT((${colExpr}), 7)`; // monthly
}

/** Convert a sortable period key to a human-readable display label. */
function periodToLabel(key: string, view: string): string {
  if (view === 'yearly') return key; // "2025"
  if (view === 'quarterly') {
    // "2025-Q4" → "Q4 2025"
    const [year, q] = key.split('-');
    return `${q} ${year}`;
  }
  // monthly: "2025-01" → "Jan '25"
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function rowAvg(vals: (number | null)[]): number | null {
  const nums = vals.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * TypeScript mirror of the SQL periodGroupExpr function.
 * Converts a YYYY-MM month key to the same sortable period key the SQL produces,
 * so department_adjustments (stored as month_key) can be bucketed correctly.
 */
function monthKeyToPeriodKey(mk: string, view: string): string {
  if (view === 'yearly')    return mk.slice(0, 4);                                    // "2025"
  if (view === 'quarterly') return `${mk.slice(0, 4)}-Q${Math.ceil(parseInt(mk.slice(5, 7), 10) / 3)}`; // "2025-Q3"
  return mk.slice(0, 7);                                                               // "2025-07"
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
    // period_type controls how NS costs are bucketed and filtered.
    // Default: 'transaction' — matches Channel Economics tab default so both tabs
    // show the same spend numbers when set to the same date range.
    const periodType = searchParams.get('period_type') ?? 'transaction';

    const NS_RAW         = buildPeriodExpr(periodType);
    const nsGroupExpr    = periodGroupExpr(view, NS_RAW);
    // Opportunities (Pipeline Cohort) — grouped by created_month, matching Pipeline tab.
    const sfOppsGroupExpr = periodGroupExpr(view, 'created_month');
    // Closed Won metrics — grouped by close_date so wins land in the period they closed.
    // Cast close_date → 'YYYY-MM' text so periodGroupExpr produces the same sortable
    // keys as NS (e.g. "2025-Q1") and all period sets merge cleanly.
    const SF_RAW         = `TO_CHAR(close_date, 'YYYY-MM')`;
    const sfWonGroupExpr = periodGroupExpr(view, SF_RAW);

    // Snap the NetSuite window to full period boundaries so that Q4 (or a full
    // year) is never partially clipped by the SF-derived from/to values.
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

    // ── ROW 1: S&M Spend (NetSuite, period_type-aware) ───────────────────────
    const nsParams: unknown[] = [];
    const nsConds: string[]   = [`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`];
    if (nsFrom) { nsParams.push(nsFrom); nsConds.push(`${NS_RAW} >= $${nsParams.length}`); }
    if (nsTo)   { nsParams.push(nsTo);   nsConds.push(`${NS_RAW} <= $${nsParams.length}`); }

    const nsRows = await query<{ period_key: string; spend: string }>(
      `SELECT
         ${nsGroupExpr}                           AS period_key,
         SUM(${INTERCOMPANY_AMOUNT_EXPR}) / 100   AS spend
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       ${buildIntercompanyJoin(NS_RAW)}
       WHERE ${nsConds.join(' AND ')}
       GROUP BY ${nsGroupExpr}
       ORDER BY MIN(${NS_RAW})`,
      nsParams,
    );

    // ── ALL-IN S&M Spend (transaction date, financial rows 60xxx–70xxx, no channel filter) ──
    const ALLIN_RAW      = `COALESCE(TO_CHAR(n.transaction_date, 'YYYY-MM'), n.month_key)`;
    const allInGroupExpr = periodGroupExpr(view, ALLIN_RAW);
    const allInParams: unknown[] = [];
    const allInConds: string[]   = [`n.financial_row ~ '^(6|7)'`];
    if (nsFrom) { allInParams.push(nsFrom); allInConds.push(`${ALLIN_RAW} >= $${allInParams.length}`); }
    if (nsTo)   { allInParams.push(nsTo);   allInConds.push(`${ALLIN_RAW} <= $${allInParams.length}`); }

    const allInRows = await query<{ period_key: string; spend: string }>(
      `SELECT
         ${allInGroupExpr}    AS period_key,
         SUM(n.amount) / 100  AS spend
       FROM netsuite_actuals n
       WHERE ${allInConds.join(' AND ')}
       GROUP BY ${allInGroupExpr}
       ORDER BY MIN(${ALLIN_RAW})`,
      allInParams,
    );

    const CHANNELED = `COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')`;

    // ── SF query A: Total Opportunities — Pipeline Cohort (created_month) ────
    // Matches Pipeline tab: channeled opps grouped by the month the opp was created.
    // Used for "Total Opportunities (count)" display row and $/Opp denominator.
    const sfOppsRows = await query<{ period_key: string; opps: string }>(
      `SELECT
         ${sfOppsGroupExpr}  AS period_key,
         COUNT(*) FILTER (WHERE ${CHANNELED})  AS opps
       FROM salesforce_opportunities
       WHERE created_month IS NOT NULL AND created_month != ''
         AND ($1::text IS NULL OR created_month >= $1)
         AND ($2::text IS NULL OR created_month <= $2)
       GROUP BY ${sfOppsGroupExpr}
       ORDER BY MIN(created_month) NULLS LAST`,
      [from, to],
    );

    // ── SF query B: Closed Won metrics — Same Quarter View (close_date) ──────
    // Channeled Closed Won deals grouped by the month the deal closed.
    // Rows:
    //   won           — channeled Closed Won count by close_date (CAC denominator)
    //   arr           — channeled Closed Won ARR by close_date (MRR×12)
    //   won_channeled — same as won; hidden row used for Portfolio CAC denominator
    const sfWonRows = await query<{ period_key: string; won: string; arr: string; won_channeled: string }>(
      `SELECT
         ${sfWonGroupExpr}  AS period_key,
         COUNT(*) FILTER (WHERE stage = 'Closed Won' AND ${CHANNELED})               AS won,
         COALESCE(SUM(monthly_mrr) FILTER (WHERE stage = 'Closed Won' AND ${CHANNELED}), 0) * 12 / 100
                                                                                      AS arr,
         COUNT(*) FILTER (WHERE stage = 'Closed Won' AND ${CHANNELED})               AS won_channeled
       FROM salesforce_opportunities
       WHERE close_date IS NOT NULL
         AND ($1::text IS NULL OR ${SF_RAW} >= $1)
         AND ($2::text IS NULL OR ${SF_RAW} <= $2)
       GROUP BY ${sfWonGroupExpr}
       ORDER BY MIN(close_date) NULLS LAST`,
      [from, to],
    );

    // ── Merge periods (sorted union of all result sets) ──────────────────────
    const allPeriods = [
      ...new Set([
        ...nsRows.map((r) => r.period_key),
        ...allInRows.map((r) => r.period_key),
        ...sfOppsRows.map((r) => r.period_key),
        ...sfWonRows.map((r) => r.period_key),
      ]),
    ].sort();

    const nsMap    = new Map(nsRows.map((r) => [r.period_key, Number(r.spend)]));

    // ── Department adjustments — apply to S&M spend per period ───────────────
    // Fetch month-specific adjustments within the NS date range, convert each
    // YYYY-MM month_key to the same period bucket the SQL uses, and add to nsMap
    // so spendVals (built below) automatically reflects all adjustments.
    {
      const adjParams: unknown[] = [];
      const adjConds: string[]   = ['month_key IS NOT NULL'];
      if (nsFrom) { adjParams.push(nsFrom); adjConds.push(`month_key >= $${adjParams.length}`); }
      if (nsTo)   { adjParams.push(nsTo);   adjConds.push(`month_key <= $${adjParams.length}`); }

      const adjRows = await query<{ month_key: string; amount: string }>(
        `SELECT month_key, SUM(amount) / 100.0 AS amount
         FROM department_adjustments
         WHERE ${adjConds.join(' AND ')}
         GROUP BY month_key
         HAVING SUM(amount) != 0`,
        adjParams,
      );

      for (const adj of adjRows) {
        const pk  = monthKeyToPeriodKey(adj.month_key, view);
        const cur = nsMap.get(pk) ?? 0;
        nsMap.set(pk, cur + Number(adj.amount));
      }
    }

    const allInMap = new Map(allInRows.map((r) => [r.period_key, Number(r.spend)]));
    const sfOppsMap = new Map(sfOppsRows.map((r) => [r.period_key, Number(r.opps)]));
    const sfWonMap  = new Map(sfWonRows.map((r) => [
      r.period_key,
      { won: Number(r.won), arr: Number(r.arr), won_channeled: Number(r.won_channeled) },
    ]));

    const allInVals:       (number | null)[] = allPeriods.map((p) => allInMap.get(p)              ?? null);
    const spendVals:       (number | null)[] = allPeriods.map((p) => nsMap.get(p)                 ?? null);
    const oppsVals:        (number | null)[] = allPeriods.map((p) => sfOppsMap.get(p)             ?? null);
    const wonVals:         (number | null)[] = allPeriods.map((p) => sfWonMap.get(p)?.won         ?? null);
    const arrVals:         (number | null)[] = allPeriods.map((p) => sfWonMap.get(p)?.arr         ?? null);
    const wonChanneledVals:(number | null)[] = allPeriods.map((p) => sfWonMap.get(p)?.won_channeled ?? null);

    const n = allPeriods.length;
    const period_avg_label =
      view === 'yearly'    ? `${n}Y / Avg` :
      view === 'quarterly' ? `${n}Q / Avg` :
                             `${n}M / Avg`;

    const rows: KpiSummaryRow[] = [
      { metric: 'Total S&M Spend ($)',          values: spendVals,        avg: rowAvg(spendVals),        is_currency: true  },
      { metric: 'Total Opportunities (count)',  values: oppsVals,         avg: rowAvg(oppsVals),         is_currency: false },
      { metric: 'Total Closed Won Deals',       values: wonVals,          avg: rowAvg(wonVals),          is_currency: false },
      { metric: 'Total Closed Won ARR ($)',     values: arrVals,          avg: rowAvg(arrVals),          is_currency: true  },
      // Hidden row used only for Portfolio CAC computation (channeled won deals, matching Channel Economics denominator)
      { metric: '__won_channeled__',            values: wonChanneledVals, avg: rowAvg(wonChanneledVals), is_currency: false },
      { metric: 'All-in S&M Spend ($)',        values: allInVals,        avg: rowAvg(allInVals),        is_currency: true  },
    ];

    return NextResponse.json({
      periods: allPeriods.map((p) => periodToLabel(p, view)),
      period_avg_label,
      rows,
    } satisfies KpiSummaryResponse);
  } catch (err) {
    console.error('[api/dashboard/kpi-summary]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
