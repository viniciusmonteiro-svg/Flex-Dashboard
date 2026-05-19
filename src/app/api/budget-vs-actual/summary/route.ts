import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query, queryOne } from '@/db/query';

interface SpendRow {
  financial_row: string;
  total_amount: string;
}

export async function GET(req: NextRequest) {
  try {
    await initDb();

    const { searchParams } = new URL(req.url);
    let month = searchParams.get('month') ?? '';

    if (!month) {
      const latest = await queryOne<{ month_key: string }>(
        'SELECT month_key FROM netsuite_actuals ORDER BY month_key DESC LIMIT 1'
      );
      month = latest?.month_key ?? '';
    }

    if (!month) {
      return NextResponse.json({ month: null, rows: [], totals: null });
    }

    const rows = await query<SpendRow>(
      `SELECT
         financial_row,
         SUM(amount) AS total_amount
       FROM netsuite_actuals
       WHERE month_key = $1
       GROUP BY financial_row
       ORDER BY financial_row`,
      [month]
    );

    const mapped = rows.map((r) => {
      const actual = Number(r.total_amount) / 100;
      return {
        channel: r.financial_row,
        budget: 0,
        actual,
        variance: actual,
        variance_pct: 0,
      };
    });

    const totalActual = mapped.reduce((sum, r) => sum + r.actual, 0);
    const totals = { budget: 0, actual: totalActual, variance: totalActual, variance_pct: 0 };

    return NextResponse.json({ month, rows: mapped, totals });
  } catch (err) {
    console.error('[api/summary]', err);
    return NextResponse.json({ error: 'Failed to fetch summary' }, { status: 500 });
  }
}
