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
  const startedAt   = useRef(Date.now());
  const { session } = useSession();
  const { signOut } = useClerk();
  const timedOut    = useRef(false);

  useEffect(() => {
    const poll = async () => {
      if (Date.now() - startedAt.current > 12_000) {
        timedOut.current = true;
        window.location.href = '/pending';
        return;
      }
      try {
        const res  = await fetch('/api/auth/status');
        const data: { status: string | null } = await res.json();
        if (data.status && data.status !== 'unauthenticated') {
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-bg)',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          backgroundColor: 'var(--color-surface)',
          borderRadius: '16px',
          border: '1px solid var(--color-border)',
          padding: '40px 36px',
          textAlign: 'center',
          boxShadow: '0 4px 24px rgba(6,44,67,0.07)',
        }}
      >
        {/* Spinner */}
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: '3px solid var(--color-border)',
            borderTopColor: 'var(--color-accent)',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 24px',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: '18px',
            color: 'var(--color-text)',
            marginBottom: '8px',
            letterSpacing: '-0.02em',
          }}
        >
          Setting up your account…
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
            color: 'var(--color-text-muted)',
            lineHeight: 1.6,
            marginBottom: '32px',
          }}
        >
          This only takes a moment.
        </p>

        <button
          onClick={() => signOut({ redirectUrl: '/sign-in' })}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: '8px',
            border: '1px solid var(--color-border)',
            backgroundColor: 'transparent',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-body)',
            fontSize: '13.5px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background-color 0.12s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
