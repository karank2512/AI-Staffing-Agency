import { createHash, randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { hashPassword } from "@/server/auth/password";
import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { RATE_RULES, enforce, recordSecurityEvent } from "@/server/security";
import {
  AcceptInvitationInputSchema,
  CreateInvitationInputSchema,
  inviteTokenSchema,
  type AcceptInvitationInput,
  type CreateInvitationInput,
} from "./inputs";
import { assertPasswordPolicy } from "./password-policy";
import type { InvitationStatus, InvitationView } from "./views";

/**
 * Team invitations. There is no email provider in this phase, so `createInvitation` returns a link for the
 * admin to share out-of-band. The raw token exists only inside that link: we store sha256(token), so a dump
 * of the Invitation table cannot be replayed into accounts.
 */

const TOKEN_BYTES = 32;

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const baseUrl = () => config.publicUrl ?? "http://localhost:3000";

export function inviteUrlFor(token: string): string {
  return new URL(`/invite/${token}`, baseUrl()).toString();
}

function statusOf(
  invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): InvitationStatus {
  if (invitation.acceptedAt) return "accepted";
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt <= now) return "expired";
  return "pending";
}

export async function createInvitation(
  s: SessionContext,
  input: CreateInvitationInput,
): Promise<{ invitationId: string; inviteUrl: string; expiresAt: string }> {
  assertCan(s, "members.invite");
  await enforce(RATE_RULES.invitesCreateOrg, s.organizationId);
  const { email, role } = CreateInvitationInputSchema.parse(input);

  // Emails are globally unique, so an existing account anywhere makes the invitation unusable later —
  // say so now rather than at acceptance time.
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new AppError("CONFLICT", "That email address already has an account.");
  }

  const now = new Date();
  const pending = await db.invitation.findFirst({
    where: {
      organizationId: s.organizationId,
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (pending) throw new AppError("CONFLICT", "There is already a pending invite for that address.");

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(now.getTime() + config.auth.invitationTtlDays * 24 * 60 * 60 * 1000);

  const invitation = await db.invitation.create({
    data: {
      organizationId: s.organizationId,
      email,
      role,
      tokenHash: hashToken(token),
      invitedById: s.userId,
      expiresAt,
    },
    select: { id: true },
  });

  await recordSecurityEvent({
    type: "INVITE_CREATED",
    organizationId: s.organizationId,
    userId: s.userId,
    email,
    metadata: { invitationId: invitation.id, role },
  });

  return { invitationId: invitation.id, inviteUrl: inviteUrlFor(token), expiresAt: expiresAt.toISOString() };
}

export async function listInvitations(organizationId: string): Promise<InvitationView[]> {
  const rows = await db.invitation.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedBy: { select: { name: true } },
    },
  });

  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: statusOf(r, now),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    invitedByName: r.invitedBy.name,
  }));
}

export async function revokeInvitation(s: SessionContext, invitationId: string): Promise<void> {
  assertCan(s, "members.invite");

  const invitation = await db.invitation.findFirst({
    where: { id: invitationId, organizationId: s.organizationId },
    select: { id: true, email: true, acceptedAt: true, revokedAt: true },
  });
  if (!invitation) throw new AppError("NOT_FOUND", "That invite no longer exists.");
  if (invitation.acceptedAt) throw new AppError("CONFLICT", "That invite has already been accepted.");
  if (invitation.revokedAt) return;

  await db.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });

  await recordSecurityEvent({
    type: "INVITE_REVOKED",
    organizationId: s.organizationId,
    userId: s.userId,
    email: invitation.email,
    metadata: { invitationId: invitation.id },
  });
}

/**
 * What the invite page shows before anyone types anything. Unknown, expired, revoked and already-accepted
 * tokens all look the same from outside: `null`.
 */
export async function getInvitationByToken(
  token: string,
): Promise<{ organizationName: string; email: string; role: UserRole; expiresAt: string } | null> {
  const parsed = inviteTokenSchema.safeParse(token);
  if (!parsed.success) return null;

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(parsed.data) },
    select: {
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organization: { select: { name: true, suspendedAt: true } },
    },
  });
  if (!invitation) return null;
  if (statusOf(invitation, new Date()) !== "pending") return null;
  if (invitation.organization.suspendedAt) return null;

  return {
    organizationName: invitation.organization.name,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

export interface AcceptInvitationContext {
  ip: string;
  userAgent: string | null;
}

/**
 * Join an existing workspace. The invitation carries the email and the role, so neither is taken from the
 * form; the invitee only chooses their display name and password.
 */
export async function acceptInvitation(
  token: string,
  input: AcceptInvitationInput,
  ctx: AcceptInvitationContext,
): Promise<{ email: string }> {
  await enforce(RATE_RULES.inviteAcceptIp, ctx.ip);

  const parsedToken = inviteTokenSchema.safeParse(token);
  if (!parsedToken.success) throw new AppError("NOT_FOUND", "That invite link is not valid or has expired.");
  const { name, password } = AcceptInvitationInputSchema.parse(input);

  const tokenHash = hashToken(parsedToken.data);
  const invitation = await db.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organizationId: true,
      organization: { select: { name: true, suspendedAt: true } },
    },
  });
  if (!invitation || statusOf(invitation, new Date()) !== "pending" || invitation.organization.suspendedAt) {
    throw new AppError("NOT_FOUND", "That invite link is not valid or has expired.");
  }

  assertPasswordPolicy(password, {
    email: invitation.email,
    name,
    organizationName: invitation.organization.name,
  });
  const passwordHash = await hashPassword(password);
  const now = new Date();

  const userId = await db.$transaction(async (tx) => {
    // Claim the invitation first: a second, concurrent acceptance sees count 0 and rolls back.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claimed.count === 0) throw new AppError("CONFLICT", "That invite has already been used.");

    const user = await tx.user.create({
      data: {
        organizationId: invitation.organizationId,
        email: invitation.email,
        name,
        passwordHash,
        role: invitation.role,
        sessionVersion: 0,
        passwordChangedAt: now,
        // emailVerifiedAt stays null on purpose: with no mail provider the link is shared out-of-band,
        // so opening it proves nothing about who controls the address.
      },
      select: { id: true },
    });
    return user.id;
  });

  await recordSecurityEvent({
    type: "INVITE_ACCEPTED",
    organizationId: invitation.organizationId,
    userId,
    email: invitation.email,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { invitationId: invitation.id, role: invitation.role },
  });

  return { email: invitation.email };
}
