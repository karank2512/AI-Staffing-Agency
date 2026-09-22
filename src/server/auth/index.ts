import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_EXPIRED_SIGN_IN_PATH, SIGN_IN_PATH } from "./access";
import { authConfig } from "./auth.config";
import { authorizeCredentials } from "./authorize";
import { loadSessionContext } from "./session-context";
import type { SessionContext } from "./types";

/**
 * Auth.js v5 entry point — APP CODE ONLY (pages, layouts, server actions, route handlers).
 * Server modules take a `SessionContext` argument instead; tests and the seed import `./password`
 * and `./authorize` directly so they never load next-auth.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      // Returning null makes Auth.js throw CredentialsSignin, which signInAction maps to a friendly message.
      async authorize(credentials) {
        const { email, password } = credentials ?? {};
        if (typeof email !== "string" || typeof password !== "string") return null;
        return authorizeCredentials(email, password);
      },
    }),
  ],
});

type SessionLookup =
  | { status: "ok"; session: SessionContext }
  | { status: "anonymous" }
  /** Valid cookie, but its user is gone (e.g. the database was re-seeded). */
  | { status: "stale" };

/** Deduplicated per render pass: the layout and the page both call requireSession(). */
const lookupSession = cache(async (): Promise<SessionLookup> => {
  const session = await auth();
  const userId = session?.user?.id;
  const organizationId = session?.user?.organizationId;
  if (!userId || !organizationId) return { status: "anonymous" };

  const context = await loadSessionContext({ userId, organizationId });
  return context ? { status: "ok", session: context } : { status: "stale" };
});

/** The caller's org-scoped identity, re-verified against the database; `null` when signed out or stale. */
export async function getSession(): Promise<SessionContext | null> {
  const lookup = await lookupSession();
  return lookup.status === "ok" ? lookup.session : null;
}

/**
 * For pages, layouts and server actions. Route handlers under /api use getSession() and answer 401 instead.
 * A stale cookie is sent to the sign-in page with a flag so the middleware (which can only see the cookie)
 * does not bounce the visitor straight back into the app.
 */
export async function requireSession(): Promise<SessionContext> {
  const lookup = await lookupSession();
  if (lookup.status === "ok") return lookup.session;
  redirect(lookup.status === "stale" ? SESSION_EXPIRED_SIGN_IN_PATH : SIGN_IN_PATH);
}

export { hashPassword, verifyPassword } from "./password";
export { DEFAULT_SIGNED_IN_PATH, SESSION_EXPIRED_PARAM, SIGN_IN_PATH, safeCallbackUrl } from "./access";
export type { SessionContext } from "./types";
