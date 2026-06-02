import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { CLASSIFICATION_JOINS, CHANNEL_EXPR } from '@/lib/classifyVendor';
import { buildPeriodExpr } from '@/lib/periodExpr';
import { buildIntercompanyJoin, INTERCOMPANY_AMOUNT_EXPR } from '@/lib/channelCostQuery';

export interface CacCostRow {
  channel:   string;   // NetSuite display channel
  month_key: string;   // YYYY-MM (resolved accounting or transaction period)
  cost:      number;   // dollars (already ÷100)
}

export interface CacOppRow {
  sf_channel: string;  // raw primary_channel from salesforce_opportunities
  month_key:  string;  // YYYY-MM = created_month
  opps:       number;
}

export interface ArrRow {
  sf_channel: string;  // raw primary_channel from salesforce_opportunities
  month_key:  string;  // YYYY-MM = created_month
  arr:        number;  // dollars (monthly_mrr × 12 ÷ 100)
}

export interface AllOppRow {
  sf_channel: string;  // raw primary_channel from salesforce_opportunities
  month_key:  string;  // YYYY-MM = created_month
  opps:       number;  // count of all opportunities (any stage)
}

export interface TotalSmRow {
  month_key: string;  // YYYY-MM (same period expression as cost_rows)
  total_sm:  number;  // dollars — all-in S&M (financial_row ^(6|7), no channel filter)
}

export interface CacResponse {
  cost_rows:    CacCostRow[];
  opp_rows:     CacOppRow[];   // Closed Won only (used for CAC)
  arr_rows:     ArrRow[];
  all_opp_rows: AllOppRow[];   // all opps (used for $ / Opportunity)
  total_sm_rows: TotalSmRow[]; // all-in S&M per period (matches Dashboard KPI)
}

