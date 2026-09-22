import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { RATE_RULES, hashEmail, resetLimit } from "@/server/security";
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

/** Store a hash at a specific (legacy) bcrypt cost, to exercise the rehash-on-sign-in path. */
export async function setPasswordHashAtCost(userId: string, password: string, rounds: number): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, rounds) } });
}

/**
 * Run `fn` with the limiter live. `tests/setup/env.ts` disables it globally (the shared "unknown" IP bucket
 * would otherwise lock after a few dozen sign-in tests), so rate-limit tests opt back in here and restore
 * the flag — and their own buckets — afterwards.
 */
export async function withRateLimiting<T>(subjects: { emails?: string[]; ips?: string[]; userIds?: string[] }, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.RATE_LIMIT_DISABLED;
  delete process.env.RATE_LIMIT_DISABLED;
  try {
    return await fn();
  } finally {
    for (const email of subjects.emails ?? []) await resetLimit(RATE_RULES.signInAccount, hashEmail(email));
    for (const ip of subjects.ips ?? []) {
      await resetLimit(RATE_RULES.signInIp, ip);
      await resetLimit(RATE_RULES.signUpIp, ip);
      await resetLimit(RATE_RULES.inviteAcceptIp, ip);
    }
    for (const userId of subjects.userIds ?? []) await resetLimit(RATE_RULES.passwordChangeUser, userId);
    if (previous === undefined) delete process.env.RATE_LIMIT_DISABLED;
    else process.env.RATE_LIMIT_DISABLED = previous;
  }
}

/** A unique, syntactically valid client IP so parallel tests never share a rate-limit bucket. */
export function uniqueIp(): string {
  const hex = randomUUID().replace(/-/g, "").slice(0, 16);
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}::${hex.slice(8, 12)}`;
}

/** A unique address that certainly has no account. */
export function unknownEmail(label = "nobody"): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}
