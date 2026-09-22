import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  KNOWN_CREDENTIALS,
  decrypt,
  deleteCredential,
  encrypt,
  listCredentials,
  resolveSecret,
  setCredential,
} from "@/server/secrets";
import { createTestOrg } from "../helpers/factory";
import { asRole, captureConsoleError, rejection, withEnv } from "./helpers";

const NAME = "TAVILY_API_KEY";

/** Flip one bit of one base64 segment of a payload (decode → mutate → re-encode, so padding quirks can't hide it). */
function tamper(payload: string, segment: 1 | 2 | 3): string {
  const parts = payload.split(":");
  const bytes = Buffer.from(parts[segment], "base64");
  bytes[0] = bytes[0] ^ 0x01;
  parts[segment] = bytes.toString("base64");
  return parts.join(":");
}

function expectInternal(fn: () => unknown, pattern?: RegExp) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe("INTERNAL");
  if (pattern) expect((caught as AppError).message).toMatch(pattern);
}

describe("secrets: encrypt / decrypt", () => {
  const restores: Array<() => void> = [];
  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });

  it("round-trips values, including unicode and the empty string", () => {
    for (const plain of ["tvly-abc123XYZ", "päss wörd 🔑 with: colons", "", "x".repeat(4096)]) {
      expect(decrypt(encrypt(plain))).toBe(plain);
    }
  });

  it('uses the "v1:<iv>:<tag>:<ciphertext>" envelope with a fresh 12-byte IV per value', () => {
    const a = encrypt("same value");
    const b = encrypt("same value");
    expect(a).not.toBe(b);

    const parts = a.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
    expect(a).not.toContain("same value");
    expect(parts[1]).not.toBe(b.split(":")[1]);
  });

  it("detects tampering with the IV, the auth tag or the ciphertext", () => {
    const payload = encrypt("super-secret-value");
    for (const segment of [1, 2, 3] as const) {
      expectInternal(() => decrypt(tamper(payload, segment)), /decrypt/i);
    }
  });

  it("rejects malformed envelopes", () => {
    const payload = encrypt("value");
    const [, iv, tag, data] = payload.split(":");
    expectInternal(() => decrypt("not-a-payload"), /malformed/i);
    expectInternal(() => decrypt(`v2:${iv}:${tag}:${data}`), /malformed/i);
    expectInternal(() => decrypt(`v1:${iv}:${tag}`), /malformed/i);
    // A truncated auth tag must not be accepted as a weaker-but-valid tag.
    const shortTag = Buffer.from(tag, "base64").subarray(0, 8).toString("base64");
    expectInternal(() => decrypt(`v1:${iv}:${shortTag}:${data}`), /malformed/i);
  });

  it("cannot decrypt with a different key", () => {
    const payload = encrypt("value");
    restores.push(withEnv({ CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") }));
    expectInternal(() => decrypt(payload), /decrypt/i);
  });

  it("fails at use time with a clear message when the key is missing or not 32 bytes", () => {
    restores.push(withEnv({ CREDENTIAL_ENCRYPTION_KEY: undefined }));
    expectInternal(() => encrypt("value"), /CREDENTIAL_ENCRYPTION_KEY is not set/);

    restores.push(withEnv({ CREDENTIAL_ENCRYPTION_KEY: randomBytes(16).toString("base64") }));
    expectInternal(() => encrypt("value"), /32 bytes \(got 16\)/);
    expectInternal(() => decrypt("v1:a:b:c"), /32 bytes/);
  });
});

describe("secrets: vault", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  let other: Awaited<ReturnType<typeof createTestOrg>>;
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    t = await createTestOrg("platform-secrets");
    other = await createTestOrg("platform-secrets-other");
  });
  afterEach(async () => {
    while (restores.length) restores.pop()?.();
    vi.restoreAllMocks();
    await db.credential.deleteMany({ where: { organizationId: { in: [t.organization.id, other.organization.id] } } });
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("declares the Phase 1 credentials", () => {
    expect(KNOWN_CREDENTIALS.map((c) => c.name)).toContain(NAME);
    const tavily = KNOWN_CREDENTIALS.find((c) => c.name === NAME);
    expect(tavily?.usedBy).toEqual(["web_search"]);
    expect(tavily?.docsUrl).toMatch(/^https:\/\//);
  });

  it("resolves org credential → env → undefined, treating empty strings as unset", async () => {
    restores.push(withEnv({ [NAME]: undefined }));
    expect(await resolveSecret(t.organization.id, NAME)).toBeUndefined();

    process.env[NAME] = "";
    expect(await resolveSecret(t.organization.id, NAME)).toBeUndefined();
    process.env[NAME] = "   ";
    expect(await resolveSecret(t.organization.id, NAME)).toBeUndefined();

    process.env[NAME] = "tvly-from-env";
    expect(await resolveSecret(t.organization.id, NAME)).toBe("tvly-from-env");

    await setCredential(t.session, { name: NAME, value: "tvly-from-the-vault" });
    expect(await resolveSecret(t.organization.id, NAME)).toBe("tvly-from-the-vault");

    // Another tenant never sees this org's credential — it only gets the process-wide fallback.
    expect(await resolveSecret(other.organization.id, NAME)).toBe("tvly-from-env");

    delete process.env[NAME];
    expect(await resolveSecret(t.organization.id, NAME)).toBe("tvly-from-the-vault");
    expect(await resolveSecret(other.organization.id, NAME)).toBeUndefined();
  });

  it("stamps lastUsedAt when the org credential is used (fire-and-forget)", async () => {
    await setCredential(t.session, { name: NAME, value: "tvly-from-the-vault" });
    expect((await listCredentials(t.organization.id))[0].lastUsedAt).toBeNull();

    await resolveSecret(t.organization.id, NAME);
    await vi.waitFor(async () => {
      const [row] = await listCredentials(t.organization.id);
      expect(row.lastUsedAt).not.toBeNull();
    });
  });

  it("logs and falls through to env when the stored value cannot be decrypted", async () => {
    restores.push(withEnv({ [NAME]: "tvly-from-env" }));
    await setCredential(t.session, { name: NAME, value: "tvly-from-the-vault" });
    const row = await db.credential.findFirstOrThrow({ where: { organizationId: t.organization.id, name: NAME } });
    await db.credential.update({ where: { id: row.id }, data: { encryptedValue: tamper(row.encryptedValue, 3) } });

    const errors = captureConsoleError();
    expect(await resolveSecret(t.organization.id, NAME)).toBe("tvly-from-env");
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).not.toContain("tvly-from-the-vault");

    delete process.env[NAME];
    expect(await resolveSecret(t.organization.id, NAME)).toBeUndefined();
  });

  it("setCredential: members are forbidden, owners and admins may write", async () => {
    const err = await rejection(setCredential(asRole(t.session, "MEMBER"), { name: NAME, value: "tvly-member-value" }));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");
    expect(await listCredentials(t.organization.id)).toEqual([]);

    await setCredential(asRole(t.session, "ADMIN"), { name: NAME, value: "tvly-admin-value-1234" });
    await setCredential(asRole(t.session, "OWNER"), { name: NAME, value: "tvly-owner-value-5678" });
    expect(await resolveSecret(t.organization.id, NAME)).toBe("tvly-owner-value-5678");
  });

  it("setCredential: validates the name and the value", async () => {
    const unknown = await rejection(setCredential(t.session, { name: "DATABASE_URL", value: "postgres://nope" }));
    expect((unknown as AppError).code).toBe("VALIDATION");

    const empty = await rejection(setCredential(t.session, { name: NAME, value: "   " }));
    expect((empty as AppError).code).toBe("VALIDATION");

    expect(await db.credential.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });

  it("stores ciphertext only, upserts on (org, name), and never lists values", async () => {
    await setCredential(t.session, { name: NAME, value: "  tvly-first-value-1111\n", label: "Research key" });
    await resolveSecret(t.organization.id, NAME);
    await vi.waitFor(async () => {
      expect((await listCredentials(t.organization.id))[0].lastUsedAt).not.toBeNull();
    });

    await setCredential(t.session, { name: NAME, value: "tvly-second-value-2222" });

    const rows = await db.credential.findMany({ where: { organizationId: t.organization.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].encryptedValue.startsWith("v1:")).toBe(true);
    expect(rows[0].encryptedValue).not.toContain("tvly-second-value-2222");
    expect(decrypt(rows[0].encryptedValue)).toBe("tvly-second-value-2222");
    expect(rows[0].createdById).toBe(t.user.id);

    const listed = await listCredentials(t.organization.id);
    expect(listed).toEqual([
      {
        name: NAME,
        label: "Research key", // kept when the replacement does not pass a label
        last4: "2222",
        createdAt: expect.any(String),
        lastUsedAt: null, // a replaced value has never been used
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("tvly-second");
    expect(await listCredentials(other.organization.id)).toEqual([]);
  });

  it("does not leak a short secret through last4", async () => {
    await setCredential(t.session, { name: NAME, value: "abcd" });
    expect((await listCredentials(t.organization.id))[0].last4).toBe("");
  });

  it("deleteCredential: role + name checks, org-scoped, NOT_FOUND when nothing is stored", async () => {
    await setCredential(t.session, { name: NAME, value: "tvly-from-the-vault" });

    expect(((await rejection(deleteCredential(asRole(t.session, "MEMBER"), NAME))) as AppError).code).toBe("FORBIDDEN");
    expect(((await rejection(deleteCredential(t.session, "NOT_A_KNOWN_SECRET"))) as AppError).code).toBe("VALIDATION");
    // Another org's admin cannot delete this org's credential.
    expect(((await rejection(deleteCredential(other.session, NAME))) as AppError).code).toBe("NOT_FOUND");
    expect(await listCredentials(t.organization.id)).toHaveLength(1);

    await deleteCredential(t.session, NAME);
    expect(await listCredentials(t.organization.id)).toEqual([]);
    expect(((await rejection(deleteCredential(t.session, NAME))) as AppError).code).toBe("NOT_FOUND");
  });
});
