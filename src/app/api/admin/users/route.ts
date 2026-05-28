import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getPoolInstance } from '@/db/connection';
import { initDb } from '@/db/init';

async function requireAdmin() {
  const { sessionClaims } = await auth();
  const role = (sessionClaims?.publicMetadata as { role?: string })?.role;
  if (role !== 'admin') throw new Error('Forbidden');
}

export async function GET() {
  try {
    await requireAdmin();
    await initDb();
    const pool = getPoolInstance();
    const { rows } = await pool.query(
      `SELECT id, clerk_id, email, name, role, created_at
       FROM users
       WHERE clerk_id IS NOT NULL
       ORDER BY created_at DESC`
    );
    return NextResponse.json({ ok: true, users: rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}
