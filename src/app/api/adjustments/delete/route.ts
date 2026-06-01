import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as { channel: string; month_key?: string | null };
    if (!body.channel) return NextResponse.json({ error: 'channel is required' }, { status: 400 });

    const monthKey = body.month_key ?? null;
    await execute(
      `DELETE FROM department_adjustments
       WHERE channel = $1 AND month_key IS NOT DISTINCT FROM $2`,
      [body.channel, monthKey]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/adjustments/delete]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
