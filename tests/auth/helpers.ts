import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { createTestOrg } from "../helpers/factory";

export const TEST_PASSWORD = "s3cret-Passphrase!";

/** A throwaway org whose user can really sign in (the shared factory stores a placeholder hash). */
export async function createOrgWithPassword(label: string, password = TEST_PASSWORD) {
  const org = await createTestOrg(label);
  await db.user.updateMany({
    where: { id: org.user.id, organizationId: org.organization.id },
    data: { passwordHash: await hashPassword(password) },
  });
  return org;
}
