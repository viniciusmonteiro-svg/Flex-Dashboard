import { NextResponse } from 'next/server';
import { getPoolInstance } from '@/db/connection';
import { initDb } from '@/db/init';
import { clerkClient } from '@clerk/nextjs/server';
import { requireAdminApi } from '@/lib/requireAuth';

export async function GET() {
  try {
    await requireAdminApi();
    await initDb();
    const pool = getPoolInstance();
    const { rows } = await pool.query(
      `SELECT id, clerk_id, email, name, requested_at
       FROM access_requests
       WHERE status = $1
       ORDER BY requested_at ASC`,
      ['pending']
    );
    return NextResponse.json({ ok: true, requests: rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminApi();
    const { clerk_id, role, action } = await req.json();
    if (!clerk_id || !action) {
      return NextResponse.json({ ok: false, error: 'clerk_id and action required' }, { status: 400 });
    }

    await initDb();
    const pool   = getPoolInstance();
    const client = await clerkClient();

    if (action === 'deny') {
      await pool.query(
        "UPDATE access_requests SET status = $1, resolved_at = NOW() WHERE clerk_id = $2",
        ['denied', clerk_id]
      );
      await pool.query('DELETE FROM users WHERE clerk_id = $1', [clerk_id]);
      await client.users.updateUserMetadata(clerk_id, {
        publicMetadata: { approved: false, role: 'viewer', status: 'denied' },
      });
      return NextResponse.json({ ok: true });
    }

    // approve
    if (!role) {
      return NextResponse.json({ ok: false, error: 'role required for approval' }, { status: 400 });
    }
    await pool.query(
      "UPDATE access_requests SET status = $1, resolved_at = NOW() WHERE clerk_id = $2",
      ['approved', clerk_id]
    );
    await pool.query(
      'UPDATE users SET role = $1, approved_at = NOW() WHERE clerk_id = $2',
      [role, clerk_id]
    );
    await client.users.updateUserMetadata(clerk_id, {
      publicMetadata: { approved: true, role, status: 'approved' },
    });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}
