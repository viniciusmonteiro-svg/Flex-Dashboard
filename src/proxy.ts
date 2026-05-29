import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Routes that do NOT require authentication
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pending(.*)",
  "/access-denied(.*)",
  "/checking(.*)",         // race-condition buffer — must be public
  "/api/auth/webhook(.*)",
  "/api/auth/status(.*)",  // polling endpoint — must be public
]);

const isAdminRoute = createRouteMatcher(["/user-management(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return NextResponse.next();

  const { sessionClaims } = await auth.protect();

  const meta = (sessionClaims?.publicMetadata ?? {}) as {
    status?: string;
    role?: string;
  };

  // Empty status = webhook hasn't fired yet (race condition on first sign-in).
  // Do NOT treat empty status as pending — send to /checking instead.
  // /checking polls /api/auth/status (which uses currentUser() for live data)
  // until the webhook completes, then does a full-page reload to get a fresh JWT.
  if (!meta.status) {
    return NextResponse.redirect(new URL("/checking", req.url));
  }

  if (meta.status === "denied") {
    return NextResponse.redirect(new URL("/access-denied", req.url));
  }

  if (meta.status === "pending") {
    return NextResponse.redirect(new URL("/pending", req.url));
  }

  if (isAdminRoute(req) && meta.role !== "admin") {
    return NextResponse.redirect(new URL("/access-denied", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
