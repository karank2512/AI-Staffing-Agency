import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { hashPassword } from "@/server/auth/password";
import { RATE_RULES, enforce, recordSecurityEvent } from "@/server/security";
import { SignUpInputSchema, type SignUpInput } from "./inputs";
import { assertPasswordPolicy } from "./password-policy";

/** Self-serve workspace creation: one transaction that makes an Organization and its first OWNER. */

export interface SignUpContext {
  ip: string;
  userAgent: string | null;
}

/**
 * Deliberately vague: an attacker must not learn from sign-up whether an address already has an account.
 * The response also costs one bcrypt hash either way (we hash before touching the database).
 */
const DUPLICATE_MESSAGE =
  "We couldn't create an account with those details. If you already have one, sign in instead.";

const CLOSED_MESSAGE = "Sign-up is closed; ask your workspace admin for an invite";

/** URL-safe, human-readable stem for the workspace slug. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    // Drop the combining marks NFKD just split off, so "Ünïcode" becomes "unicode", not "u-ni-code".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "workspace";
}

/** Constant-time comparison of two secrets of unknown length (hash first so the buffers always match). */
function secretsMatch(a: string, b: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** Throws FORBIDDEN unless the deployment's SIGNUP_MODE lets this request through. */
function assertSignupAllowed(inviteCode: string | undefined): void {
  const mode = config.auth.signupMode;
  if (mode === "open") return;
  if (mode === "closed") throw new AppError("FORBIDDEN", CLOSED_MESSAGE);

  // mode === "invite": a shared code stands in for the per-person invitations in `invitations.ts`.
  const expected = config.auth.signupInviteCode;
  if (!expected) throw new AppError("FORBIDDEN", CLOSED_MESSAGE);
  if (!inviteCode || !secretsMatch(inviteCode, expected)) {
    throw new AppError("FORBIDDEN", "That invite code is not valid.");
  }
}

export async function signUp(
  input: SignUpInput,
  ctx: SignUpContext,
): Promise<{ userId: string; organizationId: string }> {
  await enforce(RATE_RULES.signUpIp, ctx.ip);

  const { name, email, password, organizationName, inviteCode } = SignUpInputSchema.parse(input);
  assertSignupAllowed(inviteCode);
  assertPasswordPolicy(password, { email, name, organizationName });

  // Hash BEFORE any lookup so "address already taken" and "account created" cost the same wall-clock time.
  const passwordHash = await hashPassword(password);
  const now = new Date();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await db.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: organizationName,
            slug: `${slugify(organizationName)}-${randomBytes(3).toString("hex")}`,
            // Null means "use the platform default"; an owner can set a real cap in workspace settings.
            monthlyBudgetUsd: null,
          },
          select: { id: true },
        });
        const user = await tx.user.create({
          data: {
            organizationId: organization.id,
            email,
            name,
            passwordHash,
            role: "OWNER",
            sessionVersion: 0,
            passwordChangedAt: now,
          },
          select: { id: true },
        });
        return { userId: user.id, organizationId: organization.id };
      });

      await recordSecurityEvent({
        type: "SIGN_UP",
        organizationId: created.organizationId,
        userId: created.userId,
        email,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { signupMode: config.auth.signupMode },
      });
      return created;
    } catch (e) {
      if (isUniqueViolation(e, "email")) throw new AppError("CONFLICT", DUPLICATE_MESSAGE);
      // A slug collision is pure bad luck (6 random hex chars); try again with a fresh suffix.
      if (isUniqueViolation(e, "slug")) continue;
      throw e;
    }
  }

  throw new AppError("INTERNAL", "We couldn't create the workspace. Please try again.");
}

function isUniqueViolation(e: unknown, field: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return fields.some((f) => f.toLowerCase().includes(field));
}
