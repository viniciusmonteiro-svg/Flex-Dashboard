import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';
import { buildPeriodExprUnaliased } from '@/lib/periodExpr';

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const periodType = new URL(req.url).searchParams.get('period_type') ?? 'transaction';
    const PERIOD = buildPeriodExprUnaliased(periodType);

    const rows = await query<{ period: string }>(
      `SELECT DISTINCT ${PERIOD} AS period
       FROM netsuite_actuals
       WHERE month_key IS NOT NULL AND month_key != ''
       ORDER BY period DESC`
    );

    return NextResponse.json({ months: rows.map((r) => r.period) });
  } catch (err) {
    console.error('[api/vendor-classifications/months]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
