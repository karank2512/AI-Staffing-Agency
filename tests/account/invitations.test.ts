import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  getInvitationByToken,
  listInvitations,
  revokeInvitation,
} from "@/server/account";
import { authorizeCredentials } from "@/server/auth/authorize";
import type { SessionContext } from "@/server/auth/types";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { RATE_RULES } from "@/server/security";
import { createTestOrg } from "../helpers/factory";
import { dropOrgs, strongPassword, uniqueEmail, uniqueIp, withEnv, withRateLimiting } from "./helpers";

const ctx = () => ({ ip: uniqueIp(), userAgent: "vitest" });

/** The raw token is only ever in the link, so tests pull it back out of the URL. */
const tokenFrom = (inviteUrl: string) => inviteUrl.split("/invite/")[1] as string;

const demote = (session: SessionContext, role: SessionContext["role"]): SessionContext => ({ ...session, role });

describe("createInvitation", () => {
  it("stores only the hash of the token and returns a shareable link", async () => {
    const org = await createTestOrg("invite-create");
    try {
      const email = uniqueEmail("invitee");
      const invitation = await createInvitation(org.session, { email, role: "MEMBER" });

      const token = tokenFrom(invitation.inviteUrl);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(invitation.inviteUrl.startsWith("http")).toBe(true);

      const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.invitationId } });
      expect(row.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
      expect(row.tokenHash).not.toBe(token);
      expect(row.email).toBe(email);
      expect(row.role).toBe("MEMBER");
      expect(row.invitedById).toBe(org.user.id);

      const ttlDays = (row.expiresAt.getTime() - row.createdAt.getTime()) / (24 * 60 * 60 * 1000);
      expect(Math.round(ttlDays)).toBe(config.auth.invitationTtlDays);

      const events = await db.securityEvent.count({
        where: { organizationId: org.organization.id, type: "INVITE_CREATED" },
      });
      expect(events).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it("builds the link from the public URL when one is configured", async () => {
    const org = await createTestOrg("invite-url");
    try {
      await withEnv({ AUTH_URL: "https://app.example.com" }, async () => {
        const invitation = await createInvitation(org.session, { email: uniqueEmail(), role: "ADMIN" });
        expect(invitation.inviteUrl).toMatch(/^https:\/\/app\.example\.com\/invite\/[0-9a-f]{64}$/);
      });
    } finally {
      await org.cleanup();
    }
  });

  it("needs the members.invite permission (ADMIN or OWNER)", async () => {
    const org = await createTestOrg("invite-permission");
    try {
      await expect(
        createInvitation(demote(org.session, "MEMBER"), { email: uniqueEmail(), role: "MEMBER" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // An ADMIN may invite.
      await expect(
        createInvitation(demote(org.session, "ADMIN"), { email: uniqueEmail(), role: "MEMBER" }),
      ).resolves.toMatchObject({ inviteUrl: expect.any(String) });
    } finally {
      await org.cleanup();
    }
  });

  it("refuses an address that already has an account, and a duplicate pending invite", async () => {
    const org = await createTestOrg("invite-dupes");
    try {
      await expect(
        createInvitation(org.session, { email: org.user.email, role: "MEMBER" }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("already has an account") });

      const email = uniqueEmail();
      await createInvitation(org.session, { email, role: "MEMBER" });
      await expect(createInvitation(org.session, { email, role: "MEMBER" })).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("pending invite"),
      });
    } finally {
      await org.cleanup();
    }
  });

  it("cannot mint an OWNER invite", async () => {
    const org = await createTestOrg("invite-owner");
    try {
      await expect(
        createInvitation(org.session, { email: uniqueEmail(), role: "OWNER" as "ADMIN" }),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      await org.cleanup();
    }
  });

  it("rate-limits invitations per workspace", async () => {
    const org = await createTestOrg("invite-rate");
    try {
      await withRateLimiting({ orgIds: [org.organization.id] }, async () => {
        for (let i = 0; i < RATE_RULES.invitesCreateOrg.limit; i++) {
          await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
        }
        await expect(createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" })).rejects.toMatchObject({
          code: "LIMIT_EXCEEDED",
        });
      });
    } finally {
      await org.cleanup();
    }
  });
});

describe("getInvitationByToken", () => {
  it("describes a pending invitation without revealing the workspace's other data", async () => {
    const org = await createTestOrg("invite-lookup");
    try {
      const email = uniqueEmail();
      const invitation = await createInvitation(org.session, { email, role: "ADMIN" });
      const view = await getInvitationByToken(tokenFrom(invitation.inviteUrl));
      expect(view).toEqual({
        organizationName: org.organization.name,
        email,
        role: "ADMIN",
        expiresAt: invitation.expiresAt,
      });
    } finally {
      await org.cleanup();
    }
  });

  it("returns null for unknown, malformed, expired, revoked and accepted tokens alike", async () => {
    const org = await createTestOrg("invite-null");
    try {
      expect(await getInvitationByToken("f".repeat(64))).toBeNull();
      expect(await getInvitationByToken("not-a-token")).toBeNull();
      expect(await getInvitationByToken("")).toBeNull();

      const expired = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      await db.invitation.update({
        where: { id: expired.invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await getInvitationByToken(tokenFrom(expired.inviteUrl))).toBeNull();

      const revoked = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      await revokeInvitation(org.session, revoked.invitationId);
      expect(await getInvitationByToken(tokenFrom(revoked.inviteUrl))).toBeNull();

      const accepted = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      await db.invitation.update({ where: { id: accepted.invitationId }, data: { acceptedAt: new Date() } });
      expect(await getInvitationByToken(tokenFrom(accepted.inviteUrl))).toBeNull();
    } finally {
      await org.cleanup();
    }
  });
});

describe("acceptInvitation", () => {
  it("creates the user in the inviting workspace with the invited role, and marks the invite used", async () => {
    const org = await createTestOrg("invite-accept");
    try {
      const email = uniqueEmail("joiner");
      const password = strongPassword("mellow");
      const invitation = await createInvitation(org.session, { email, role: "ADMIN" });

      const result = await acceptInvitation(tokenFrom(invitation.inviteUrl), { name: "Jo Joiner", password }, ctx());
      expect(result).toEqual({ email });

      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({
        organizationId: org.organization.id,
        role: "ADMIN",
        name: "Jo Joiner",
        sessionVersion: 0,
        disabledAt: null,
      });

      // The new account works immediately.
      expect(await authorizeCredentials(email, password, ctx())).toMatchObject({
        organizationId: org.organization.id,
        role: "ADMIN",
      });

      const row = await db.invitation.findUniqueOrThrow({ where: { id: invitation.invitationId } });
      expect(row.acceptedAt).not.toBeNull();

      const events = await db.securityEvent.count({
        where: { organizationId: org.organization.id, type: "INVITE_ACCEPTED" },
      });
      expect(events).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it("cannot be replayed with the same link", async () => {
    const org = await createTestOrg("invite-replay");
    try {
      const invitation = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      const token = tokenFrom(invitation.inviteUrl);
      await acceptInvitation(token, { name: "First", password: strongPassword() }, ctx());

      await expect(
        acceptInvitation(token, { name: "Second", password: strongPassword() }, ctx()),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await org.cleanup();
    }
  });

  it("refuses expired and revoked links with the same message as an unknown one", async () => {
    const org = await createTestOrg("invite-refuse");
    try {
      const expired = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      await db.invitation.update({
        where: { id: expired.invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const revoked = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      await revokeInvitation(org.session, revoked.invitationId);

      const expectedMessage = "That invite link is not valid or has expired.";
      for (const token of [tokenFrom(expired.inviteUrl), tokenFrom(revoked.inviteUrl), "a".repeat(64), "nope"]) {
        await expect(
          acceptInvitation(token, { name: "Nope", password: strongPassword() }, ctx()),
        ).rejects.toMatchObject({ code: "NOT_FOUND", message: expectedMessage });
      }
    } finally {
      await org.cleanup();
    }
  });

  it("applies the password policy, leaving the invitation usable afterwards", async () => {
    const org = await createTestOrg("invite-policy");
    try {
      const invitation = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      const token = tokenFrom(invitation.inviteUrl);

      await expect(acceptInvitation(token, { name: "Jo", password: "password1234" }, ctx())).rejects.toMatchObject({
        code: "VALIDATION",
      });
      // A rejected attempt must not burn the invite.
      expect(await getInvitationByToken(token)).not.toBeNull();
      await expect(
        acceptInvitation(token, { name: "Jo", password: strongPassword() }, ctx()),
      ).resolves.toBeTruthy();
    } finally {
      await org.cleanup();
    }
  });

  it("rate-limits acceptance attempts per IP", async () => {
    const org = await createTestOrg("invite-accept-rate");
    const ip = uniqueIp();
    try {
      await withRateLimiting({ ips: [ip] }, async () => {
        for (let i = 0; i < RATE_RULES.inviteAcceptIp.limit; i++) {
          await expect(
            acceptInvitation("b".repeat(64), { name: "Jo", password: strongPassword() }, { ip, userAgent: null }),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        }
        await expect(
          acceptInvitation("b".repeat(64), { name: "Jo", password: strongPassword() }, { ip, userAgent: null }),
        ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
      });
    } finally {
      await org.cleanup();
    }
  });
});

describe("listInvitations / revokeInvitation", () => {
  it("reports each invitation's status and who sent it", async () => {
    const org = await createTestOrg("invite-list");
    try {
      const pending = await createInvitation(org.session, { email: uniqueEmail("pending"), role: "MEMBER" });
      const revoked = await createInvitation(org.session, { email: uniqueEmail("revoked"), role: "MEMBER" });
      await revokeInvitation(org.session, revoked.invitationId);
      const expired = await createInvitation(org.session, { email: uniqueEmail("expired"), role: "MEMBER" });
      await db.invitation.update({
        where: { id: expired.invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const accepted = await createInvitation(org.session, { email: uniqueEmail("accepted"), role: "MEMBER" });
      await acceptInvitation(tokenFrom(accepted.inviteUrl), { name: "Jo", password: strongPassword() }, ctx());

      const rows = await listInvitations(org.organization.id);
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(pending.invitationId)?.status).toBe("pending");
      expect(byId.get(revoked.invitationId)?.status).toBe("revoked");
      expect(byId.get(expired.invitationId)?.status).toBe("expired");
      expect(byId.get(accepted.invitationId)?.status).toBe("accepted");
      expect(byId.get(pending.invitationId)?.invitedByName).toBe(org.user.name);
      // Plain JSON only.
      expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
    } finally {
      await org.cleanup();
    }
  });

  it("only lists the caller's own workspace", async () => {
    const mine = await createTestOrg("invite-mine");
    const theirs = await createTestOrg("invite-theirs");
    try {
      await createInvitation(theirs.session, { email: uniqueEmail(), role: "MEMBER" });
      expect(await listInvitations(mine.organization.id)).toEqual([]);
    } finally {
      await dropOrgs(mine.organization.id, theirs.organization.id);
    }
  });

  it("refuses to revoke another workspace's invitation, an accepted one, or without permission", async () => {
    const mine = await createTestOrg("revoke-mine");
    const theirs = await createTestOrg("revoke-theirs");
    try {
      const foreign = await createInvitation(theirs.session, { email: uniqueEmail(), role: "MEMBER" });
      await expect(revokeInvitation(mine.session, foreign.invitationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await getInvitationByToken(tokenFrom(foreign.inviteUrl))).not.toBeNull();

      const own = await createInvitation(mine.session, { email: uniqueEmail(), role: "MEMBER" });
      await expect(revokeInvitation(demote(mine.session, "MEMBER"), own.invitationId)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      const used = await createInvitation(mine.session, { email: uniqueEmail(), role: "MEMBER" });
      await acceptInvitation(tokenFrom(used.inviteUrl), { name: "Jo", password: strongPassword() }, ctx());
      await expect(revokeInvitation(mine.session, used.invitationId)).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await dropOrgs(mine.organization.id, theirs.organization.id);
    }
  });

  it("is idempotent once revoked, and records the event", async () => {
    const org = await createTestOrg("revoke-twice");
    try {
      const invitation = await createInvitation(org.session, { email: uniqueEmail(), role: "MEMBER" });
      await revokeInvitation(org.session, invitation.invitationId);
      await revokeInvitation(org.session, invitation.invitationId);
      const events = await db.securityEvent.count({
        where: { organizationId: org.organization.id, type: "INVITE_REVOKED" },
      });
      expect(events).toBe(1);
    } finally {
      await org.cleanup();
    }
  });
});
