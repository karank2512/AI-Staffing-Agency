import type { SessionContext } from "@/server/auth/types";
import { db } from "@/server/db";
import { errorMessage, forbidden, invalid, notFound } from "@/server/errors";
import { decrypt, encrypt } from "./crypto";
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
 * An empty / whitespace-only value counts as unset at both levels. A credential that cannot be
 * decrypted (rotated key, corrupted row) is logged and skipped so the env fallback still works.
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
      const value = decrypt(row.encryptedValue);
      if (value.trim() !== "") {
        touchLastUsed(organizationId, row.id);
        return value;
      }
    } catch (e) {
      console.error(`[secrets] could not decrypt credential ${name} for org ${organizationId}: ${errorMessage(e)}`);
    }
  }

  const fromEnv = process.env[name];
  return fromEnv !== undefined && fromEnv.trim() !== "" ? fromEnv : undefined;
}

/** Fire-and-forget: bookkeeping must never delay or fail a tool call. updateMany tolerates a row deleted meanwhile. */
function touchLastUsed(organizationId: string, id: string): void {
  void db.credential
    .updateMany({ where: { id, organizationId }, data: { lastUsedAt: new Date() } })
    .catch((e: unknown) => console.error(`[secrets] could not update lastUsedAt: ${errorMessage(e)}`));
}

function assertCanManage(s: SessionContext): void {
  if (s.role === "MEMBER") throw forbidden("Only workspace owners and admins can manage tool credentials");
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
  assertCanManage(s);
  assertKnownName(args.name);

  // Pasted keys routinely carry a trailing newline/space, which providers reject.
  const value = args.value.trim();
  if (value === "") throw invalid("Credential value cannot be empty");
  if (value.length > MAX_VALUE_LENGTH) throw invalid(`Credential value is too long (max ${MAX_VALUE_LENGTH} characters)`);
  const label = args.label?.trim().slice(0, MAX_LABEL_LENGTH) || undefined;

  const encryptedValue = encrypt(value);
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
}

export async function deleteCredential(s: SessionContext, name: string): Promise<void> {
  assertCanManage(s);
  assertKnownName(name);
  const { count } = await db.credential.deleteMany({ where: { organizationId: s.organizationId, name } });
  if (count === 0) throw notFound("Credential");
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
