// Shared server-side auth guard — replaces middleware-based protection.
// Call `await requireAuth()` at the top of any protected Server Component.
// Redirects unauthenticated, pending, and denied users automatically.
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export async function requireAuth(): Promise<{ userId: string; role: string }> {
  const { userId, sessionClaims } = await auth();

  if (!userId) redirect('/sign-in');

  const meta = sessionClaims?.publicMetadata as
    | { status?: string; role?: string }
    | undefined;

  if (meta?.status === 'pending') redirect('/pending');
  if (meta?.status === 'denied') redirect('/access-denied');

  return { userId, role: meta?.role ?? 'viewer' };
}

export async function requireAdmin(): Promise<{ userId: string }> {
  const { role, userId } = await requireAuth();
  if (role !== 'admin') redirect('/access-denied');
  return { userId };
}
