import type { UserRole } from "@prisma/client";
import { db } from "@/server/db";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "./password";

/** What a successful credential check yields — exactly the fields the JWT needs, never the hash. */
export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: UserRole;
}

/**
 * bcrypt hash (cost 10 = BCRYPT_ROUNDS) of a discarded random string. Unknown e-mails are compared against it
 * so "no such user" costs the same as "wrong password" and response time does not reveal which accounts exist.
 */
export const TIMING_EQUALIZER_HASH = "$2b$10$PeNlr.WbWytFpcUnpirMYehTgrECVU4hNUZ1ktBnQUw..ZryWMkjW";

/** E-mails are stored lowercase; sign-in is forgiving about case and stray whitespace. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Credential check behind the Auth.js Credentials provider. No next-auth import, so it is unit-testable.
 *
 * This is the one lookup that cannot be organization-scoped: the caller has no organization until we know
 * who they are. `User.email` is globally unique, and the organization is derived from the matched row.
 */
export async function authorizeCredentials(email: string, password: string): Promise<AuthorizedUser | null> {
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalized = normalizeEmail(email);
  if (!normalized || !password || password.length > MAX_PASSWORD_LENGTH) return null;

  const user = await db.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, name: true, organizationId: true, role: true, passwordHash: true },
  });

  // Always pay for one bcrypt compare, whether or not the user exists.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? TIMING_EQUALIZER_HASH);
  if (!user || !passwordOk) return null;

  return { id: user.id, email: user.email, name: user.name, organizationId: user.organizationId, role: user.role };
}
