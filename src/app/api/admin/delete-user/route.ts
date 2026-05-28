import { NextResponse } from 'next/server';
import { getPoolInstance } from '@/db/connection';
import { initDb } from '@/db/init';
import { clerkClient } from '@clerk/nextjs/server';
import { requireAdminApi } from '@/lib/requireAuth';

export async function POST(req: Request) {
  try {
    await requireAdminApi();
    const { clerk_id } = await req.json();
    if (!clerk_id) {
      return NextResponse.json({ ok: false, error: 'clerk_id required' }, { status: 400 });
    }

    await initDb();
    const pool = getPoolInstance();

    await pool.query('DELETE FROM users WHERE clerk_id = $1', [clerk_id]);
    await pool.query('DELETE FROM access_requests WHERE clerk_id = $1', [clerk_id]);

    const client = await clerkClient();
    await client.users.deleteUser(clerk_id);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}
