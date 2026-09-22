import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * Auth.js module augmentation: the identity fields our JWT and session carry.
 * `authorizeCredentials()` returns the `User` shape; the jwt callback copies it onto the token as
 * `userId` / `organizationId` / `role` / `sv` (+ `authAt` for the absolute session lifetime); the session
 * callback copies the token onto `session.user`.
 */
declare module "next-auth" {
  interface User {
    organizationId: string;
    role: UserRole;
    sessionVersion: number;
  }

  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: UserRole;
      /**
       * Revocation counter: `loadSessionContext` refuses a token whose value is behind the user's.
       * Absent on cookies minted before this phase — those are treated as stale (forced re-login).
       */
      sessionVersion?: number;
    } & DefaultSession["user"];
  }
}

// `next-auth/jwt` only re-exports `@auth/core/jwt`; the interface has to be augmented where it is declared.
declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
    organizationId?: string;
    role?: UserRole;
    /** User.sessionVersion at sign-in. */
    sv?: number;
    /** Unix seconds at which credentials were last presented — the absolute session clock. */
    authAt?: number;
  }
}
