import NextAuth from "next-auth";
import { authConfig } from "@/server/auth/auth.config";

/**
 * Runs on the Edge runtime, so it is built from the edge-safe config only (no Prisma / bcrypt):
 * it verifies the session JWT and applies the `authorized` callback —
 *   unauthenticated page request   → redirect to /sign-in?callbackUrl=…
 *   unauthenticated /api/* request → 401 JSON (except /api/auth/*)
 *   signed-in visitor on /sign-in  → redirect into the app
 * Whether the user row still exists is checked later by getSession()/requireSession() (Node runtime).
 */
export default NextAuth(authConfig).auth;

export const config = {
  // Everything except Next.js internals, Auth.js' own endpoints and public static assets. The extension list is
  // explicit (rather than "anything with a dot") so a future route like /api/…/export.csv stays protected.
  matcher: [
    "/((?!_next/static|_next/image|api/auth/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest|map|woff|woff2|ttf)$).*)",
  ],
};
