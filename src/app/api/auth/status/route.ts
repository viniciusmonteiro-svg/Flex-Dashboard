import { currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * GET /api/auth/status
 * Returns the current user's approval status from Clerk publicMetadata.
 * Called by the /checking page to poll until the webhook has finished.
 */
export async function GET() {
  const user = await currentUser();

  if (!user) {
    return NextResponse.json({ status: 'unauthenticated' });
  }

  const meta = (user.publicMetadata ?? {}) as { status?: string; role?: string };

  return NextResponse.json({
    status: meta.status ?? null,   // null = webhook not yet run
    role:   meta.role   ?? null,
  });
}
