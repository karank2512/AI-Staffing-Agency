import type { SecurityEventType } from "@prisma/client";
import { db, toJson } from "@/server/db";
import { errorMessage } from "@/server/errors";
import { securityLog } from "./log";
import { redactMetadata } from "./redact";
import { clipUserAgent, hashEmail } from "./request";

/**
 * Append-only security audit trail (F-012): sign-ins, lockouts, credential changes, role changes, rate limits
 * and budget stops. It stores `sha256(email)` instead of the address, clips the user agent, and strips
 * anything secret-looking from metadata. `recordSecurityEvent` NEVER throws — losing an audit row must not
 * fail the operation that produced it (it is logged instead, and the JSON line is the backstop).
 */

export interface SecurityEventInput {
  type: SecurityEventType;
  organizationId?: string;
  userId?: string;
  /** Hashed before it is stored — used for attempts against accounts that may not exist. */
  email?: string;
  ip?: string;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SecurityEventView {
  id: string;
  type: SecurityEventType;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  /** ISO string */
  createdAt: string;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function recordSecurityEvent(event: SecurityEventInput): Promise<void> {
  const emailHash = event.email ? hashEmail(event.email) : undefined;
  const metadata = redactMetadata(event.metadata);

  // One structured line per event, so the log pipeline sees it even if the insert fails.
  securityLog("info", "security.event", {
    type: event.type,
    orgId: event.organizationId,
    userId: event.userId,
    ip: event.ip,
    emailHash: emailHash?.slice(0, 12),
  });

  try {
    await db.securityEvent.create({
      data: {
        type: event.type,
        organizationId: event.organizationId ?? null,
        userId: event.userId ?? null,
        emailHash: emailHash ?? null,
        ip: event.ip ?? null,
        userAgent: clipUserAgent(event.userAgent),
        metadata: metadata ? toJson(metadata) : undefined,
      },
    });
  } catch (e) {
    securityLog("warn", "security.event_not_recorded", { type: event.type, error: errorMessage(e) });
  }
}

/** Org-scoped audit feed for the workspace security page. Plain JSON — safe to hand to a client component. */
export async function listSecurityEvents(
  organizationId: string,
  opts: { userId?: string; limit?: number } = {},
): Promise<SecurityEventView[]> {
  const take = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const rows = await db.securityEvent.findMany({
    where: { organizationId, ...(opts.userId ? { userId: opts.userId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, userId: true, ip: true, userAgent: true, metadata: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    userId: r.userId,
    ip: r.ip,
    userAgent: r.userAgent,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Retention sweep (config.retention.eventsDays), called from the maintenance tick. Returns rows deleted. */
export async function sweepSecurityEvents(cutoff: Date): Promise<number> {
  const { count } = await db.securityEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}
