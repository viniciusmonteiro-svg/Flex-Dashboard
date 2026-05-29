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

  // Clerk's default JWT template does NOT include publicMetadata, so
  // sessionClaims.publicMetadata is always {} here. We can only act on
  // values that are explicitly present. Empty status means either:
  //   (a) the JWT template doesn't expose publicMetadata (most common), or
  //   (b) the webhook hasn't fired yet for a brand-new user.
  // In both cases, fall through and let the page-level requireAuth() (which
  // calls currentUser() — the live Clerk API) do the real authorization.
  // Redirecting to /checking here causes an infinite loop because even a
  // fresh JWT from session.reload() won't contain publicMetadata.

  if (meta.status === "denied") {
    return NextResponse.redirect(new URL("/access-denied", req.url));
  }

  if (meta.status === "pending") {
    return NextResponse.redirect(new URL("/pending", req.url));
  }

  // Only enforce admin gate when role is actually present in the JWT.
  // If role is absent (template doesn't include it), requireAdmin() handles it.
  if (isAdminRoute(req) && meta.role && meta.role !== "admin") {
    return NextResponse.redirect(new URL("/access-denied", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
