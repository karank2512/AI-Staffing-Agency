import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { SessionContext } from "@/server/auth/types";

/**
 * Test isolation is per-organization: every DB-backed test creates its own org and deletes it afterwards
 * (all tenant tables cascade from Organization). Never assert on global table counts, and always pass
 * `organizationId` to queue-wide functions (claimNextRun / tickScheduler / recoverStaleRuns).
 */
export async function createTestOrg(label = "test") {
  const suffix = randomUUID().slice(0, 8);
  const organization = await db.organization.create({
    data: { name: `${label}-${suffix}`, slug: `${label}-${suffix}` },
  });
  const user = await db.user.create({
    data: {
      organizationId: organization.id,
      email: `${label}-${suffix}@example.test`,
      name: "Test User",
      passwordHash: "not-a-real-hash",
      role: "OWNER",
    },
  });
  const session: SessionContext = {
    userId: user.id,
    organizationId: organization.id,
    organizationName: organization.name,
    role: "OWNER",
    name: user.name,
    email: user.email,
  };
  return {
    organization,
    user,
    session,
    cleanup: async () => {
      await db.organization.delete({ where: { id: organization.id } });
    },
  };
}
