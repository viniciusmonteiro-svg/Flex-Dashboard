import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const periodType = new URL(req.url).searchParams.get('period_type') ?? 'accounting';

    const periodExpr =
      periodType === 'transaction'
        ? `COALESCE(LEFT(transaction_date::text, 7), month_key)`
        : `COALESCE(accounting_period, month_key)`;

    const rows = await query<{ period: string }>(
      `SELECT DISTINCT ${periodExpr} AS period
       FROM netsuite_actuals
       WHERE month_key IS NOT NULL AND month_key != ''
       ORDER BY period DESC`
    );

    return NextResponse.json({ months: rows.map((r) => r.period) });
  } catch (err) {
    console.error('[api/channel-costs/months]', err);
    return NextResponse.json({ error: 'Failed to fetch months' }, { status: 500 });
  }
}
