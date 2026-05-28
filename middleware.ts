import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/pending(.*)',
  '/access-denied(.*)',
  '/api/auth/webhook(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return NextResponse.next();

  const { sessionClaims } = await auth.protect();

  const meta = sessionClaims?.publicMetadata as {
    approved?: boolean;
    status?: string;
  } | undefined;

  if (meta?.status === 'pending') {
    return NextResponse.redirect(new URL('/pending', req.url));
  }
  if (meta?.status === 'denied') {
    return NextResponse.redirect(new URL('/access-denied', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
