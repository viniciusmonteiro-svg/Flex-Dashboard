import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET() {
  try {
    await initDb();
    const rows = await query<{ month_key: string }>(
      'SELECT DISTINCT month_key FROM netsuite_actuals ORDER BY month_key DESC'
    );
    return NextResponse.json({ months: rows.map((r) => r.month_key) });
  } catch (err) {
    console.error('[api/channel-detail/months]', err);
    return NextResponse.json({ error: 'Failed to fetch months' }, { status: 500 });
  }
}
