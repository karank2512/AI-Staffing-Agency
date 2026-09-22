import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { signUp, slugify } from "@/server/account";
import { authorizeCredentials } from "@/server/auth/authorize";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { RATE_RULES } from "@/server/security";
import { dropOrgs, strongPassword, uniqueEmail, uniqueIp, withEnv, withRateLimiting } from "./helpers";

const ctx = () => ({ ip: uniqueIp(), userAgent: "vitest" });

const inputFor = (overrides: Partial<Parameters<typeof signUp>[0]> = {}) => ({
  name: "Dana Lee",
  email: uniqueEmail("signup"),
  password: strongPassword(),
  organizationName: "Northwind Analytics",
  ...overrides,
});

/** SIGNUP_MODE defaults to "open" outside production, but tests pin it so a stray env cannot flip them. */
const open = (fn: () => Promise<void>) => withEnv({ SIGNUP_MODE: "open" }, fn);

describe("signUp", () => {
  it("creates the organization and its first OWNER in one go", async () => {
    let organizationId: string | undefined;
    await open(async () => {
      const input = inputFor();
      const result = await signUp(input, ctx());
      organizationId = result.organizationId;

      const user = await db.user.findUniqueOrThrow({
        where: { id: result.userId },
        select: {
          email: true,
          name: true,
          role: true,
          sessionVersion: true,
          passwordChangedAt: true,
          disabledAt: true,
          passwordHash: true,
          organizationId: true,
        },
      });
      expect(user).toMatchObject({
        email: input.email,
        name: input.name,
        role: "OWNER",
        sessionVersion: 0,
        disabledAt: null,
        organizationId: result.organizationId,
      });
      expect(user.passwordChangedAt).not.toBeNull();
      expect(user.passwordHash).not.toContain(input.password);
      expect(bcrypt.getRounds(user.passwordHash)).toBe(config.auth.bcryptRounds);

      const organization = await db.organization.findUniqueOrThrow({
        where: { id: result.organizationId },
        select: { name: true, slug: true, monthlyBudgetUsd: true, isDemo: true },
      });
      expect(organization.name).toBe(input.organizationName);
      // A random suffix keeps slugs unique without leaking how many workspaces exist.
      expect(organization.slug).toMatch(/^northwind-analytics-[0-9a-f]{6}$/);
      expect(organization.monthlyBudgetUsd).toBeNull();
      expect(organization.isDemo).toBe(false);
    });
    await dropOrgs(organizationId);
  });

  it("produces an account that can immediately sign in", async () => {
    let organizationId: string | undefined;
    await open(async () => {
      const input = inputFor();
      ({ organizationId } = await signUp(input, ctx()));
      const authorized = await authorizeCredentials(input.email, input.password, ctx());
      expect(authorized).toMatchObject({ organizationId, role: "OWNER", sessionVersion: 0 });
    });
    await dropOrgs(organizationId);
  });

  it("records a SIGN_UP event with a hashed email, never the address", async () => {
    let organizationId: string | undefined;
    await open(async () => {
      const input = inputFor();
      ({ organizationId } = await signUp(input, ctx()));
      const events = await db.securityEvent.findMany({ where: { organizationId, type: "SIGN_UP" } });
      expect(events).toHaveLength(1);
      expect(events[0]?.emailHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(events)).not.toContain(input.email);
    });
    await dropOrgs(organizationId);
  });

  it("normalizes the email and trims the names", async () => {
    let organizationId: string | undefined;
    await open(async () => {
      const email = uniqueEmail("MiXeD");
      const result = await signUp(
        inputFor({ email: `  ${email.toUpperCase()} `, name: "  Dana Lee  ", organizationName: "  Northwind  " }),
        ctx(),
      );
      organizationId = result.organizationId;
      const user = await db.user.findUniqueOrThrow({ where: { id: result.userId }, select: { email: true, name: true } });
      expect(user.email).toBe(email.toLowerCase());
      expect(user.name).toBe("Dana Lee");
    });
    await dropOrgs(organizationId);
  });
});

