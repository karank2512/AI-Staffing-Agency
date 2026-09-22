import { config } from "@/server/config";
// Leaf import (not the module index): the logger is loaded by the Edge instrumentation bundle, and the security
// index pulls in the Postgres-backed limiter (node:crypto, Prisma), which cannot be bundled for Edge.
import { redactSecrets } from "@/server/security/redact";

/**
 * Dependency-free structured logger (JSON in production, human-readable in dev — see `config.log`).
 *
 * Every string that reaches the output goes through `redactSecrets`, so an error carrying an API key, a bearer
 * token or a connection string can never be shipped to a log platform. Child loggers carry bindings
 * (`service`, `requestId`, `runId`, `orgId`) so a log platform can filter by them.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `bindings` to every record it writes. */
  child(bindings: LogFields): Logger;
}

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MAX_DEPTH = 4;
const MAX_ARRAY = 20;
const MAX_KEYS = 40;
const MAX_STRING = 2_000;

/** Silent under Vitest unless RUNTIME_LOG is set, so suites stay readable (the logger's own tests set it). */
function quiet(): boolean {
  return !!process.env.VITEST && !process.env.RUNTIME_LOG;
}

function clip(text: string): string {
  const safe = redactSecrets(text);
  return safe.length > MAX_STRING ? `${safe.slice(0, MAX_STRING)}…` : safe;
}

/**
 * Errors become `{ name, message, code, stack? }`. Stacks are kept out of production output: they are long, they
 * leak file layout, and the message plus the logged context is what an operator actually greps for.
 */
export function serializeError(e: unknown, depth = 0): unknown {
  if (!(e instanceof Error)) return sanitize(e, depth);
  const out: LogFields = { name: e.name, message: clip(e.message) };
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") out.code = code;
  if (!config.isProduction && typeof e.stack === "string") out.stack = clip(e.stack);
  if (e.cause != null && depth < MAX_DEPTH) out.cause = serializeError(e.cause, depth + 1);
  return out;
}

/** Depth-, width- and cycle-bounded conversion to something `JSON.stringify` always survives. */
function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "string":
      return clip(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
      return "[function]";
    case "symbol":
      return value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value, depth);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1, seen));
    return value.length > MAX_ARRAY ? [...items, `…${value.length - MAX_ARRAY} more`] : items;
  }
  const out: LogFields = {};
  for (const [k, v] of Object.entries(value as object).slice(0, MAX_KEYS)) {
    out[k] = k === "err" || k === "error" ? serializeError(v, depth + 1) : sanitize(v, depth + 1, seen);
  }
  return out;
}

function pretty(record: LogFields & { time: string; level: LogLevel; msg: string }): string {
  const { time, level, msg, ...rest } = record;
  const tail = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `${time} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`;
}

function write(level: LogLevel, line: string): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(bindings: LogFields = {}): Logger {
  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (SEVERITY[level] < SEVERITY[config.log.level] || quiet()) return;
    const record = {
      time: new Date().toISOString(),
      level,
      msg: clip(message),
      ...(sanitize(bindings) as LogFields),
      ...(fields ? (sanitize(fields) as LogFields) : {}),
    };
    write(level, config.log.format === "json" ? JSON.stringify(record) : pretty(record));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

/** Process-wide root logger. `SERVICE_NAME` distinguishes the web and worker processes in a shared log stream. */
export const logger: Logger = createLogger({ service: process.env.SERVICE_NAME ?? "web" });
