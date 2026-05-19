import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export async function GET() {
  try {
    await initDb();
    const rows = await query<{ year: string }>(
      `SELECT DISTINCT LEFT(created_month, 4) AS year
         FROM salesforce_opportunities
        WHERE created_month IS NOT NULL AND created_month != ''
        ORDER BY year DESC`
    );
    return NextResponse.json({ years: rows.map((r) => r.year) });
  } catch (err) {
    console.error('[api/salesforce/years]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
