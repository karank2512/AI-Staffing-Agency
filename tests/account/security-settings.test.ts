import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { changePassword, signOutEverywhere } from "@/server/account";
import { authorizeCredentials } from "@/server/auth/authorize";
import { hashPassword } from "@/server/auth/password";
import { loadSessionContext } from "@/server/auth/session-context";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { RATE_RULES } from "@/server/security";
import { createTestOrg } from "../helpers/factory";
import { strongPassword, uniqueIp, withRateLimiting } from "./helpers";

const ctx = () => ({ ip: uniqueIp(), userAgent: "vitest" });

/** A workspace whose owner has a known, policy-compliant password. */
async function orgWithPassword(label: string, password: string) {
  const org = await createTestOrg(label);
  await db.user.update({ where: { id: org.user.id }, data: { passwordHash: await hashPassword(password) } });
  return org;
}

describe("changePassword", () => {
  it("replaces the hash, stamps passwordChangedAt and revokes every session", async () => {
    const current = strongPassword("oldpw");
    const org = await orgWithPassword("pw-change", current);
    try {
      const next = strongPassword("newpw");
      await changePassword(org.session, { currentPassword: current, newPassword: next });

      const user = await db.user.findUniqueOrThrow({ where: { id: org.user.id } });
      expect(user.sessionVersion).toBe(1);
      expect(user.passwordChangedAt).not.toBeNull();
      expect(bcrypt.getRounds(user.passwordHash)).toBe(config.auth.bcryptRounds);
      expect(await bcrypt.compare(next, user.passwordHash)).toBe(true);
      expect(await bcrypt.compare(current, user.passwordHash)).toBe(false);

      // The cookie they were holding is dead; the old password no longer signs in.
      expect(
        await loadSessionContext({ userId: org.user.id, organizationId: org.organization.id, sessionVersion: 0 }),
      ).toBeNull();
      expect(await authorizeCredentials(org.user.email, current, ctx())).toBeNull();
      expect(await authorizeCredentials(org.user.email, next, ctx())).toMatchObject({ sessionVersion: 1 });

      const events = await db.securityEvent.count({
        where: { organizationId: org.organization.id, type: "PASSWORD_CHANGED" },
      });
      expect(events).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it("refuses a wrong current password without touching anything", async () => {
    const current = strongPassword("keepme");
    const org = await orgWithPassword("pw-wrong", current);
    try {
      await expect(
        changePassword(org.session, { currentPassword: `${current}x`, newPassword: strongPassword("other") }),
      ).rejects.toMatchObject({ code: "VALIDATION", message: "Current password is incorrect." });

      const user = await db.user.findUniqueOrThrow({ where: { id: org.user.id } });
      expect(user.sessionVersion).toBe(0);
      expect(await bcrypt.compare(current, user.passwordHash)).toBe(true);
    } finally {
      await org.cleanup();
    }
  });

  it("applies the password policy to the new password", async () => {
    const current = strongPassword("policy");
    const org = await orgWithPassword("pw-policy", current);
    try {
      await expect(
        changePassword(org.session, { currentPassword: current, newPassword: "password1234" }),
      ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("breach lists") });

      // …including the rule about echoing the workspace name back.
      await expect(
        changePassword(org.session, {
          currentPassword: current,
          newPassword: `${org.organization.name}-abcdef`,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      expect((await db.user.findUniqueOrThrow({ where: { id: org.user.id } })).sessionVersion).toBe(0);
    } finally {
      await org.cleanup();
    }
  });

  it("refuses to 'change' the password to the same value", async () => {
    const current = strongPassword("same");
    const org = await orgWithPassword("pw-same", current);
    try {
      await expect(
        changePassword(org.session, { currentPassword: current, newPassword: current }),
      ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("different") });
    } finally {
      await org.cleanup();
    }
  });

  it("refuses for a disabled account", async () => {
    const current = strongPassword("gone");
    const org = await orgWithPassword("pw-disabled", current);
    try {
      await db.user.update({ where: { id: org.user.id }, data: { disabledAt: new Date() } });
      await expect(
        changePassword(org.session, { currentPassword: current, newPassword: strongPassword("next") }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await org.cleanup();
    }
  });

  it("rate-limits attempts per user", async () => {
    const current = strongPassword("ratelimit");
    const org = await orgWithPassword("pw-rate", current);
    try {
      await withRateLimiting({ userIds: [org.user.id] }, async () => {
        for (let i = 0; i < RATE_RULES.passwordChangeUser.limit; i++) {
          // Wrong current password: cheap, and it still consumes a token from the bucket.
          await expect(
            changePassword(org.session, { currentPassword: "definitely-wrong", newPassword: strongPassword() }),
          ).rejects.toMatchObject({ code: "VALIDATION" });
        }
        await expect(
          changePassword(org.session, { currentPassword: current, newPassword: strongPassword("late") }),
        ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
      });
    } finally {
      await org.cleanup();
    }
  });
});

describe("signOutEverywhere", () => {
  it("bumps sessionVersion so every existing cookie stops working", async () => {
    const org = await createTestOrg("signout-all");
    try {
      expect(
        await loadSessionContext({ userId: org.user.id, organizationId: org.organization.id, sessionVersion: 0 }),
      ).not.toBeNull();

      await signOutEverywhere(org.session);

      expect((await db.user.findUniqueOrThrow({ where: { id: org.user.id } })).sessionVersion).toBe(1);
      expect(
        await loadSessionContext({ userId: org.user.id, organizationId: org.organization.id, sessionVersion: 0 }),
      ).toBeNull();
      // Signing in again mints a token at the new version.
      expect(
        await loadSessionContext({ userId: org.user.id, organizationId: org.organization.id, sessionVersion: 1 }),
      ).not.toBeNull();

      const events = await db.securityEvent.count({
        where: { organizationId: org.organization.id, type: "SESSIONS_REVOKED" },
      });
      expect(events).toBe(1);
    } finally {
      await org.cleanup();
    }
  });

  it("cannot revoke sessions in another workspace", async () => {
    const mine = await createTestOrg("signout-mine");
    const theirs = await createTestOrg("signout-theirs");
    try {
      await expect(
        signOutEverywhere({ ...mine.session, userId: theirs.user.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await db.user.findUniqueOrThrow({ where: { id: theirs.user.id } })).sessionVersion).toBe(0);
    } finally {
      await mine.cleanup();
      await theirs.cleanup();
    }
  });
});
