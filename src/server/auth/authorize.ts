import type { UserRole } from "@prisma/client";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { RATE_RULES, hashEmail, hit, isLocked, lock, recordSecurityEvent, resetLimit } from "@/server/security";
import {
  MAX_PASSWORD_LENGTH,
  burnPasswordCompare,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";

/** What a successful credential check yields — exactly the fields the JWT needs, never the hash. */
export interface AuthorizedUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: UserRole;
  /** Copied into the token; `loadSessionContext` rejects tokens carrying an older value. */
  sessionVersion: number;
}

/** Where the attempt came from. Derived from the real request headers, never from the submitted form. */
export interface SignInContext {
  ip: string;
  userAgent: string | null;
}

/**
 * Thrown when the account or the client IP is locked out. `index.ts` translates it into an Auth.js
 * `CredentialsSignin` subclass with code `rate_limited`; keeping it framework-free leaves this module
 * unit-testable without next-auth.
 */
export class SignInThrottledError extends Error {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number) {
    super("Too many sign-in attempts");
    this.name = "SignInThrottledError";
    this.retryAfterSec = retryAfterSec;
  }
}

/** E-mails are stored lowercase; sign-in is forgiving about case and stray whitespace. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const NO_CONTEXT: SignInContext = { ip: "unknown", userAgent: null };

/**
 * Credential check behind the Auth.js Credentials provider — the single choke point both sign-in entry
 * points share (our server action AND a direct POST to /api/auth/callback/credentials).
 *
 * This is the one lookup that cannot be organization-scoped: the caller has no organization until we know
 * who they are. `User.email` is globally unique, and the organization is derived from the matched row.
 *
 * Every branch costs exactly one bcrypt compare, so "unknown account", "wrong password", "locked out",
 * "disabled user" and "demo workspace" are indistinguishable from the outside.
 */
export async function authorizeCredentials(
  email: string,
  password: string,
  ctx: SignInContext = NO_CONTEXT,
): Promise<AuthorizedUser | null> {
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalized = normalizeEmail(email);
  if (!normalized || !password || password.length > MAX_PASSWORD_LENGTH) return null;

  const emailHash = hashEmail(normalized);
  const audit = { email: normalized, ip: ctx.ip, userAgent: ctx.userAgent };

  // Locks are checked BEFORE the compare so a locked account never reveals whether the password was right,
  // but the compare still runs (below) so a lockout costs the same time as an ordinary failure.
  const [accountLock, ipLock] = await Promise.all([
    isLocked(RATE_RULES.signInAccount, emailHash),
    isLocked(RATE_RULES.signInIp, ctx.ip),
  ]);

  const user = accountLock.locked || ipLock.locked
    ? null
    : await db.user.findUnique({
        where: { email: normalized },
        select: {
          id: true,
          email: true,
          name: true,
          organizationId: true,
          role: true,
          passwordHash: true,
          sessionVersion: true,
          disabledAt: true,
          organization: { select: { isDemo: true } },
        },
      });

  // Always pay for one bcrypt compare, whether or not the user exists and whether or not we are locked out.
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : await burnPasswordCompare(password);

  if (accountLock.locked || ipLock.locked) {
    // The attempt still costs us a bcrypt compare, so it still counts against the IP rule — otherwise
    // hammering one locked account would be free CPU. The account bucket is deliberately NOT touched: its
    // lockout is exponential, and re-locking on every attempt would let anyone freeze a victim out for days.
    if (!ipLock.locked) await countIpFailure(ctx, audit);

    const retryAfterSec = Math.max(accountLock.retryAfterSec, ipLock.retryAfterSec);
    await recordSecurityEvent({ type: "SIGN_IN_THROTTLED", ...audit, metadata: { retryAfterSec } });
    throw new SignInThrottledError(retryAfterSec);
  }

  if (!user || !passwordOk) {
    // A failure against a known account is attributed to that workspace so it shows up in their audit feed;
    // an unknown address has no workspace to attribute it to.
    await registerFailure(
      emailHash,
      ctx,
      user ? { ...audit, userId: user.id, organizationId: user.organizationId } : audit,
    );
    return null;
  }

  // Refusals below are real sign-in failures: count them too, so a disabled or demo account is not a free
  // oracle for password guessing.
  if (user.disabledAt) {
    await registerFailure(emailHash, ctx, { ...audit, userId: user.id, organizationId: user.organizationId });
    return null;
  }
  if (user.organization.isDemo && !config.auth.demoMode) {
    await registerFailure(emailHash, ctx, { ...audit, organizationId: user.organizationId });
    return null;
  }

  await onSuccess(user, password, emailHash);
  await recordSecurityEvent({
    type: "SIGN_IN_SUCCEEDED",
    organizationId: user.organizationId,
    userId: user.id,
    ...audit,
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organizationId: user.organizationId,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}

type AuditFields = { email: string; ip: string; userAgent: string | null; userId?: string; organizationId?: string };

/** Count the failure against both buckets and lock whichever one just tipped over its limit. */
async function registerFailure(emailHash: string, ctx: SignInContext, audit: AuditFields): Promise<void> {
  const [account] = await Promise.all([hit(RATE_RULES.signInAccount, emailHash), countIpFailure(ctx, audit)]);

  await recordSecurityEvent({ type: "SIGN_IN_FAILED", ...audit, metadata: { attempts: account.count } });

  if (!account.allowed) {
    const { lockedUntil } = await lock(RATE_RULES.signInAccount, emailHash);
    await recordSecurityEvent({
      type: "ACCOUNT_LOCKED",
      ...audit,
      metadata: { scope: "account", lockedUntil: lockedUntil.toISOString() },
    });
  }
}

/** One failed attempt from this client address; locks the address once it runs past the IP rule. */
async function countIpFailure(ctx: SignInContext, audit: AuditFields): Promise<void> {
  const byIp = await hit(RATE_RULES.signInIp, ctx.ip);
  if (byIp.allowed) return;
  const { lockedUntil } = await lock(RATE_RULES.signInIp, ctx.ip);
  await recordSecurityEvent({
    type: "ACCOUNT_LOCKED",
    ...audit,
    metadata: { scope: "ip", lockedUntil: lockedUntil.toISOString() },
  });
}

/**
 * Post-success bookkeeping: clear the account's failure bucket, stamp lastSignInAt, and transparently
 * upgrade a hash that predates the current bcrypt cost (this is the only moment the plaintext exists).
 */
async function onSuccess(
  user: { id: string; organizationId: string; passwordHash: string },
  password: string,
  emailHash: string,
): Promise<void> {
  await resetLimit(RATE_RULES.signInAccount, emailHash);

  const rehash = needsRehash(user.passwordHash) ? await hashPassword(password) : null;
  await db.user.update({
    where: { id: user.id },
    data: { lastSignInAt: new Date(), ...(rehash ? { passwordHash: rehash } : {}) },
  });

  if (rehash) {
    await recordSecurityEvent({
      type: "PASSWORD_REHASHED",
      userId: user.id,
      organizationId: user.organizationId,
    });
  }
}
