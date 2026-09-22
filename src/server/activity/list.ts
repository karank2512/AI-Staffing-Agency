import type { ActivityType, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { activityHref } from "./href";
import type { ActivityItem, ActivityMetadata } from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListActivityOptions {
  workerId?: string;
  jobId?: string;
  /** Empty / omitted = all types. */
  types?: ActivityType[];
  /** Default 50, capped at 200. */
  limit?: number;
  /** Cursor for "load more": only events strictly older than this. */
  before?: Date;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function toMetadata(value: Prisma.JsonValue | null): ActivityMetadata {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as ActivityMetadata) : {};
}

/** Newest first; plain serializable items with the link target pre-computed. */
export async function listActivity(organizationId: string, opts: ListActivityOptions = {}): Promise<ActivityItem[]> {
  const where: Prisma.ActivityEventWhereInput = { organizationId };
  if (opts.workerId) where.workerId = opts.workerId;
  if (opts.jobId) where.jobId = opts.jobId;
  if (opts.types && opts.types.length > 0) where.type = { in: opts.types };
  if (opts.before) where.createdAt = { lt: opts.before };

  const rows = await db.activityEvent.findMany({
    where,
    // id as tie-breaker keeps the order stable for events written in the same millisecond.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: clampLimit(opts.limit),
    include: { worker: { select: { id: true, name: true, avatarColor: true, organizationId: true } } },
  });

  return rows.map((row): ActivityItem => {
    const metadata = toMetadata(row.metadata);
    // Defense in depth: never surface a worker from another tenant, even if a bad row pointed at one.
    const worker =
      row.worker && row.worker.organizationId === organizationId
        ? { id: row.worker.id, name: row.worker.name, avatarColor: row.worker.avatarColor }
        : null;
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      detail: row.detail,
      actorType: row.actorType,
      actorName: row.actorName,
      workerId: row.workerId,
      jobId: row.jobId,
      runId: row.runId,
      worker,
      metadata,
      createdAt: row.createdAt.toISOString(),
      href: activityHref({ workerId: row.workerId, jobId: row.jobId, runId: row.runId, metadata }),
    };
  });
}
