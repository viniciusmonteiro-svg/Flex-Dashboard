'use client';

import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <SignIn
        appearance={{
          elements: {
            rootBox: 'w-full max-w-sm',
            card:    'shadow-sm border border-gray-200 rounded-2xl',
          },
        }}
      />
    </div>
  );
}
