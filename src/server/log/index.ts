/**
 * Structured logging (contract: docs/PRODUCTION.md § ops).
 *
 * `logger.child({ runId, orgId })` in long-lived code, `createLogger` for a process-level root. Output is JSON on
 * one line in production and readable text in development; secrets are redacted on the way out.
 */
export { createLogger, logger, serializeError, type LogFields, type LogLevel, type Logger } from "./logger";
