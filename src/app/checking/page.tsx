'use client';

import { useEffect, useRef } from 'react';

/**
 * Race-condition buffer page.
 *
 * On first sign-in, Clerk fires `user.created` async (~1-3 s after the browser
 * lands on the app). The JWT at that point has empty publicMetadata, so
 * proxy.ts redirects here instead of to /pending.
 *
 * This page polls /api/auth/status (which uses currentUser() — bypasses the
 * JWT cache and reads live Clerk data) every 2 s. Once the webhook has set
 * the metadata, it does a full page reload so the browser gets a fresh JWT
 * cookie with the correct status, and proxy.ts lets the user through.
 */
export default function CheckingPage() {
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const poll = async () => {
      // After 15 s with no webhook response, fall back to /pending
      if (Date.now() - startedAt.current > 15_000) {
        window.location.href = '/pending';
        return;
      }

      try {
        const res  = await fetch('/api/auth/status');
        const data: { status: string | null } = await res.json();

        if (data.status && data.status !== 'unauthenticated') {
          // Webhook has fired and metadata is set.
          // window.location.href (full reload) forces the browser to send a
          // fresh request. Clerk detects the updated session version and issues
          // a new JWT cookie. proxy.ts then reads the correct status.
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
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm px-8 py-10 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[var(--color-primary)] mx-auto mb-5" />
        <h1 className="text-lg font-bold text-gray-900 mb-2">Setting up your account…</h1>
        <p className="text-sm text-gray-500">This only takes a moment.</p>
      </div>
    </div>
  );
}
