import type { UserRole } from "@prisma/client";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { recordSecurityEvent, requestContext } from "@/server/security";
import type { MemberView } from "./views";

/**
 * Workspace membership. Every mutation is OWNER-only (`members.manage`), org-scoped, and bumps the target's
 * `sessionVersion` so a demotion or removal takes effect on their next request rather than in 12 hours.
 *
 * Removal disables the row instead of deleting it: their runs, deliverables and approvals stay attributable.
 */

const ROLE_ORDER: Record<UserRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

export async function listMembers(organizationId: string): Promise<MemberView[]> {
  const users = await db.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true, role: true, lastSignInAt: true, disabledAt: true, createdAt: true },
  });

  return users
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
      disabled: u.disabledAt !== null,
      createdAt: u.createdAt.toISOString(),
    }))
    .sort(
      (a, b) =>
        Number(a.disabled) - Number(b.disabled) ||
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        a.name.localeCompare(b.name),
    );
}

/** The target user, guaranteed to be in the caller's organization. */
async function loadMember(organizationId: string, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, name: true, email: true, role: true, disabledAt: true },
  });
  if (!user) throw new AppError("NOT_FOUND", "That member is not part of this workspace.");
  return user;
}

/** Count of owners who can still sign in — the workspace must never drop to zero. */
async function activeOwnerCount(organizationId: string, excludingUserId: string): Promise<number> {
  return db.user.count({
    where: { organizationId, role: "OWNER", disabledAt: null, id: { not: excludingUserId } },
  });
}

export async function changeMemberRole(s: SessionContext, userId: string, role: UserRole): Promise<void> {
  assertCan(s, "members.manage");
  const target = await loadMember(s.organizationId, userId);
  if (target.role === role) return;
  if (target.disabledAt) throw new AppError("CONFLICT", "That member has been removed from the workspace.");

  if (target.role === "OWNER" && (await activeOwnerCount(s.organizationId, target.id)) === 0) {
    throw new AppError(
      "CONFLICT",
      "This workspace needs at least one owner. Make someone else an owner first.",
    );
  }

  await db.user.update({
    where: { id: target.id },
    // Their role is re-read on every request anyway; the bump forces it to happen immediately.
    data: { role, sessionVersion: { increment: 1 } },
  });

  const ctx = await requestContext();
  await recordSecurityEvent({
    type: "ROLE_CHANGED",
    organizationId: s.organizationId,
    userId: s.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { targetUserId: target.id, from: target.role, to: role },
  });
}

export async function removeMember(s: SessionContext, userId: string): Promise<void> {
  assertCan(s, "members.manage");
  if (userId === s.userId) {
    throw new AppError("CONFLICT", "You can't remove yourself. Ask another owner to do it.");
  }

  const target = await loadMember(s.organizationId, userId);
  if (target.disabledAt) return;

  if (target.role === "OWNER" && (await activeOwnerCount(s.organizationId, target.id)) === 0) {
    throw new AppError("CONFLICT", "This workspace needs at least one owner.");
  }

  await db.user.update({
    where: { id: target.id },
    data: { disabledAt: new Date(), sessionVersion: { increment: 1 } },
  });

  const ctx = await requestContext();
  await recordSecurityEvent({
    type: "MEMBER_REMOVED",
    organizationId: s.organizationId,
    userId: s.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { targetUserId: target.id, targetRole: target.role },
  });
}
