import type { NextAuthConfig } from "next-auth";
import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { SIGN_IN_PATH, decideAccess } from "./access";

/**
 * Edge-safe half of the Auth.js configuration, shared by `src/middleware.ts` and `index.ts`.
 * It must never import Prisma or bcrypt (the middleware runs on the Edge runtime); the Credentials
 * provider that needs them is added in `index.ts`. The callbacks here only copy fields around.
 */
export const authConfig = {
  pages: { signIn: SIGN_IN_PATH },
  session: {
    strategy: "jwt",
    /** Sliding window: an idle cookie stops working after this long. */
    maxAge: config.auth.sessionMaxAgeSec,
    /** How often an active session's cookie is re-issued. */
    updateAge: config.auth.sessionUpdateAgeSec,
  },
  providers: [],
  callbacks: {
    /** Middleware gate — routing rules live in `access.ts`. */
    authorized({ request, auth }) {
      const { pathname, search } = request.nextUrl;
      const decision = decideAccess({
        pathname,
        search,
        method: request.method,
        isAuthenticated: Boolean(auth?.user?.id && auth.user.organizationId),
      });
      switch (decision.kind) {
        case "allow":
          return true;
        case "unauthorized":
          return NextResponse.json({ error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });
        case "redirect":
          return NextResponse.redirect(new URL(decision.to, request.nextUrl.origin));
      }
    },

    /**
     * `user` is only present on sign-in: persist the identity onto the token once, together with the
     * revocation counter and the moment credentials were presented.
     *
     * Returning `null` clears the session in Auth.js v5 — that is how the ABSOLUTE lifetime is enforced:
     * `maxAge` alone only measures idleness, so an active tab could otherwise renew forever.
     */
    jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
        token.organizationId = user.organizationId;
        token.role = user.role;
        token.sv = user.sessionVersion;
        token.authAt = Math.floor(Date.now() / 1000);
      }
      if (typeof token.authAt === "number" && Date.now() / 1000 - token.authAt > config.auth.sessionAbsoluteMaxSec) {
        return null;
      }
      return token;
    },

    /**
     * A token without our identity fields (foreign or pre-upgrade cookie) yields a session without
     * `user.id`, which every consumer — the middleware gate and `getSession()` — treats as signed out.
     */
    session({ session, token }) {
      if (token.userId && token.organizationId && token.role) {
        session.user.id = token.userId;
        session.user.organizationId = token.organizationId;
        session.user.role = token.role;
        // Left undefined for pre-upgrade cookies; loadSessionContext then treats the session as stale.
        if (typeof token.sv === "number") session.user.sessionVersion = token.sv;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
