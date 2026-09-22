import type { SessionContext } from "@/server/auth/types";
import { assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { errorMessage, invalid, notFound } from "@/server/errors";
import { RATE_RULES, enforce, recordSecurityEvent, requestContext, securityLog } from "@/server/security";
import { decrypt, encrypt, isCurrentEnvelope } from "./crypto";
import { KNOWN_CREDENTIALS, isKnownCredential } from "./known";

const MAX_VALUE_LENGTH = 4096;
const MAX_LABEL_LENGTH = 120;

export interface CredentialSummary {
  name: string;
  label: string | null;
  last4: string;
  /** ISO string — when the current value was saved. */
  createdAt: string;
  /** ISO string */
  lastUsedAt: string | null;
}

/**
 * Resolution order: the organization's own credential → the process-wide env var → undefined.
 * An empty / whitespace-only value counts as unset at both levels.
 *
 * A stored credential that cannot be decrypted (key rotated away, corrupted or moved row) does NOT fall
 * through to the platform env key: that would silently spend the platform's own API key on this tenant's
 * work (INF-11). It is logged and the tool falls back to Simulated mode until the owner re-enters it.
 *
 * `name` always comes from server-side tool definitions, never from model or user input.
 */
export async function resolveSecret(organizationId: string, name: string): Promise<string | undefined> {
  const row = await db.credential.findUnique({
    where: { organizationId_name: { organizationId, name } },
    select: { id: true, encryptedValue: true },
  });

  if (row) {
    try {
      const value = decrypt(row.encryptedValue, { organizationId, name });
      if (value.trim() !== "") {
        touchLastUsed(organizationId, row.id);
        return value;
      }
    } catch (e) {
      securityLog("error", "secrets.unreadable_credential", {
        orgId: organizationId,
        name,
        error: errorMessage(e),
        hint: "re-enter this credential in Settings",
      });
      return undefined;
    }
  }

  const fromEnv = process.env[name];
  return fromEnv !== undefined && fromEnv.trim() !== "" ? fromEnv : undefined;
}

/** Fire-and-forget: bookkeeping must never delay or fail a tool call. updateMany tolerates a row deleted meanwhile. */
function touchLastUsed(organizationId: string, id: string): void {
  void db.credential
    .updateMany({ where: { id, organizationId }, data: { lastUsedAt: new Date() } })
    .catch((e: unknown) => securityLog("warn", "secrets.last_used_not_updated", { error: errorMessage(e) }));
}

function assertKnownName(name: string): void {
  if (!isKnownCredential(name)) {
    throw invalid(`Unknown credential "${name}"`, { allowed: KNOWN_CREDENTIALS.map((c) => c.name) });
  }
}

export async function setCredential(
  s: SessionContext,
  args: { name: string; value: string; label?: string },
): Promise<void> {
  assertCan(s, "credentials.manage");
  await enforce(RATE_RULES.credentialsOrg, s.organizationId);
  assertKnownName(args.name);

  // Pasted keys routinely carry a trailing newline/space, which providers reject.
  const value = args.value.trim();
  if (value === "") throw invalid("Credential value cannot be empty");
  if (value.length > MAX_VALUE_LENGTH) throw invalid(`Credential value is too long (max ${MAX_VALUE_LENGTH} characters)`);
  const label = args.label?.trim().slice(0, MAX_LABEL_LENGTH) || undefined;

  const encryptedValue = encrypt(value, { organizationId: s.organizationId, name: args.name });
  // Never reveal a meaningful share of a short secret.
  const last4 = value.length >= 12 ? value.slice(-4) : "";
  const now = new Date();

  await db.credential.upsert({
    where: { organizationId_name: { organizationId: s.organizationId, name: args.name } },
    create: {
      organizationId: s.organizationId,
      name: args.name,
      label: label ?? null,
      encryptedValue,
      last4,
      createdById: s.userId,
    },
    // Replacing the value is a new secret: reset its provenance and usage, keep the label unless a new one is given.
    update: {
      encryptedValue,
      last4,
      createdById: s.userId,
      createdAt: now,
      lastUsedAt: null,
      ...(label !== undefined ? { label } : {}),
    },
  });

  await auditCredential("CREDENTIAL_SET", s, args.name);
}

export async function deleteCredential(s: SessionContext, name: string): Promise<void> {
  assertCan(s, "credentials.manage");
  await enforce(RATE_RULES.credentialsOrg, s.organizationId);
  assertKnownName(name);
  const { count } = await db.credential.deleteMany({ where: { organizationId: s.organizationId, name } });
  if (count === 0) throw notFound("Credential");
  await auditCredential("CREDENTIAL_DELETED", s, name);
}

/** The audit row records WHO changed WHICH credential — never the value, not even its last 4 characters. */
async function auditCredential(type: "CREDENTIAL_SET" | "CREDENTIAL_DELETED", s: SessionContext, name: string): Promise<void> {
  const ctx = await requestContext();
  await recordSecurityEvent({
    type,
    organizationId: s.organizationId,
    userId: s.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { name },
  });
}

/** Metadata only — values never leave the vault except through resolveSecret. */
export async function listCredentials(organizationId: string): Promise<CredentialSummary[]> {
  const rows = await db.credential.findMany({
    where: { organizationId },
    select: { name: true, label: true, last4: true, createdAt: true, lastUsedAt: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    name: r.name,
    label: r.label,
    last4: r.last4,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  }));
}

export interface ReencryptResult {
  scanned: number;
  reencrypted: number;
  /** Rows that could not be read with the current or previous key — they need to be re-entered. */
  failed: number;
}

/**
 * Key rotation step 2 (see docs/SECURITY.md): after `CREDENTIAL_ENCRYPTION_KEY` has been replaced and the
 * old key moved to `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`, rewrite every row under the new key. Idempotent,
 * batched, and safe to run repeatedly: rows already on the active key are skipped. Never logs a value.
 */
export async function reencryptAll(opts: { batchSize?: number } = {}): Promise<ReencryptResult> {
  const batchSize = Math.min(Math.max(1, Math.floor(opts.batchSize ?? 100)), 1000);
  const result: ReencryptResult = { scanned: 0, reencrypted: 0, failed: 0 };
  let cursor: string | undefined;

  for (;;) {
    const rows = await db.credential.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: { id: true, organizationId: true, name: true, encryptedValue: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      result.scanned += 1;
      try {
        if (isCurrentEnvelope(row.encryptedValue)) continue;
        const aad = { organizationId: row.organizationId, name: row.name };
        const encryptedValue = encrypt(decrypt(row.encryptedValue, aad), aad);
        await db.credential.updateMany({ where: { id: row.id, organizationId: row.organizationId }, data: { encryptedValue } });
        result.reencrypted += 1;
      } catch (e) {
        result.failed += 1;
        securityLog("error", "secrets.reencrypt_failed", {
          orgId: row.organizationId,
          name: row.name,
          error: errorMessage(e),
        });
      }
    }
  }

  securityLog("info", "secrets.reencrypt_done", { ...result });
  return result;
}
