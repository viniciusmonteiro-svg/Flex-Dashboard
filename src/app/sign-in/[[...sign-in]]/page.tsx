'use client';

import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        backgroundColor: 'var(--color-primary)',
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0,180,216,0.12) 0%, transparent 70%)',
      }}
    >
      {/* Left branding panel */}
      <div
        style={{
          flex: '0 0 400px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '60px 48px',
          borderRight: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '28px',
            color: '#FFFFFF',
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            marginBottom: '10px',
          }}
        >
          Flex Dental
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: '52px',
          }}
        >
          FP&amp;A Dashboard
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '15px',
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.75,
            maxWidth: '290px',
          }}
        >
          Marketing spend analytics, channel economics, and pipeline reporting — all in one place.
        </div>
        <div
          style={{
            width: '36px',
            height: '3px',
            backgroundColor: 'var(--color-accent)',
            borderRadius: '2px',
            marginTop: '44px',
          }}
        />
      </div>

      {/* Right sign-in panel */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
        }}
      >
        <SignIn
          appearance={{
            variables: {
              colorPrimary: '#00B4D8',
              colorBackground: '#FFFFFF',
              colorText: '#062C43',
              colorTextSecondary: '#5A7A8C',
              colorInputBackground: '#F0F6FA',
              colorInputText: '#062C43',
              borderRadius: '10px',
            },
            elements: {
              rootBox: 'w-full max-w-sm',
              card: 'shadow-2xl',
              footerActionLink: 'text-[var(--color-accent)]',
            },
          }}
        />
      </div>
    </div>
  );
}
