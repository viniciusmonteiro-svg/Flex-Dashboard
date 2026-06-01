import { NextRequest, NextResponse } from 'next/server';
import { initDb } from '@/db/init';
import { execute } from '@/db/query';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json() as { id: number };
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await execute('DELETE FROM intercompany_allocations WHERE id = $1', [body.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/intercompany/delete]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
