import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "@/server/errors";

/**
 * Credential envelope: `v2:<kid>:<iv b64>:<auth tag b64>:<ciphertext b64>`.
 *
 * - **kid** identifies the key the value was written with (first 8 hex chars of sha256(key)), so
 *   `CREDENTIAL_ENCRYPTION_KEY` can be rotated with `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` still able to read
 *   old rows (F-014, INF-11). `reencryptAll()` migrates them to the active key.
 * - **AAD** binds the ciphertext to `organizationId:name`. Someone with database write access cannot move
 *   one workspace's encrypted key onto another workspace's row (or under another credential name) and have
 *   it decrypt — GCM authentication fails.
 * - `v1:<iv>:<tag>:<ciphertext>` (no key id, no AAD) is still READ for rows written before this change.
 */

const V2 = "v2";
const V1 = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce — the size GCM is specified for
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** What a ciphertext is bound to. Always supplied by server code, never by a user or a model. */
export interface CredentialAad {
  organizationId: string;
  name: string;
}

interface VaultKey {
  id: string;
  key: Buffer;
}

const aadBytes = (aad: CredentialAad): Buffer => Buffer.from(`${aad.organizationId}:${aad.name}`, "utf8");

function parseKey(raw: string, envVar: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new AppError(
      "INTERNAL",
      `${envVar} must be base64 that decodes to exactly ${KEY_BYTES} bytes (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

/** Stable, non-secret identifier for a key — safe to store in the envelope and to log. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/**
 * Read at use time (never at import time) so a missing key only breaks the credentials vault, not every
 * module that transitively imports it — and so tests and a rotation can swap the env vars.
 * Active key first: a v1 payload is tried against it before the previous key.
 */
function loadKeys(): VaultKey[] {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new AppError(
      "INTERNAL",
      "CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env.",
    );
  }
  const active = parseKey(raw, "CREDENTIAL_ENCRYPTION_KEY");
  const keys: VaultKey[] = [{ id: keyId(active), key: active }];

  const previousRaw = process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS?.trim();
  if (previousRaw) {
    const previous = parseKey(previousRaw, "CREDENTIAL_ENCRYPTION_KEY_PREVIOUS");
    const id = keyId(previous);
    if (id !== keys[0].id) keys.push({ id, key: previous });
  }
  return keys;
}

/** The key new values are written with. */
export function activeKeyId(): string {
  return loadKeys()[0].id;
}

const malformed = () =>
  new AppError("INTERNAL", `Stored credential is malformed (expected ${V2}:<kid>:<iv>:<tag>:<ciphertext>).`);

const undecryptable = () =>
  new AppError(
    "INTERNAL",
    "Could not decrypt the stored credential (wrong CREDENTIAL_ENCRYPTION_KEY or corrupted value).",
  );

function open(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad?: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** AES-256-GCM with a fresh random IV per value, bound to (organizationId, name). */
export function encrypt(plain: string, aad: CredentialAad): string {
  const { id, key } = loadKeys()[0];
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadBytes(aad));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V2, id, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * Throws AppError("INTERNAL") when the payload is malformed, was tampered with, was written under a key we
 * no longer hold, or is bound to a different organization/name.
 */
export function decrypt(payload: string, aad: CredentialAad): string {
  const keys = loadKeys();
  const parts = payload.split(":");

  if (parts[0] === V2 && parts.length === 5) {
    const [, kid, ivPart, tagPart, dataPart] = parts as [string, string, string, string, string];
    const iv = Buffer.from(ivPart, "base64");
    const tag = Buffer.from(tagPart, "base64");
    // Pin the tag length: GCM would otherwise accept truncated (weaker) tags.
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw malformed();
    const match = keys.find((k) => k.id === kid);
    if (!match) throw undecryptable();
    try {
      return open(match.key, iv, tag, Buffer.from(dataPart, "base64"), aadBytes(aad));
    } catch {
      // Deliberately generic: never echo key material or ciphertext into logs / UI.
      throw undecryptable();
    }
  }

  if (parts[0] === V1 && parts.length === 4) {
    const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
    const iv = Buffer.from(ivPart, "base64");
    const tag = Buffer.from(tagPart, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw malformed();
    const ciphertext = Buffer.from(dataPart, "base64");
    for (const { key } of keys) {
      try {
        return open(key, iv, tag, ciphertext);
      } catch {
        // try the next key
      }
    }
    throw undecryptable();
  }

  throw malformed();
}

/** True when the payload already uses the current envelope AND the active key (nothing to re-encrypt). */
export function isCurrentEnvelope(payload: string): boolean {
  const parts = payload.split(":");
  return parts.length === 5 && parts[0] === V2 && parts[1] === loadKeys()[0].id;
}
