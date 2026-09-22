export { activeKeyId, decrypt, encrypt, isCurrentEnvelope, keyId } from "./crypto";
export type { CredentialAad } from "./crypto";
export { KNOWN_CREDENTIALS } from "./known";
export type { KnownCredential } from "./known";
export { deleteCredential, listCredentials, reencryptAll, resolveSecret, setCredential } from "./vault";
export type { CredentialSummary, ReencryptResult } from "./vault";
