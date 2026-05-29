import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { CLASSIFICATION_JOINS, CHANNEL_EXPR } from '@/lib/classifyVendor';
import { buildPeriodExpr } from '@/lib/periodExpr';

export interface OppTrendRow {
  period:         string;        // display label e.g. "Q1 '25"
  opportunities:  number;
  spend:          number;
  dollar_per_opp: number | null;
}

export interface OppTrendResponse {
  rows: OppTrendRow[];
}

// ─── Helpers (same pattern as kpi-summary / arr-cac-chart) ───────────────────

function periodGroupExpr(view: string, colExpr: string): string {
  if (view === 'yearly')    return `LEFT((${colExpr}), 4)`;
  if (view === 'quarterly') {
    return `LEFT((${colExpr}), 4) || '-Q' || CEIL(CAST(SPLIT_PART((${colExpr}), '-', 2) AS int) / 3.0)::int::text`;
  }
  return `LEFT((${colExpr}), 7)`;
}

function periodToLabel(key: string, view: string): string {
  if (view === 'yearly') return key;
  if (view === 'quarterly') {
    const [year, q] = key.split('-');
    return `${q} ${year}`;
  }
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
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
    // SF groups by created_month — matches Pipeline Cohort tab.
    const sfGroupExpr = periodGroupExpr(view, 'created_month');

    // Snap NS window to full period boundaries
    const nsFrom = from ? snapFrom(from, view) : null;
    const nsTo   = to   ? snapTo(to, view)     : null;

    // ── Query 1: Opportunities from Salesforce (grouped by created_month period) ──
    // Matches "Pipeline Cohort" subtab: opps attributed to the period they were created.
    const sfRows = await query<{ period_key: string; opportunities: string }>(
      `SELECT
         ${sfGroupExpr} AS period_key,
         COUNT(*)        AS opportunities
       FROM salesforce_opportunities
       WHERE created_month IS NOT NULL AND created_month != ''
         AND COALESCE(NULLIF(TRIM(primary_channel), ''), 'Unclassified') NOT IN ('Unclassified')
         AND ($1::text IS NULL OR created_month >= $1)
         AND ($2::text IS NULL OR created_month <= $2)
       GROUP BY ${sfGroupExpr}
       ORDER BY MIN(created_month) NULLS LAST`,
      [from, to],
    );

    // ── Query 2: S&M Spend from NetSuite (excludes Do Not Tag + Unclassified) ─
    const nsParams: unknown[] = [];
    const nsConds: string[]   = [`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`];
    if (nsFrom) { nsParams.push(nsFrom); nsConds.push(`${NS_RAW} >= $${nsParams.length}`); }
    if (nsTo)   { nsParams.push(nsTo);   nsConds.push(`${NS_RAW} <= $${nsParams.length}`); }

    const nsRows = await query<{ period_key: string; spend: string }>(
      `SELECT
         ${nsGroupExpr}      AS period_key,
         SUM(n.amount) / 100 AS spend
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       WHERE ${nsConds.join(' AND ')}
       GROUP BY ${nsGroupExpr}
       ORDER BY MIN(${NS_RAW})`,
      nsParams,
    );

    // ── Merge in application code (no SQL join between the two tables) ─────────
    const allPeriods = [
      ...new Set([
        ...sfRows.map((r) => r.period_key),
        ...nsRows.map((r) => r.period_key),
      ]),
    ].sort();

    const sfMap = new Map(sfRows.map((r) => [r.period_key, Number(r.opportunities)]));
    const nsMap = new Map(nsRows.map((r) => [r.period_key, Number(r.spend)]));

    const rows: OppTrendRow[] = allPeriods.map((key) => {
      const opportunities = sfMap.get(key) ?? 0;
      const spend         = nsMap.get(key) ?? 0;
      const dollar_per_opp = opportunities > 0 ? spend / opportunities : null;
      return {
        period: periodToLabel(key, view),
        opportunities,
        spend,
        dollar_per_opp,
      };
    });

    return NextResponse.json({ rows } satisfies OppTrendResponse);
  } catch (err) {
    console.error('[api/dashboard/opp-trend-chart]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
