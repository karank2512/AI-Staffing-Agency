import { config } from "@/server/config";
import { redactSecrets } from "./redact";

/**
 * Minimal structured logger for the security layer (INF-20): one JSON line per event, never the raw error
 * object, never a request body, an email address or a credential value. It never throws — a logging failure
 * must not fail a sign-in, a tool call or a rate-limit check.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Field values are clipped: a log line is a breadcrumb, not a payload store. */
const MAX_FIELD_CHARS = 300;

function scalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return clip(`${value.name}: ${value.message}`);
  if (typeof value === "string") return clip(value);
  try {
    return clip(JSON.stringify(value) ?? String(value));
  } catch {
    return "[unserializable]";
  }
}

function clip(text: string): string {
  const safe = redactSecrets(text);
  return safe.length > MAX_FIELD_CHARS ? `${safe.slice(0, MAX_FIELD_CHARS)}…` : safe;
}

export function securityLog(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  try {
    if (RANK[level] < RANK[config.log.level]) return;
    const payload: Record<string, unknown> = { level, msg };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      payload[key] = scalar(value);
    }
    const write = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (config.log.format === "json") {
      write(JSON.stringify({ t: new Date().toISOString(), ...payload }));
      return;
    }
    const rest = Object.entries(payload)
      .filter(([key]) => key !== "level" && key !== "msg")
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" ");
    write(`[${level}] ${msg}${rest ? ` ${rest}` : ""}`);
  } catch {
    // Logging is best-effort by design.
  }
}
