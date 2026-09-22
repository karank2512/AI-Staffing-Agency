import { createCipheriv, randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  KNOWN_CREDENTIALS,
  activeKeyId,
  decrypt,
  deleteCredential,
  encrypt,
  isCurrentEnvelope,
  listCredentials,
  reencryptAll,
  resolveSecret,
  setCredential,
} from "@/server/secrets";
import { createTestOrg } from "../helpers/factory";
import { asRole, captureConsoleError, rejection, withEnv } from "./helpers";

const NAME = "TAVILY_API_KEY";

/** Flip one bit of one base64 segment of a payload (decode → mutate → re-encode, so padding quirks can't hide it). */
function tamper(payload: string, segment: 2 | 3 | 4): string {
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
  const AAD = { organizationId: "org_one", name: NAME };
  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });

  it("round-trips values, including unicode and the empty string", () => {
    for (const plain of ["tvly-abc123XYZ", "päss wörd 🔑 with: colons", "", "x".repeat(4096)]) {
      expect(decrypt(encrypt(plain, AAD), AAD)).toBe(plain);
    }
  });

  it('uses the "v2:<kid>:<iv>:<tag>:<ciphertext>" envelope with a fresh 12-byte IV per value', () => {
    const a = encrypt("same value", AAD);
    const b = encrypt("same value", AAD);
    expect(a).not.toBe(b);

    const parts = a.split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v2");
    expect(parts[1]).toBe(activeKeyId());
    expect(parts[1]).toMatch(/^[0-9a-f]{8}$/);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[3], "base64")).toHaveLength(16);
    expect(a).not.toContain("same value");
    expect(parts[2]).not.toBe(b.split(":")[2]);
    expect(isCurrentEnvelope(a)).toBe(true);
  });

  it("binds the ciphertext to (organizationId, name): a row moved elsewhere will not decrypt", () => {
    const payload = encrypt("tvly-value-for-org-one", AAD);
    expectInternal(() => decrypt(payload, { organizationId: "org_two", name: NAME }), /decrypt/i);
    expectInternal(() => decrypt(payload, { organizationId: "org_one", name: "OTHER_KEY" }), /decrypt/i);
    expect(decrypt(payload, { ...AAD })).toBe("tvly-value-for-org-one");
  });

  it("detects tampering with the IV, the auth tag or the ciphertext", () => {
    const payload = encrypt("super-secret-value", AAD);
    for (const segment of [2, 3, 4] as const) {
      expectInternal(() => decrypt(tamper(payload, segment), AAD), /decrypt/i);
    }
  });

  it("rejects malformed envelopes", () => {
    const payload = encrypt("value", AAD);
    const [, kid, iv, tag, data] = payload.split(":");
    expectInternal(() => decrypt("not-a-payload", AAD), /malformed/i);
    expectInternal(() => decrypt(`v2:${iv}:${tag}:${data}`, AAD), /malformed/i);
    expectInternal(() => decrypt(`v3:${kid}:${iv}:${tag}:${data}`, AAD), /malformed/i);
    expectInternal(() => decrypt(`v1:${iv}:${tag}`, AAD), /malformed/i);
    // A truncated auth tag must not be accepted as a weaker-but-valid tag.
    const shortTag = Buffer.from(tag, "base64").subarray(0, 8).toString("base64");
    expectInternal(() => decrypt(`v2:${kid}:${iv}:${shortTag}:${data}`, AAD), /malformed/i);
  });

  it("cannot decrypt with a different key", () => {
    const payload = encrypt("value", AAD);
    restores.push(withEnv({ CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64") }));
    expectInternal(() => decrypt(payload, AAD), /decrypt/i);
  });

  it("still reads v1 rows written before key ids and AAD existed", () => {
    // A v1 envelope: AES-256-GCM, no key id, no additional data.
    const key = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY as string, "base64");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    const ciphertext = Buffer.concat([cipher.update("tvly-legacy-value", "utf8"), cipher.final()]);
    const legacy = ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");

    expect(decrypt(legacy, AAD)).toBe("tvly-legacy-value");
    expect(isCurrentEnvelope(legacy)).toBe(false);
  });

  it("decrypts with CREDENTIAL_ENCRYPTION_KEY_PREVIOUS after the active key is rotated", () => {
    const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY as string;
    const payload = encrypt("tvly-written-with-the-old-key", AAD);
    const oldKeyId = payload.split(":")[1];

    restores.push(
      withEnv({
        CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: oldKey,
      }),
    );
    expect(activeKeyId()).not.toBe(oldKeyId);
    expect(decrypt(payload, AAD)).toBe("tvly-written-with-the-old-key");
    expect(isCurrentEnvelope(payload)).toBe(false);
    // New values are written under the active key only.
    expect(encrypt("fresh", AAD).split(":")[1]).toBe(activeKeyId());
  });

  it("fails at use time with a clear message when the key is missing or not 32 bytes", () => {
    restores.push(withEnv({ CREDENTIAL_ENCRYPTION_KEY: undefined }));
    expectInternal(() => encrypt("value", AAD), /CREDENTIAL_ENCRYPTION_KEY is not set/);

    restores.push(withEnv({ CREDENTIAL_ENCRYPTION_KEY: randomBytes(16).toString("base64") }));
    expectInternal(() => encrypt("value", AAD), /32 bytes \(got 16\)/);
    expectInternal(() => decrypt("v1:a:b:c", AAD), /32 bytes/);
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

  it("does NOT fall back to the platform env key when the stored value cannot be decrypted", async () => {
    // Falling through would silently spend the PLATFORM's key on this tenant's work (INF-11).
    restores.push(withEnv({ [NAME]: "tvly-from-env" }));
    await setCredential(t.session, { name: NAME, value: "tvly-from-the-vault" });
    const row = await db.credential.findFirstOrThrow({ where: { organizationId: t.organization.id, name: NAME } });
    await db.credential.update({ where: { id: row.id }, data: { encryptedValue: tamper(row.encryptedValue, 4) } });

    const errors = captureConsoleError();
    expect(await resolveSecret(t.organization.id, NAME)).toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).not.toContain("tvly-from-the-vault");
  });

  it("re-encrypts rows under the active key after a rotation", async () => {
    await setCredential(t.session, { name: NAME, value: "tvly-rotate-me-1234" });
    const before = await db.credential.findFirstOrThrow({ where: { organizationId: t.organization.id, name: NAME } });

    restores.push(
      withEnv({
        CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: process.env.CREDENTIAL_ENCRYPTION_KEY,
      }),
    );
    const result = await reencryptAll({ batchSize: 50 });
    expect(result.reencrypted).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBe(0);

    const after = await db.credential.findFirstOrThrow({ where: { id: before.id } });
    expect(after.encryptedValue).not.toBe(before.encryptedValue);
    expect(after.encryptedValue.split(":")[1]).toBe(activeKeyId());
    expect(isCurrentEnvelope(after.encryptedValue)).toBe(true);
    // The value survives the rotation, and a second pass is a no-op.
    expect(await resolveSecret(t.organization.id, NAME)).toBe("tvly-rotate-me-1234");
    expect((await reencryptAll()).reencrypted).toBe(0);
  });

  it("records CREDENTIAL_SET / CREDENTIAL_DELETED security events without the value", async () => {
    await db.securityEvent.deleteMany({ where: { organizationId: t.organization.id } });
    await setCredential(t.session, { name: NAME, value: "tvly-audited-value-9999" });
    await deleteCredential(t.session, NAME);

    const events = await db.securityEvent.findMany({
      where: { organizationId: t.organization.id, type: { in: ["CREDENTIAL_SET", "CREDENTIAL_DELETED"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual(["CREDENTIAL_SET", "CREDENTIAL_DELETED"]);
    expect(events[0].userId).toBe(t.user.id);
    expect(events[0].metadata).toEqual({ name: NAME });
    expect(JSON.stringify(events)).not.toContain("tvly-audited-value-9999");
    await db.securityEvent.deleteMany({ where: { organizationId: t.organization.id } });
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
    expect(rows[0].encryptedValue.startsWith(`v2:${activeKeyId()}:`)).toBe(true);
    expect(rows[0].encryptedValue).not.toContain("tvly-second-value-2222");
    expect(decrypt(rows[0].encryptedValue, { organizationId: t.organization.id, name: NAME })).toBe("tvly-second-value-2222");
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
