import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "@/server/config";

/**
 * Password hashing. Deliberately free of next-auth / Next.js imports so the seed script and unit tests
 * can use it without pulling in the framework.
 */

/**
 * bcrypt cost factor for NEW hashes (config.auth.bcryptRounds, currently 12). Existing hashes at a lower
 * cost keep verifying and are transparently upgraded on the next successful sign-in (see `needsRehash`).
 */
export const bcryptRounds = (): number => config.auth.bcryptRounds;

/** bcrypt only mixes the first 72 bytes of the password; the policy refuses anything longer. */
export const MAX_PASSWORD_BYTES = 72;

/** Upper bound on what sign-in will even look at, so a huge body can't be turned into bcrypt work. */
export const MAX_PASSWORD_LENGTH = 256;

/** UTF-8 byte length — what bcrypt actually consumes (an emoji is 4 bytes, not 1 character). */
export function passwordByteLength(pw: string): number {
  return Buffer.byteLength(pw, "utf8");
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, bcryptRounds());
}

/** Never throws: a malformed or legacy hash simply fails verification. */
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}

/**
 * True when the stored hash was produced with a weaker cost than we use today (e.g. the cost-10 hashes
 * written before this phase). Callers re-hash the plaintext they just verified — the only moment it exists.
 * An unparseable hash is left alone: rewriting it would lock the account out of its own password.
 */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < bcryptRounds();
  } catch {
    return false;
  }
}

/**
 * A hash of a random, discarded string at the CURRENT cost. Unknown e-mails and locked accounts are compared
 * against it so every sign-in attempt costs the same bcrypt work and response time reveals nothing.
 * Computed once per cost factor and reused (the value itself is never a valid password).
 */
let dummy: { rounds: number; hash: Promise<string> } | null = null;

export function timingEqualizerHash(): Promise<string> {
  const rounds = bcryptRounds();
  if (!dummy || dummy.rounds !== rounds) {
    dummy = { rounds, hash: hashPassword(randomBytes(32).toString("hex")) };
  }
  return dummy.hash;
}

/** Spend exactly one bcrypt compare without revealing anything. Always resolves false. */
export async function burnPasswordCompare(pw: string): Promise<false> {
  await verifyPassword(pw, await timingEqualizerHash());
  return false;
}
