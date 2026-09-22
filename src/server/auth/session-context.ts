import { db } from "@/server/db";
import type { SessionContext } from "./types";

/** What the session token claims about its holder. Only ever trusted after this module re-checks it. */
export interface SessionIdentity {
  userId: string;
  organizationId: string;
  /**
   * The `sessionVersion` the token was minted with. Tokens issued before this phase carry none; treat that
   * as stale so everyone signs in again once rather than holding an unrevocable 30-day cookie.
   */
  sessionVersion: number | undefined;
}

/**
 * Turn the identity claimed by a session token into a fresh SessionContext. No next-auth import (unit-testable).
 *
 * The token is only trusted for *who* the caller is; name, role and organization are re-read on every
 * request so role changes apply immediately. It resolves to `null` — i.e. signed out — when the user is gone
 * (deleted, re-seeded database), has been disabled (removed from the workspace), or when the token's
 * `sessionVersion` is behind the user's. That last check is how "sign out everywhere", a password change,
 * a role change and member removal revoke live sessions without a server-side session store.
 */
export async function loadSessionContext(identity: SessionIdentity): Promise<SessionContext | null> {
  if (typeof identity.sessionVersion !== "number") return null;

  const user = await db.user.findFirst({
    where: {
      id: identity.userId,
      organizationId: identity.organizationId,
      sessionVersion: identity.sessionVersion,
      disabledAt: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });
  if (!user) return null;

  return {
    userId: user.id,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    role: user.role,
    name: user.name,
    email: user.email,
  };
}
