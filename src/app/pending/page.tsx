'use client';

import { SignOutButton } from '@clerk/nextjs';

export default function PendingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm px-8 py-10 text-center">
        <h1 className="text-lg font-bold text-gray-900 mb-2">Access Requested</h1>
        <p className="text-sm text-gray-500 mb-8">
          Your request has been sent to the administrator.
          You will receive an email when your access is approved.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <button className="w-full rounded-lg border border-gray-200 text-gray-500 text-sm font-medium py-2.5 hover:bg-gray-50 transition-colors">
            Sign out
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
