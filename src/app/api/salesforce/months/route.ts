import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET() {
  try {
    await initDb();
    const rows = await query<{ created_month: string }>(
      `SELECT DISTINCT created_month
       FROM salesforce_opportunities
       WHERE created_month IS NOT NULL AND created_month != ''
       ORDER BY created_month DESC`
    );
    return NextResponse.json({ months: rows.map((r) => r.created_month) });
  } catch (err) {
    console.error('[api/salesforce/months]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
