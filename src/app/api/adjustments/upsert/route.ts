import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as { channel: string; amount: number; description?: string };
    if (!body.channel) return NextResponse.json({ error: 'channel is required' }, { status: 400 });
    const amountCents = Math.round((body.amount ?? 0) * 100);
    await execute(
      `INSERT INTO department_adjustments (channel, amount, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (channel) DO UPDATE
         SET amount      = EXCLUDED.amount,
             description = EXCLUDED.description,
             updated_at  = NOW()`,
      [body.channel, amountCents, body.description ?? null]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/adjustments/upsert]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
