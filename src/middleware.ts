import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Routes that do NOT require authentication
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/pending(.*)',
  '/access-denied(.*)',
  '/api/auth/webhook(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Let public routes through without any auth check
  if (isPublicRoute(req)) return NextResponse.next();

  // All other routes require the user to be signed in.
  // If not signed in, Clerk redirects to /sign-in automatically.
  // Status-based redirects (pending → /pending, denied → /access-denied)
  // are handled by requireAuth() inside each page's Server Component.
  await auth.protect();

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
