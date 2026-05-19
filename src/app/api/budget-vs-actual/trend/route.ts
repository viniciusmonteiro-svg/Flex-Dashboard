import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

interface TrendRow {
  month_key: string;
  total_amount: string;
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    const channel = searchParams.get('channel') ?? 'all';

    const rows = await query<TrendRow>(
      `SELECT
         month_key,
         SUM(amount) AS total_amount
       FROM netsuite_actuals
       WHERE ($1::text = 'all' OR financial_row = $1::text)
       GROUP BY month_key
       ORDER BY month_key DESC
       LIMIT 12`,
      [channel]
    );

    const mapped = rows.reverse().map((r) => ({
      month_key: r.month_key,
      budget: 0,
      actual: Number(r.total_amount) / 100,
      variance: Number(r.total_amount) / 100,
    }));

    return NextResponse.json({ rows: mapped });
  } catch (err) {
    console.error('[api/trend]', err);
    return NextResponse.json({ error: 'Failed to fetch trend' }, { status: 500 });
  }
}