const EXCLUDED = `('Do Not Tag (COGS/Non-S&M)', 'Unclassified')`;

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const yearParam  = searchParams.get('year')        ?? 'all';
    const periodType = searchParams.get('period_type') ?? 'accounting';
    const fromParam  = searchParams.get('from')        || null;
    const toParam    = searchParams.get('to')          || null;
    // date_type controls whether SF Closed Won numbers are grouped by
    // created_month (cohort) or close_date (close_date).
    // NetSuite cost rows always use accounting/transaction period (unaffected).
    const dateType   = searchParams.get('date_type')   ?? 'cohort'; // 'cohort' | 'close_date'

    const yearFilter  = !fromParam && !toParam && yearParam !== 'all' ? yearParam : null;
    const PERIOD      = buildPeriodExpr(periodType);
    const useCloseDate = dateType === 'close_date';

    // ── Step 1: channel costs per YYYY-MM period (always accounting/tx date) ──
    const costParams: unknown[] = [];
    const costConds: string[] = [`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`];

    if (fromParam) { costParams.push(fromParam); costConds.push(`${PERIOD} >= $${costParams.length}`); }
    if (toParam)   { costParams.push(toParam);   costConds.push(`${PERIOD} <= $${costParams.length}`); }
    if (yearFilter) {
      costParams.push(yearFilter);
      costConds.push(`LEFT(${PERIOD}, 4) = $${costParams.length}`);
    }

    const rawCosts = await query<{ channel: string; month_key: string; cost: string }>(
      `SELECT
         ${CHANNEL_EXPR}                          AS channel,
         ${PERIOD}                                AS month_key,
         SUM(${INTERCOMPANY_AMOUNT_EXPR}) / 100   AS cost
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       ${buildIntercompanyJoin(PERIOD)}
       WHERE ${costConds.join(' AND ')}
       GROUP BY ${CHANNEL_EXPR}, ${PERIOD}
       ORDER BY ${CHANNEL_EXPR}, ${PERIOD}`,
      costParams
    );

    // ── Step 2: SF Closed Won count per channel ────────────────────────────────
    // cohort mode:     grouped by created_month
    // close_date mode: grouped by TO_CHAR(close_date, 'YYYY-MM')
    const oppParams: unknown[] = [];
    const oppConds: string[] = [
      `COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')`,
      `stage = 'Closed Won'`,
    ];

    if (useCloseDate) {
      oppConds.push(`close_date IS NOT NULL`);
      if (fromParam) { oppParams.push(fromParam); oppConds.push(`TO_CHAR(close_date, 'YYYY-MM') >= $${oppParams.length}`); }
      if (toParam)   { oppParams.push(toParam);   oppConds.push(`TO_CHAR(close_date, 'YYYY-MM') <= $${oppParams.length}`); }
    } else {
      oppConds.push(`created_month IS NOT NULL AND created_month != ''`);
      if (fromParam) { oppParams.push(fromParam); oppConds.push(`created_month >= $${oppParams.length}`); }
      if (toParam)   { oppParams.push(toParam);   oppConds.push(`created_month <= $${oppParams.length}`); }
      if (yearFilter) { oppParams.push(yearFilter); oppConds.push(`LEFT(created_month, 4) = $${oppParams.length}`); }
    }

    const oppPeriodExpr = useCloseDate
      ? `TO_CHAR(close_date, 'YYYY-MM')`
      : `created_month`;

    const rawOpps = await query<{ sf_channel: string; month_key: string; opps: string }>(
      `SELECT
         TRIM(primary_channel) AS sf_channel,
         ${oppPeriodExpr}      AS month_key,
         COUNT(*)              AS opps
       FROM salesforce_opportunities
       WHERE ${oppConds.join(' AND ')}
       GROUP BY sf_channel, ${oppPeriodExpr}
       ORDER BY sf_channel, ${oppPeriodExpr}`,
      oppParams
    );

    // ── Step 3: ARR by channel (Closed Won) ───────────────────────────────────
    // cohort mode:     grouped by created_month
    // close_date mode: grouped by TO_CHAR(close_date, 'YYYY-MM')
    const arrParams: unknown[] = [];
    const arrConds: string[] = [
      `stage = 'Closed Won'`,
      `COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')`,
    ];

    if (useCloseDate) {
      arrConds.push(`close_date IS NOT NULL`);
      if (fromParam) { arrParams.push(fromParam); arrConds.push(`TO_CHAR(close_date, 'YYYY-MM') >= $${arrParams.length}`); }
      if (toParam)   { arrParams.push(toParam);   arrConds.push(`TO_CHAR(close_date, 'YYYY-MM') <= $${arrParams.length}`); }
    } else {
      arrConds.push(`created_month IS NOT NULL AND created_month != ''`);
      if (fromParam) { arrParams.push(fromParam); arrConds.push(`created_month >= $${arrParams.length}`); }
      if (toParam)   { arrParams.push(toParam);   arrConds.push(`created_month <= $${arrParams.length}`); }
      if (yearFilter) { arrParams.push(yearFilter); arrConds.push(`LEFT(created_month, 4) = $${arrParams.length}`); }
    }

    const arrPeriodExpr = useCloseDate
      ? `TO_CHAR(close_date, 'YYYY-MM')`
      : `created_month`;

    const rawArr = await query<{ sf_channel: string; month_key: string; arr: string }>(
      `SELECT
         TRIM(primary_channel)                     AS sf_channel,
         ${arrPeriodExpr}                          AS month_key,
         COALESCE(SUM(monthly_mrr), 0) * 12 / 100 AS arr
       FROM salesforce_opportunities
       WHERE ${arrConds.join(' AND ')}
       GROUP BY sf_channel, ${arrPeriodExpr}
       ORDER BY sf_channel, ${arrPeriodExpr}`,
      arrParams
    );

    // ── Step 4: all opportunities by channel (any stage, channeled only) ────────
    // Uses the same filter as the Pipeline tab: exclude Unclassified (null/blank
    // primary_channel). This makes the $/Opp denominator match Pipeline exactly.
    const allOppParams: unknown[] = [];
    const allOppConds: string[] = [
      `COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')`,
    ];

    if (fromParam) { allOppParams.push(fromParam); allOppConds.push(`created_month >= $${allOppParams.length}`); }
    if (toParam)   { allOppParams.push(toParam);   allOppConds.push(`created_month <= $${allOppParams.length}`); }
    if (yearFilter) {
      allOppParams.push(yearFilter);
      allOppConds.push(`LEFT(created_month, 4) = $${allOppParams.length}`);
    }

    const rawAllOpps = await query<{ sf_channel: string; month_key: string; opps: string }>(
      `SELECT
         TRIM(primary_channel) AS sf_channel,
         created_month         AS month_key,
         COUNT(*)              AS opps
       FROM salesforce_opportunities
       WHERE ${allOppConds.join(' AND ')}
       GROUP BY sf_channel, created_month
       ORDER BY sf_channel, created_month`,
      allOppParams
    );

    // ── Step 5: All-in S&M spend per period (financial_row ^(6|7), no channel filter) ──
    // Matches the "All-in S&M Spend ($)" KPI on the Dashboard.
    // Used as the numerator for the Portfolio Payback footer row.
    const smParams: unknown[] = [];
    const smConds: string[] = [`n.financial_row ~ '^(6|7)'`];

    if (fromParam) { smParams.push(fromParam); smConds.push(`${PERIOD} >= $${smParams.length}`); }
    if (toParam)   { smParams.push(toParam);   smConds.push(`${PERIOD} <= $${smParams.length}`); }
    if (yearFilter) {
      smParams.push(yearFilter);
      smConds.push(`LEFT(${PERIOD}, 4) = $${smParams.length}`);
    }

    const rawTotalSm = await query<{ month_key: string; total_sm: string }>(
      `SELECT
         ${PERIOD}            AS month_key,
         SUM(n.amount) / 100 AS total_sm
       FROM netsuite_actuals n
       WHERE ${smConds.join(' AND ')}
       GROUP BY ${PERIOD}
       ORDER BY ${PERIOD}`,
      smParams
    );

    return NextResponse.json({
      cost_rows: rawCosts.map((r) => ({
        channel:   r.channel,
        month_key: r.month_key,
        cost:      Number(r.cost),
      })),
      opp_rows: rawOpps.map((r) => ({
        sf_channel: r.sf_channel,
        month_key:  r.month_key,
        opps:       Number(r.opps),
      })),
      arr_rows: rawArr.map((r) => ({
        sf_channel: r.sf_channel,
        month_key:  r.month_key,
        arr:        Number(r.arr),
      })),
      all_opp_rows: rawAllOpps.map((r) => ({
        sf_channel: r.sf_channel,
        month_key:  r.month_key,
        opps:       Number(r.opps),
      })),
      total_sm_rows: rawTotalSm.map((r) => ({
        month_key: r.month_key,
        total_sm:  Number(r.total_sm),
      })),
    } satisfies CacResponse);
  } catch (err) {
    console.error('[api/channel-costs/cac]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
