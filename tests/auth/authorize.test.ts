import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeCredentials, normalizeEmail } from "@/server/auth/authorize";
import { MAX_PASSWORD_LENGTH } from "@/server/auth/password";
import { createTestOrg } from "../helpers/factory";
import { TEST_PASSWORD, createOrgWithPassword } from "./helpers";

describe("authorizeCredentials", () => {
  let org: Awaited<ReturnType<typeof createOrgWithPassword>>;
  let placeholderOrg: Awaited<ReturnType<typeof createTestOrg>>;

  beforeAll(async () => {
    org = await createOrgWithPassword("auth");
    // Keeps the factory's "not-a-real-hash" placeholder: a row whose hash can never verify.
    placeholderOrg = await createTestOrg("auth-nohash");
  });

  afterAll(async () => {
    await org?.cleanup();
    await placeholderOrg?.cleanup();
  });

  it("returns the user's identity for the right e-mail and password", async () => {
    const result = await authorizeCredentials(org.user.email, TEST_PASSWORD);
    expect(result).toEqual({
      id: org.user.id,
      email: org.user.email,
      name: org.user.name,
      organizationId: org.organization.id,
      role: "OWNER",
    });
  });

  it("never leaks the password hash", async () => {
    const result = await authorizeCredentials(org.user.email, TEST_PASSWORD);
    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {}).sort()).toEqual(["email", "id", "name", "organizationId", "role"]);
  });

  it("returns null for a wrong password", async () => {
    expect(await authorizeCredentials(org.user.email, `${TEST_PASSWORD}x`)).toBeNull();
    expect(await authorizeCredentials(org.user.email, TEST_PASSWORD.toLowerCase())).toBeNull();
  });

  it("returns null for an unknown e-mail", async () => {
    expect(await authorizeCredentials(`nobody-${org.organization.slug}@example.test`, TEST_PASSWORD)).toBeNull();
  });

  it("normalizes the e-mail: surrounding whitespace and case are ignored", async () => {
    const messy = `  ${org.user.email.toUpperCase()}\t`;
    expect(messy).not.toEqual(org.user.email);
    const result = await authorizeCredentials(messy, TEST_PASSWORD);
    expect(result?.id).toBe(org.user.id);
    expect(result?.email).toBe(org.user.email);
  });

  it("does not normalize the password", async () => {
    expect(await authorizeCredentials(org.user.email, ` ${TEST_PASSWORD} `)).toBeNull();
  });

  it("rejects empty, oversized and non-string input without throwing", async () => {
    expect(await authorizeCredentials(org.user.email, "")).toBeNull();
    expect(await authorizeCredentials("", TEST_PASSWORD)).toBeNull();
    expect(await authorizeCredentials("   ", TEST_PASSWORD)).toBeNull();
    expect(await authorizeCredentials(org.user.email, "x".repeat(MAX_PASSWORD_LENGTH + 1))).toBeNull();
    // Callers are typed, but the values ultimately come from an HTTP form.
    expect(await authorizeCredentials(undefined as unknown as string, TEST_PASSWORD)).toBeNull();
    expect(await authorizeCredentials(org.user.email, null as unknown as string)).toBeNull();
  });

  it("returns null for a user whose stored hash is not a bcrypt hash", async () => {
    expect(await authorizeCredentials(placeholderOrg.user.email, "not-a-real-hash")).toBeNull();
    expect(await authorizeCredentials(placeholderOrg.user.email, TEST_PASSWORD)).toBeNull();
  });

  it("only signs a user into their own organization", async () => {
    const other = await createOrgWithPassword("auth-other", "another-Passphrase-42");
    try {
      const mine = await authorizeCredentials(org.user.email, TEST_PASSWORD);
      const theirs = await authorizeCredentials(other.user.email, "another-Passphrase-42");
      expect(mine?.organizationId).toBe(org.organization.id);
      expect(theirs?.organizationId).toBe(other.organization.id);
      // One user's password is useless with another user's e-mail.
      expect(await authorizeCredentials(other.user.email, TEST_PASSWORD)).toBeNull();
    } finally {
      await other.cleanup();
    }
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Demo@AIStaffing.DEV \n")).toBe("demo@aistaffing.dev");
  });
});
