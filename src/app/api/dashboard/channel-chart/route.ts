import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { CLASSIFICATION_JOINS, CHANNEL_EXPR } from '@/lib/classifyVendor';
import { buildPeriodExpr } from '@/lib/periodExpr';

export interface ChannelChartRow {
  channel: string;
  won:     number;
  cost:    number;
  cac:     number | null;
}

const CHANNEL_ORDER = [
  'Digital',
  'Trade Show',
  'Partner / Referral',
  'Sales Development',
  'Other/Rep Nurture',
];

// Paid Search, Paid Social, SEO/Organic, Web Direct, Review Sites → "Digital"
// Rep Nurture, Email, Other → "Other/Rep Nurture"
const SF_CHANNEL_CASE = `
  CASE
    WHEN TRIM(primary_channel) IN (
      'Paid Search','Web Paid','Paid Social','Social Media',
      'Web Organic','SEO / Organic','Web Direct','Review Sites'
    ) THEN 'Digital'
    WHEN TRIM(primary_channel) = 'Trade Show' THEN 'Trade Show'
    WHEN TRIM(primary_channel) IN ('Referral','Partner') THEN 'Partner / Referral'
    WHEN TRIM(primary_channel) = 'Sales Development' THEN 'Sales Development'
    WHEN TRIM(primary_channel) IN ('Rep Nurture','Email','Other','Web Other') THEN 'Other/Rep Nurture'
  END`;

const NS_CHANNEL_CASE = `
  CASE
    WHEN ${CHANNEL_EXPR} IN ('Paid Search','Paid Social','SEO / Organic','Web Direct','Review Sites') THEN 'Digital'
    WHEN ${CHANNEL_EXPR} IN ('Partner','Referral') THEN 'Partner / Referral'
    WHEN ${CHANNEL_EXPR} IN ('Rep Nurture','Email','Other') THEN 'Other/Rep Nurture'
    ELSE ${CHANNEL_EXPR}
  END`;

const EXCLUDED = `('Do Not Tag (COGS/Non-S&M)', 'Unclassified')`;

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const from       = searchParams.get('from') || null;
    const to         = searchParams.get('to')   || null;
    const periodType = searchParams.get('period_type') ?? 'transaction';

    const PERIOD = buildPeriodExpr(periodType);

    // Part A — Closed Won per channel from Salesforce (grouped by close_date period)
    const sfParams: unknown[] = [];
    const sfConds: string[] = [
      `primary_channel IS NOT NULL`,
      `TRIM(primary_channel) != ''`,
      `TRIM(primary_channel) != '0'`,
      `close_date IS NOT NULL`,
      `stage = 'Closed Won'`,
    ];
    if (from) { sfParams.push(from); sfConds.push(`TO_CHAR(close_date, 'YYYY-MM') >= $${sfParams.length}`); }
    if (to)   { sfParams.push(to);   sfConds.push(`TO_CHAR(close_date, 'YYYY-MM') <= $${sfParams.length}`); }

    const sfRows = await query<{ channel: string; won: string }>(
      `SELECT
         ${SF_CHANNEL_CASE} AS channel,
         COUNT(*)            AS won
       FROM salesforce_opportunities
       WHERE ${sfConds.join(' AND ')}
       GROUP BY 1
       HAVING ${SF_CHANNEL_CASE} IS NOT NULL`,
      sfParams,
    );

    // Part B — Channel costs from NetSuite
    const nsParams: unknown[] = [];
    const nsConds: string[] = [`${CHANNEL_EXPR} NOT IN ${EXCLUDED}`];
    if (from) { nsParams.push(from); nsConds.push(`${PERIOD} >= $${nsParams.length}`); }
    if (to)   { nsParams.push(to);   nsConds.push(`${PERIOD} <= $${nsParams.length}`); }

    const nsRows = await query<{ channel: string; cost: string }>(
      `SELECT
         ${NS_CHANNEL_CASE} AS channel,
         SUM(n.amount) / 100 AS cost
       FROM netsuite_actuals n
       ${CLASSIFICATION_JOINS}
       WHERE ${nsConds.join(' AND ')}
       GROUP BY 1`,
      nsParams,
    );

    // Part C — Merge and calculate CAC
    const wonMap  = new Map(sfRows.map((r) => [r.channel, Number(r.won)]));
    const costMap = new Map(nsRows.map((r) => [r.channel, Number(r.cost)]));

    const rows: ChannelChartRow[] = CHANNEL_ORDER
      .map((channel) => {
        const won  = wonMap.get(channel) ?? 0;
        const cost = costMap.get(channel) ?? 0;
        const cac  = won > 0 && cost > 0 ? cost / won : null;
        return { channel, won, cost, cac };
      })
      .filter((r) => r.won > 0 || r.cost > 0);

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[api/dashboard/channel-chart]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
