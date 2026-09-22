import type { ActivityType, ActorType, Prisma } from "@prisma/client";
import { db, toJson, type DbOrTx } from "@/server/db";
import { errorMessage } from "@/server/errors";
import type { ActivityMetadata } from "./types";

export interface RecordActivityInput {
  organizationId: string;
  type: ActivityType;
  /** Humanized headline: "Alex delivered 'AI Infra Funding Report — Week 37'". */
  title: string;
  detail?: string;
  workerId?: string;
  jobId?: string;
  runId?: string;
  /** Defaults to SYSTEM. */
  actorType?: ActorType;
  actorName?: string;
  metadata?: ActivityMetadata;
}

/**
 * Append an event to the organization's activity feed.
 *
 * - WITHOUT `tx`: best-effort. The feed is an audit nicety, so a failure here is logged and must
 *   never break the mutation that already committed.
 * - WITH `tx`: errors propagate. A failed statement has already aborted the Postgres transaction,
 *   so swallowing it would only hide the reason the caller's next query fails.
 */
export async function recordActivity(e: RecordActivityInput, tx?: DbOrTx): Promise<void> {
  const data: Prisma.ActivityEventUncheckedCreateInput = {
    organizationId: e.organizationId,
    type: e.type,
    title: e.title,
    detail: e.detail ?? null,
    workerId: e.workerId ?? null,
    jobId: e.jobId ?? null,
    runId: e.runId ?? null,
    actorType: e.actorType ?? "SYSTEM",
    actorName: e.actorName ?? null,
    ...(e.metadata !== undefined ? { metadata: toJson(e.metadata) } : {}),
  };

  if (tx) {
    await tx.activityEvent.create({ data });
    return;
  }

  try {
    await db.activityEvent.create({ data });
  } catch (err) {
    console.error(`[activity] failed to record ${e.type} for org ${e.organizationId}: ${errorMessage(err)}`);
  }
}
