import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET() {
  try {
    await initDb();
    const [rows, nsLatestRow] = await Promise.all([
      query<{ created_month: string }>(
        `SELECT DISTINCT created_month
         FROM salesforce_opportunities
         WHERE created_month IS NOT NULL AND created_month != ''
         ORDER BY created_month DESC`
      ),
      query<{ ns_latest: string }>(
        `SELECT MAX(COALESCE(accounting_period, month_key)) AS ns_latest
         FROM netsuite_actuals
         WHERE month_key IS NOT NULL AND month_key != ''`
      ),
    ]);
    return NextResponse.json({
      months:    rows.map((r) => r.created_month),
      ns_latest: nsLatestRow[0]?.ns_latest ?? null,
    });
  } catch (err) {
    console.error('[api/salesforce/months]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
