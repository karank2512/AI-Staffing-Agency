import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@/server/errors";

/**
 * Envelope format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
 * The version prefix lets us rotate algorithms/keys later without guessing how a row was written.
 */
const PAYLOAD_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce — the size GCM is specified for
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Read at use time (never at import time) so a missing key only breaks the credentials vault,
 * not every module that transitively imports it — and so tests can swap the env var.
 */
function loadKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new AppError(
      "INTERNAL",
      "CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new AppError(
      "INTERNAL",
      `CREDENTIAL_ENCRYPTION_KEY must be base64 that decodes to exactly ${KEY_BYTES} bytes (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

const malformed = () =>
  new AppError("INTERNAL", "Stored credential is malformed (expected v1:<iv>:<tag>:<ciphertext>).");

/** AES-256-GCM with a fresh random IV per value. */
export function encrypt(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PAYLOAD_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Throws AppError("INTERNAL") when the payload is malformed, was tampered with, or was written with another key. */
export function decrypt(payload: string): string {
  const key = loadKey();
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PAYLOAD_VERSION) throw malformed();

  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  // Pin the tag length: GCM would otherwise accept truncated (weaker) tags.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw malformed();

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately generic: never echo key material or ciphertext into logs / UI.
    throw new AppError(
      "INTERNAL",
      "Could not decrypt the stored credential (wrong CREDENTIAL_ENCRYPTION_KEY or corrupted value).",
    );
  }
}
