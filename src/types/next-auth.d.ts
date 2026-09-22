import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * Auth.js module augmentation: the identity fields our JWT and session carry.
 * `authorizeCredentials()` returns the `User` shape; the jwt callback copies it onto the token as
 * `userId` / `organizationId` / `role`; the session callback copies the token onto `session.user`.
 */
declare module "next-auth" {
  interface User {
    organizationId: string;
    role: UserRole;
  }

  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

// `next-auth/jwt` only re-exports `@auth/core/jwt`; the interface has to be augmented where it is declared.
declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
    organizationId?: string;
    role?: UserRole;
  }
}
