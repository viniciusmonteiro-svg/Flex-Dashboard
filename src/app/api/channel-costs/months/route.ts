import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { buildPeriodExprUnaliased } from '@/lib/periodExpr';

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const periodType = new URL(req.url).searchParams.get('period_type') ?? 'transaction';
    const PERIOD = buildPeriodExprUnaliased(periodType);

    const [rows, nsLatestRow] = await Promise.all([
      query<{ period: string }>(
        `SELECT DISTINCT period FROM (
           SELECT ${PERIOD} AS period
           FROM netsuite_actuals
           WHERE month_key IS NOT NULL AND month_key != ''
           UNION
           SELECT created_month AS period
           FROM salesforce_opportunities
           WHERE created_month IS NOT NULL AND created_month != ''
         ) combined
         ORDER BY period DESC`
      ),
      query<{ ns_latest: string }>(
        `SELECT MAX(COALESCE(accounting_period, month_key)) AS ns_latest
         FROM netsuite_actuals
         WHERE month_key IS NOT NULL AND month_key != ''`
      ),
    ]);

    return NextResponse.json({
      months:    rows.map((r) => r.period),
      ns_latest: nsLatestRow[0]?.ns_latest ?? null,
    });
  } catch (err) {
    console.error('[api/channel-costs/months]', err);
    return NextResponse.json({ error: 'Failed to fetch months' }, { status: 500 });
  }
}
