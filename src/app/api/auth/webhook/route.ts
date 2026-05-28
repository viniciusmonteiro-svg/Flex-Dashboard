import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { clerkClient } from '@clerk/nextjs/server';
import { initDb } from '@/db/init';
import { getPoolInstance } from '@/db/connection';

// ── Hardcoded bootstrap admins ────────────────────────────────────────────────
// Always approved as admin on first sign-in.
const ADMIN_EMAILS = [
  'vinicius.monteiro@curvedental.com',
];

interface ClerkEmailAddress {
  email_address: string;
  id: string;
}

interface ClerkUserCreatedData {
  id: string;
  email_addresses: ClerkEmailAddress[];
  primary_email_address_id: string;
  first_name: string | null;
  last_name: string | null;
}

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // ── Verify svix signature ──────────────────────────────────────────────────
  const headerPayload  = await headers();
  const svixId         = headerPayload.get('svix-id');
  const svixTimestamp  = headerPayload.get('svix-timestamp');
  const svixSignature  = headerPayload.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const body = await req.text();
  const wh   = new Webhook(webhookSecret);

  let evt: { type: string; data: ClerkUserCreatedData };
  try {
    evt = wh.verify(body, {
      'svix-id':        svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as { type: string; data: ClerkUserCreatedData };
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (evt.type !== 'user.created') {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { id: clerkId, email_addresses, primary_email_address_id, first_name, last_name } = evt.data;

  const primaryEmailObj = email_addresses.find((e) => e.id === primary_email_address_id);
  const email = primaryEmailObj?.email_address ?? '';
  const name  = [first_name, last_name].filter(Boolean).join(' ') || email;

  await initDb();
  const pool = getPoolInstance();

  // ── Determine approval status ──────────────────────────────────────────────
  const isHardcodedAdmin = ADMIN_EMAILS.includes(email);

  const preApproved = await pool.query(
    'SELECT role FROM pre_approved_emails WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  const preApprovedEntry = preApproved.rows[0] ?? null;
  const isPreApproved    = !!preApprovedEntry;

  const isApproved = isHardcodedAdmin || isPreApproved;
  const role       = isHardcodedAdmin ? 'admin' : (preApprovedEntry?.role ?? 'viewer');

  // ── Write to users table ───────────────────────────────────────────────────
  await pool.query(
    `INSERT INTO users (clerk_id, email, name, role, password_hash, approved_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (clerk_id) DO UPDATE
       SET email       = EXCLUDED.email,
           name        = EXCLUDED.name,
           role        = EXCLUDED.role,
           approved_at = EXCLUDED.approved_at`,
    [clerkId, email, name, role, '', isApproved ? new Date() : null]
  );

  // ── Mark pre-approved email as claimed ────────────────────────────────────
  if (isPreApproved) {
    await pool.query(
      'UPDATE pre_approved_emails SET claimed_at = NOW(), claimed_by = $1 WHERE email = $2',
      [clerkId, email.toLowerCase().trim()]
    );
  }

  // ── Create pending access request if not approved ─────────────────────────
  if (!isApproved) {
    await pool.query(
      `INSERT INTO access_requests (clerk_id, email, name, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clerk_id) DO NOTHING`,
      [clerkId, email, name, 'pending']
    );
  }

  // ── Sync to Clerk JWT (publicMetadata) ────────────────────────────────────
  const client = await clerkClient();
  await client.users.updateUserMetadata(clerkId, {
    publicMetadata: {
      approved: isApproved,
      role,
      status: isApproved ? 'approved' : 'pending',
    },
  });

  return NextResponse.json({ ok: true, approved: isApproved, role });
}
