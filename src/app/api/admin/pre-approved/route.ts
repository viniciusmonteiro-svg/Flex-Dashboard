import { NextResponse } from 'next/server';
import { getPoolInstance } from '@/db/connection';
import { initDb } from '@/db/init';
import { requireAdminApi } from '@/lib/requireAuth';

export async function GET() {
  try {
    await requireAdminApi();
    await initDb();
    const pool = getPoolInstance();
    const { rows } = await pool.query(
      `SELECT id, email, role, note, created_at, claimed_at
       FROM pre_approved_emails
       ORDER BY created_at DESC`
    );
    return NextResponse.json({ ok: true, entries: rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireAdminApi();
    const { email, role, note } = await req.json();

    if (!email || !role) {
      return NextResponse.json({ ok: false, error: 'email and role are required' }, { status: 400 });
    }
    if (!['viewer', 'admin'].includes(role)) {
      return NextResponse.json({ ok: false, error: 'role must be viewer or admin' }, { status: 400 });
    }

    await initDb();
    const pool = getPoolInstance();
    const { rows } = await pool.query(
      `INSERT INTO pre_approved_emails (email, role, note, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, note = EXCLUDED.note
       RETURNING id, email, role, note, created_at`,
      [email.toLowerCase().trim(), role, note ?? null, userId]
    );
    return NextResponse.json({ ok: true, entry: rows[0] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdminApi();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

    await initDb();
    const pool = getPoolInstance();
    await pool.query('DELETE FROM pre_approved_emails WHERE id = $1', [id]);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'Forbidden' ? 403 : 500 });
  }
}
