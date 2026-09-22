import { createHash } from "node:crypto";
import { config } from "@/server/config";

/**
 * Who is making this request — the inputs every rate limit and security event is keyed on.
 *
 * The client IP is only as trustworthy as the proxy chain in front of the app, so it is read from the RIGHT
 * of `X-Forwarded-For` (the entries our own proxies appended), never from the left (which the client writes).
 */

export const UNKNOWN_IP = "unknown";
export const MAX_USER_AGENT_CHARS = 256;

/** Cheap sanity check — we store this value, so it must not become a log/DB injection vector. */
const IP_SHAPE = /^[0-9a-fA-F:.]{3,45}$/;

function normalizeIp(raw: string): string | undefined {
  let value = raw.trim();
  if (value === "") return undefined;
  // "[2001:db8::1]:443" → "2001:db8::1"
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1] as string;
  // "203.0.113.7:443" → "203.0.113.7" (IPv4 only: a bare IPv6 also contains colons).
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  if (!IP_SHAPE.test(value)) return undefined;
  return value.toLowerCase();
}

/**
 * The client IP as seen through `trustedHops` reverse proxies.
 *
 * With one trusted proxy the client's address is the LAST entry it appended; with two it is the
 * second-to-last, and so on. A header with fewer entries than configured did not come through the expected
 * chain, so it is ignored rather than trusted. Falls back to `x-real-ip`, then `"unknown"`.
 */
export function clientIpFromHeaders(headers: Headers, trustedHops: number = config.auth.trustedProxyHops): string {
  const hops = Math.max(1, Math.floor(Number.isFinite(trustedHops) ? trustedHops : 1));
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    const index = parts.length - hops;
    if (index >= 0) {
      const ip = normalizeIp(parts[index] as string);
      if (ip) return ip;
    }
  }
  const real = headers.get("x-real-ip");
  return (real && normalizeIp(real)) || UNKNOWN_IP;
}

/** A user agent is free-form client input: keep it short and strip control characters before storing it. */
export function clipUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const cleaned = userAgent.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim();
  if (cleaned === "") return null;
  return cleaned.length > MAX_USER_AGENT_CHARS ? cleaned.slice(0, MAX_USER_AGENT_CHARS) : cleaned;
}

/** Stable pseudonym for an email address: enough to spot an attack pattern, never the address itself. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

/**
 * Request context inside a server action / route handler. `next/headers` is imported lazily so this module
 * stays usable from the executor and the worker process, where there is no request (→ "unknown").
 */
export async function requestContext(): Promise<{ ip: string; userAgent: string | null }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return { ip: clientIpFromHeaders(h), userAgent: clipUserAgent(h.get("user-agent")) };
  } catch {
    return { ip: UNKNOWN_IP, userAgent: null };
  }
}
