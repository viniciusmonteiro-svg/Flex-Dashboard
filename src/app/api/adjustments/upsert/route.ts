import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as {
      channel:      string;
      month_key?:   string | null;
      amount:       number;
      description?: string;
    };
    if (!body.channel) return NextResponse.json({ error: 'channel is required' }, { status: 400 });

    const amountCents = Math.round((body.amount ?? 0) * 100);
    const monthKey    = body.month_key ?? null;

    // Use DELETE + INSERT to avoid NULL equality issues in ON CONFLICT
    await execute(
      `DELETE FROM department_adjustments
       WHERE channel = $1 AND month_key IS NOT DISTINCT FROM $2`,
      [body.channel, monthKey]
    );
    await execute(
      `INSERT INTO department_adjustments (channel, month_key, amount, description, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [body.channel, monthKey, amountCents, body.description ?? null]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/adjustments/upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
