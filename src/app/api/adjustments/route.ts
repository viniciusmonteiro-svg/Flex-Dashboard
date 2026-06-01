import { NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { query } from '@/db/query';

export interface AdjustmentRow {
  channel:     string;
  amount:      number;  // dollars
  description: string | null;
  updated_at:  string | null;
}

export async function GET() {
  try {
    await initDb();
    const rows = await query<{ channel: string; amount: string; description: string | null; updated_at: string | null }>(
      'SELECT channel, amount, description, updated_at FROM department_adjustments ORDER BY channel'
    );
    return NextResponse.json({
      adjustments: rows.map((r) => ({
        channel:     r.channel,
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
