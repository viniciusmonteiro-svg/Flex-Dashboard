// Shared server-side auth guard.
// Uses currentUser() (live Clerk API) instead of sessionClaims (JWT) because
// Clerk v2 JWTs do not include publicMetadata by default — the JWT template
// would need customisation. currentUser() always returns fresh metadata.
import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

type Meta = { status?: string; role?: string };

export async function requireAuth(): Promise<{ userId: string; role: string }> {
  const user = await currentUser();

  if (!user) redirect('/sign-in');

  const meta = (user.publicMetadata ?? {}) as Meta;

  // No status = webhook hasn't fired yet (race condition on first sign-in).
  // Send to /checking which polls until metadata is populated.
  if (!meta.status) redirect('/checking');
  if (meta.status === 'pending') redirect('/pending');
  if (meta.status === 'denied') redirect('/access-denied');

  return { userId: user.id, role: meta.role ?? 'viewer' };
}

export async function requireAdmin(): Promise<{ userId: string }> {
  const { role, userId } = await requireAuth();
  if (role !== 'admin') redirect('/access-denied');
  return { userId };
}

// For use inside API route handlers (throws instead of redirecting).
export async function requireAdminApi(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new Error('Forbidden');
  const role = ((user.publicMetadata ?? {}) as Meta).role;
  if (role !== 'admin') throw new Error('Forbidden');
  return user.id;
}