describe("signUp — refusals", () => {
  it("refuses a password that fails the policy, before creating anything", async () => {
    await open(async () => {
      const input = inputFor({ password: "password1234" });
      await expect(signUp(input, ctx())).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await db.user.findUnique({ where: { email: input.email } })).toBeNull();
    });
  });

  it("gives a deliberately vague answer when the email is already taken", async () => {
    let organizationId: string | undefined;
    await open(async () => {
      const input = inputFor();
      ({ organizationId } = await signUp(input, ctx()));

      try {
        await signUp(inputFor({ email: input.email }), ctx());
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(isAppError(e)).toBe(true);
        if (isAppError(e)) {
          expect(e.code).toBe("CONFLICT");
          // Nothing here admits that the address exists.
          expect(e.message).toMatch(/couldn't create an account/i);
          expect(e.message).not.toMatch(/taken|exists|already registered/i);
        }
      }
      // The half-built organization was rolled back with the failed user insert: no ownerless leftovers.
      const orphans = await db.organization.count({
        where: { slug: { startsWith: "northwind-analytics-" }, users: { none: {} } },
      });
      expect(orphans).toBe(0);
    });
    await dropOrgs(organizationId);
  });

  it("refuses everything when SIGNUP_MODE=closed", async () => {
    await withEnv({ SIGNUP_MODE: "closed" }, async () => {
      const input = inputFor();
      await expect(signUp(input, ctx())).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Sign-up is closed; ask your workspace admin for an invite",
      });
      expect(await db.user.findUnique({ where: { email: input.email } })).toBeNull();
    });
  });

  it("requires the shared code when SIGNUP_MODE=invite", async () => {
    let organizationId: string | undefined;
    await withEnv({ SIGNUP_MODE: "invite", SIGNUP_INVITE_CODE: "let-me-in-please" }, async () => {
      await expect(signUp(inputFor(), ctx())).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(signUp(inputFor({ inviteCode: "wrong" }), ctx())).rejects.toMatchObject({ code: "FORBIDDEN" });
      // A prefix must not pass either — the comparison is over the whole value.
      await expect(signUp(inputFor({ inviteCode: "let-me-in" }), ctx())).rejects.toMatchObject({ code: "FORBIDDEN" });

      ({ organizationId } = await signUp(inputFor({ inviteCode: "let-me-in-please" }), ctx()));
      expect(organizationId).toBeTruthy();
    });
    await dropOrgs(organizationId);
  });

  it("behaves like 'closed' when SIGNUP_MODE=invite but no code is configured", async () => {
    await withEnv({ SIGNUP_MODE: "invite", SIGNUP_INVITE_CODE: undefined }, async () => {
      await expect(signUp(inputFor({ inviteCode: "anything" }), ctx())).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  it("rejects malformed input", async () => {
    await open(async () => {
      await expect(signUp(inputFor({ email: "not-an-email" }), ctx())).rejects.toBeInstanceOf(Error);
      await expect(signUp(inputFor({ name: "   " }), ctx())).rejects.toBeInstanceOf(Error);
      await expect(signUp(inputFor({ organizationName: "x" }), ctx())).rejects.toBeInstanceOf(Error);
    });
  });

  it("rate-limits sign-ups per IP", async () => {
    const ip = uniqueIp();
    const created: string[] = [];
    await open(async () => {
      await withRateLimiting({ ips: [ip] }, async () => {
        for (let i = 0; i < RATE_RULES.signUpIp.limit; i++) {
          const { organizationId } = await signUp(inputFor(), { ip, userAgent: "vitest" });
          created.push(organizationId);
        }
        await expect(signUp(inputFor(), { ip, userAgent: "vitest" })).rejects.toMatchObject({
          code: "LIMIT_EXCEEDED",
        });
      });
    });
    await dropOrgs(...created);
  });
});

describe("slugify", () => {
  it("makes a URL-safe stem out of any workspace name", () => {
    expect(slugify("Northwind Analytics")).toBe("northwind-analytics");
    expect(slugify("  Ünïcode & Co.  ")).toBe("unicode-co");
    expect(slugify("---")).toBe("workspace");
    expect(slugify("🙂")).toBe("workspace");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});
