import { NextResponse } from 'next/server';
import { getPoolInstance } from '@/db/connection';
import { initDb } from '@/db/init';
import { clerkClient } from '@clerk/nextjs/server';
import { requireAdminApi } from '@/lib/requireAuth';

export async function POST(req: Request) {
  try {
    await requireAdminApi();
    const { clerk_id, role } = await req.json();
    if (!clerk_id || !role) {
      return NextResponse.json({ ok: false, error: 'clerk_id and role required' }, { status: 400 });
    }

    await initDb();
    const pool = getPoolInstance();

    await pool.query('UPDATE users SET role = $1 WHERE clerk_id = $2', [role, clerk_id]);

    const client = await clerkClient();
    await client.users.updateUserMetadata(clerk_id, {
      publicMetadata: { approved: true, role, status: 'approved' },
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}
