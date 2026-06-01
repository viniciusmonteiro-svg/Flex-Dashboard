import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export interface AdjustmentRow {
  channel:     string;
  month_key:   string | null;
  amount:      number;  // dollars
  description: string | null;
  updated_at:  string | null;
}

/** GET /api/adjustments?month_key=YYYY-MM  (omit or 'all' = return everything) */
export async function GET(req: NextRequest) {
  try {
    await initDb();
    const { searchParams } = new URL(req.url);
    const monthKey = searchParams.get('month_key');  // 'all' | YYYY-MM | null

    const params: unknown[] = [];
    let where = '';
    if (monthKey && monthKey !== 'all') {
      params.push(monthKey);
      where = `WHERE month_key = $1`;
    }

    const rows = await query<{
      channel: string; month_key: string | null;
      amount: string; description: string | null; updated_at: string | null;
    }>(
      `SELECT channel, month_key, amount, description, updated_at
       FROM department_adjustments
       ${where}
       ORDER BY channel, month_key NULLS FIRST`,
      params
    );

    return NextResponse.json({
      adjustments: rows.map((r) => ({
        channel:     r.channel,
        month_key:   r.month_key,
        amount:      Number(r.amount) / 100,
        description: r.description,
        updated_at:  r.updated_at,
      })),
    });
  } catch (err) {
    console.error('[api/adjustments]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
