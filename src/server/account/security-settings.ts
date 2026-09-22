import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import type { SessionContext } from "@/server/auth/types";
import { RATE_RULES, enforce, recordSecurityEvent, requestContext } from "@/server/security";
import { ChangePasswordInputSchema, type ChangePasswordInput } from "./inputs";
import { assertPasswordPolicy } from "./password-policy";

/**
 * The two things a compromised account needs: rotate the password, and cut every session loose.
 * Both work by bumping `User.sessionVersion`, which `loadSessionContext` compares against the token on
 * every request — so other devices are signed out on their very next page load, with no session store.
 */

export async function changePassword(s: SessionContext, input: ChangePasswordInput): Promise<void> {
  await enforce(RATE_RULES.passwordChangeUser, s.userId);
  const { currentPassword, newPassword } = ChangePasswordInputSchema.parse(input);

  const user = await db.user.findFirst({
    where: { id: s.userId, organizationId: s.organizationId, disabledAt: null },
    select: { id: true, passwordHash: true, email: true, name: true },
  });
  if (!user) throw new AppError("NOT_FOUND", "Your account is no longer active.");

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError("VALIDATION", "Current password is incorrect.");
  }
  if (newPassword === currentPassword) {
    throw new AppError("VALIDATION", "The new password must be different from the current one.");
  }
  assertPasswordPolicy(newPassword, {
    email: user.email,
    name: user.name,
    organizationName: s.organizationName,
  });

  const passwordHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
  });

  const ctx = await requestContext();
  await recordSecurityEvent({
    type: "PASSWORD_CHANGED",
    organizationId: s.organizationId,
    userId: s.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

/** Revoke every session this user has anywhere, including the one that asked. */
export async function signOutEverywhere(s: SessionContext): Promise<void> {
  const updated = await db.user.updateMany({
    where: { id: s.userId, organizationId: s.organizationId },
    data: { sessionVersion: { increment: 1 } },
  });
  if (updated.count === 0) throw new AppError("NOT_FOUND", "Your account is no longer active.");

  const ctx = await requestContext();
  await recordSecurityEvent({
    type: "SESSIONS_REVOKED",
    organizationId: s.organizationId,
    userId: s.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}
