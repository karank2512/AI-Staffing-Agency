import { afterEach, describe, expect, it } from "vitest";
import { changeMemberRole, listMembers, removeMember } from "@/server/account";
import type { SessionContext } from "@/server/auth/types";
import { loadSessionContext } from "@/server/auth/session-context";
import { db } from "@/server/db";
import { createTestOrg } from "../helpers/factory";
import { dropOrgs, uniqueEmail } from "./helpers";

/** A second (or third) account inside an existing workspace. */
async function addUser(organizationId: string, role: "OWNER" | "ADMIN" | "MEMBER", name = "Teammate") {
  return db.user.create({
    data: { organizationId, email: uniqueEmail(role.toLowerCase()), name, passwordHash: "x", role },
  });
}

const sessionAs = (organization: { id: string; name: string }, user: { id: string; email: string; name: string }, role: SessionContext["role"]): SessionContext => ({
  userId: user.id,
  organizationId: organization.id,
  organizationName: organization.name,
  role,
  name: user.name,
  email: user.email,
});

describe("listMembers", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("returns every member of the org with their role, last sign-in and disabled flag", async () => {
    const org = await createTestOrg("members");
    cleanup = org.cleanup;

    const admin = await addUser(org.organization.id, "ADMIN", "Avery Admin");
    const member = await addUser(org.organization.id, "MEMBER", "Morgan Member");
    const lastSignInAt = new Date("2026-01-02T03:04:05.000Z");
    await db.user.update({ where: { id: admin.id }, data: { lastSignInAt } });
    await db.user.update({ where: { id: member.id }, data: { disabledAt: new Date() } });

    const members = await listMembers(org.organization.id);
    expect(members.map((m) => m.id)).toEqual([org.user.id, admin.id, member.id]);
    expect(members[0]).toMatchObject({ role: "OWNER", disabled: false, lastSignInAt: null });
    expect(members[1]).toMatchObject({ role: "ADMIN", disabled: false, lastSignInAt: lastSignInAt.toISOString() });
    expect(members[2]).toMatchObject({ role: "MEMBER", disabled: true });
    // Plain JSON only — no Date objects leak towards a client component.
    expect(JSON.parse(JSON.stringify(members))).toEqual(members);
  });

  it("never returns members of another workspace", async () => {
    const mine = await createTestOrg("members-mine");
    const theirs = await createTestOrg("members-theirs");
    cleanup = async () => {
      await mine.cleanup();
      await theirs.cleanup();
    };

    const members = await listMembers(mine.organization.id);
    expect(members.map((m) => m.id)).toEqual([mine.user.id]);
  });
});

