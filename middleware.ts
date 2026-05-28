import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Plain pass-through — no Clerk middleware while diagnosing Vercel deployment.
// Auth will be re-enabled once the base app is confirmed working on Vercel.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
