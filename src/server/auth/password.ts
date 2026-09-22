import bcrypt from "bcryptjs";

/**
 * Password hashing. Deliberately free of next-auth / Next.js imports so the seed script and unit tests
 * can use it without pulling in the framework.
 */

/** bcrypt cost factor. 10 ≈ 50–80 ms per hash with bcryptjs — fine for interactive sign-in. */
export const BCRYPT_ROUNDS = 10;

/** bcrypt only reads the first 72 bytes; anything far beyond that is abuse, not a password. */
export const MAX_PASSWORD_LENGTH = 256;

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

/** Never throws: a malformed or legacy hash simply fails verification. */
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(pw, hash);
  } catch {
    return false;
  }
}
