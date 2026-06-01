import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as { financial_row: string; month_key?: string | null };
    if (!body.financial_row) {
      return NextResponse.json({ error: 'financial_row is required' }, { status: 400 });
    }
    const monthKey = body.month_key ?? null;
    await execute(
      `DELETE FROM gl_reclassifications
       WHERE financial_row = $1 AND month_key IS NOT DISTINCT FROM $2`,
      [body.financial_row, monthKey]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/gl-reclassifications/delete]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
