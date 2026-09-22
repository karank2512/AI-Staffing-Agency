/**
 * Platform security layer. Everything above it (auth, account, staffing, workers, runtime, tools, models,
 * actions, route handlers) may import this module; it imports only `db`, `errors`, `config`, `domain`,
 * Prisma types and — lazily — `next/headers`.
 *
 *   rate-limit  fixed-window limiter + lockouts, Postgres-backed and atomic
 *   audit       SecurityEvent trail (hashed emails, clipped user agents, scrubbed metadata)
 *   budget      workspace suspension, monthly real-spend cap, platform run ceilings
 *   redact      secret scrubbing + client-safe error messages
 *   csp         Content-Security-Policy builder (edge-safe; imported directly by src/middleware.ts)
 */

export { RATE_RULES, enforce, formatWait, hit, isLocked, lock, resetLimit, sweepRateLimits } from "./rate-limit";
export type { RateHit, RateRule, RateRuleName } from "./rate-limit";

export { listSecurityEvents, recordSecurityEvent, sweepSecurityEvents } from "./audit";
export type { SecurityEventInput, SecurityEventView } from "./audit";

export { clientIpFromHeaders, clipUserAgent, hashEmail, requestContext, MAX_USER_AGENT_CHARS, UNKNOWN_IP } from "./request";

export {
  assertOrgActive,
  assertWithinBudget,
  clampRunLimits,
  currentSpendMonth,
  getBudgetStatus,
  recordRealSpend,
} from "./budget";
export type { BudgetStatus } from "./budget";

export { redactAndClip, redactMetadata, redactSecrets } from "./redact";
export { CLIENT_SAFE_ERROR_CODES, GENERIC_PUBLIC_ERROR, errorRef, publicErrorMessage } from "./public-error";

export { CSP_NONCE_HEADER, DOWNLOAD_CSP, LOCKED_DOWN_CSP, buildCsp, createNonce } from "./csp";

export { securityLog } from "./log";
export type { LogLevel } from "./log";