describe("changeMemberRole", () => {
  it("promotes and demotes, and bumps the target's sessionVersion so the change lands immediately", async () => {
    const org = await createTestOrg("role-change");
    try {
      const member = await addUser(org.organization.id, "MEMBER");
      // Their existing cookie is valid right now…
      expect(
        await loadSessionContext({ userId: member.id, organizationId: org.organization.id, sessionVersion: 0 }),
      ).not.toBeNull();

      await changeMemberRole(org.session, member.id, "ADMIN");

      const updated = await db.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(updated.role).toBe("ADMIN");
      expect(updated.sessionVersion).toBe(1);
      // …and is refused afterwards, so the new role is picked up on the next request.
      expect(
        await loadSessionContext({ userId: member.id, organizationId: org.organization.id, sessionVersion: 0 }),
      ).toBeNull();

      const events = await db.securityEvent.findMany({
        where: { organizationId: org.organization.id, type: "ROLE_CHANGED" },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({ targetUserId: member.id, from: "MEMBER", to: "ADMIN" });
    } finally {
      await org.cleanup();
    }
  });

  it("is a no-op when the role is already what was asked for", async () => {
    const org = await createTestOrg("role-noop");
    try {
      const member = await addUser(org.organization.id, "MEMBER");
      await changeMemberRole(org.session, member.id, "MEMBER");
      const updated = await db.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(updated.sessionVersion).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  it("refuses to demote the last owner", async () => {
    const org = await createTestOrg("role-last-owner");
    try {
      await expect(changeMemberRole(org.session, org.user.id, "ADMIN")).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("at least one owner"),
      });
      const unchanged = await db.user.findUniqueOrThrow({ where: { id: org.user.id } });
      expect(unchanged.role).toBe("OWNER");
    } finally {
      await org.cleanup();
    }
  });

  it("allows demoting an owner once a second owner exists", async () => {
    const org = await createTestOrg("role-two-owners");
    try {
      const coOwner = await addUser(org.organization.id, "OWNER", "Second Owner");
      await changeMemberRole(org.session, coOwner.id, "MEMBER");
      expect((await db.user.findUniqueOrThrow({ where: { id: coOwner.id } })).role).toBe("MEMBER");
    } finally {
      await org.cleanup();
    }
  });

  it("is OWNER-only", async () => {
    const org = await createTestOrg("role-permission");
    try {
      const admin = await addUser(org.organization.id, "ADMIN");
      const member = await addUser(org.organization.id, "MEMBER");
      const adminSession = sessionAs(org.organization, admin, "ADMIN");
      const memberSession = sessionAs(org.organization, member, "MEMBER");

      await expect(changeMemberRole(adminSession, member.id, "ADMIN")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(changeMemberRole(memberSession, admin.id, "MEMBER")).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await org.cleanup();
    }
  });

  it("cannot reach into another workspace", async () => {
    const mine = await createTestOrg("role-mine");
    const theirs = await createTestOrg("role-theirs");
    try {
      await expect(changeMemberRole(mine.session, theirs.user.id, "MEMBER")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await db.user.findUniqueOrThrow({ where: { id: theirs.user.id } })).role).toBe("OWNER");
    } finally {
      await dropOrgs(mine.organization.id, theirs.organization.id);
    }
  });
});

describe("removeMember", () => {
  it("disables the account and revokes their sessions, keeping the row for history", async () => {
    const org = await createTestOrg("remove");
    try {
      const member = await addUser(org.organization.id, "MEMBER");
      await removeMember(org.session, member.id);

      const removed = await db.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(removed.disabledAt).not.toBeNull();
      expect(removed.sessionVersion).toBe(1);
      // Their live cookie stops working on the next request.
      expect(
        await loadSessionContext({ userId: member.id, organizationId: org.organization.id, sessionVersion: 0 }),
      ).toBeNull();
      expect(
        await loadSessionContext({ userId: member.id, organizationId: org.organization.id, sessionVersion: 1 }),
      ).toBeNull();

      const events = await db.securityEvent.count({
        where: { organizationId: org.organization.id, type: "MEMBER_REMOVED" },
      });
      expect(events).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it("shows up in listMembers as disabled rather than disappearing", async () => {
    const org = await createTestOrg("remove-list");
    try {
      const member = await addUser(org.organization.id, "MEMBER");
      await removeMember(org.session, member.id);
      const members = await listMembers(org.organization.id);
      expect(members.find((m) => m.id === member.id)).toMatchObject({ disabled: true });
    } finally {
      await org.cleanup();
    }
  });

  it("refuses to remove yourself or the last owner", async () => {
    const org = await createTestOrg("remove-self");
    try {
      await expect(removeMember(org.session, org.user.id)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("remove yourself"),
      });

      const coOwner = await addUser(org.organization.id, "OWNER", "Second Owner");
      // The first owner steps down, leaving coOwner as the only one…
      await changeMemberRole(org.session, org.user.id, "MEMBER");
      const coOwnerSession = sessionAs(org.organization, coOwner, "OWNER");
      // …who now cannot be removed either.
      await expect(
        removeMember({ ...coOwnerSession, userId: org.user.id, role: "OWNER" }, coOwner.id),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await org.cleanup();
    }
  });

  it("is idempotent for an already-removed member", async () => {
    const org = await createTestOrg("remove-twice");
    try {
      const member = await addUser(org.organization.id, "MEMBER");
      await removeMember(org.session, member.id);
      await removeMember(org.session, member.id);
      expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).sessionVersion).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it("is OWNER-only and org-scoped", async () => {
    const mine = await createTestOrg("remove-permission");
    const theirs = await createTestOrg("remove-other");
    try {
      const admin = await addUser(mine.organization.id, "ADMIN");
      const member = await addUser(mine.organization.id, "MEMBER");
      await expect(
        removeMember(sessionAs(mine.organization, admin, "ADMIN"), member.id),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(removeMember(mine.session, theirs.user.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await dropOrgs(mine.organization.id, theirs.organization.id);
    }
  });
});
