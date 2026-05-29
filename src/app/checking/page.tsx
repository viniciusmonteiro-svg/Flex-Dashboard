'use client';

import { useEffect, useRef } from 'react';
import { useSession, useClerk } from '@clerk/nextjs';

/**
 * Race-condition buffer page.
 *
 * On first sign-in the JWT has empty publicMetadata (webhook hasn't run yet),
 * so proxy.ts redirects here. This page polls /api/auth/status (currentUser()
 * — live Clerk API) every 2 s. Once the webhook sets the metadata, we call
 * session.reload() to force Clerk to issue a fresh JWT cookie, then do a full
 * page reload so proxy.ts reads the correct status from the new token.
 */
export default function CheckingPage() {
  const startedAt    = useRef(Date.now());
  const { session }  = useSession();
  const { signOut }  = useClerk();
  const timedOut     = useRef(false);

  useEffect(() => {
    const poll = async () => {
      // After 12 s with no webhook response, fall back to /pending
      if (Date.now() - startedAt.current > 12_000) {
        timedOut.current = true;
        window.location.href = '/pending';
        return;
      }

      try {
        const res  = await fetch('/api/auth/status');
        const data: { status: string | null } = await res.json();

        if (data.status && data.status !== 'unauthenticated') {
          // Webhook has fired and metadata is set.
          // Reload the Clerk session to get a fresh JWT with the updated
          // publicMetadata, then do a full-page navigation so proxy.ts
          // reads the new token instead of the stale one.
          if (session) await session.reload();
          window.location.href = '/';
        } else {
          setTimeout(poll, 2000);
        }
      } catch {
        setTimeout(poll, 2000);
      }
    };

    const id = setTimeout(poll, 1000);
    return () => clearTimeout(id);
  }, [session]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm px-8 py-10 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[var(--color-primary)] mx-auto mb-5" />
        <h1 className="text-lg font-bold text-gray-900 mb-2">Setting up your account…</h1>
        <p className="text-sm text-gray-500 mb-8">This only takes a moment.</p>
        <button
          onClick={() => signOut({ redirectUrl: '/sign-in' })}
          className="w-full rounded-lg border border-gray-200 text-gray-500 text-sm font-medium py-2.5 hover:bg-gray-50 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
