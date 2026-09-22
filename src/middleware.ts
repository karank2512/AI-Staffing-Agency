import NextAuth from "next-auth";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authConfig } from "@/server/auth/auth.config";
import { CSP_NONCE_HEADER, LOCKED_DOWN_CSP, buildCsp, createNonce } from "@/server/security/csp";

/**
 * Runs on the Edge runtime, so it is built from the edge-safe config only (no Prisma / bcrypt).
 *
 * Two jobs:
 *  1. The Auth.js gate (`authorized` in auth.config.ts → decideAccess) —
 *       unauthenticated page request   → redirect to /sign-in?callbackUrl=…
 *       unauthenticated /api/* request → 401 JSON (except /api/auth/*)
 *       signed-in visitor on /sign-in  → redirect into the app
 *     Whether the user row still exists is checked later by getSession()/requireSession() (Node runtime).
 *  2. A per-request nonce-based Content-Security-Policy (INF-06). The nonce goes on the REQUEST headers so
 *     Next.js stamps its own inline bootstrap scripts with it (and the root layout reads `x-nonce`, which
 *     makes every route render dynamically); the policy itself goes on the response.
 */

const HEADER = "Content-Security-Policy";
const isDev = process.env.NODE_ENV !== "production";

/** Auth.js types `auth(handler)` for route handlers; in middleware Next.js passes a NextFetchEvent. */
type EdgeMiddleware = (request: NextRequest, event: NextFetchEvent) => Promise<Response>;

const gate = NextAuth(authConfig).auth((request) => {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, dev: isDev });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set(HEADER.toLowerCase(), csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(HEADER, csp);
  return response;
}) as unknown as EdgeMiddleware;

/**
 * When the gate answers with a redirect or a 401 it short-circuits the handler above, so those responses
 * would carry no policy at all. They contain no markup of ours, so they get the inert policy instead.
 */
export default async function middleware(request: NextRequest, event: NextFetchEvent): Promise<Response> {
  const response = (await gate(request, event)) as Response;
  if (response && !response.headers.has(HEADER)) response.headers.set(HEADER, LOCKED_DOWN_CSP);
  return response;
}

export const config = {
  // Everything except Next.js internals, Auth.js' own endpoints, the ops probes and public static assets.
  // The extension list is explicit (rather than "anything with a dot") so a future route like
  // /api/…/export.csv stays protected. "/", "/sign-up" and "/invite/*" are matched on purpose: decideAccess
  // decides what is public, and they still need a CSP.
  matcher: [
    "/((?!_next/static|_next/image|api/auth/|api/health|api/ready|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest|map|woff|woff2|ttf)$).*)",
  ],
};
