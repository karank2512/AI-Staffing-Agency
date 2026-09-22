import { db } from "@/server/db";
import type { SessionContext } from "./types";

/**
 * Turn the identity claimed by a session token into a fresh SessionContext. No next-auth import (unit-testable).
 *
 * The token is only trusted for *who* the caller is; name, role and organization are re-read on every
 * request so role changes apply immediately, and a token whose user no longer exists in that organization
 * (deleted user, re-seeded database) resolves to `null` instead of a ghost session.
 */
export async function loadSessionContext(identity: {
  userId: string;
  organizationId: string;
}): Promise<SessionContext | null> {
  const user = await db.user.findFirst({
    where: { id: identity.userId, organizationId: identity.organizationId },
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
