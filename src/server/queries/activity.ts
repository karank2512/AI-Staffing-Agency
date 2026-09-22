import type { ActivityType, WorkerStatus } from "@prisma/client";
import { listActivity, type ActivityItem } from "@/server/activity";
import { db } from "@/server/db";

/**
 * Read side of /activity: the org feed with the filters the page exposes (worker, type group) and
 * cursor paging over `listActivity`'s `before`. Everything returned is plain JSON.
 */

/** Type groups as the filter bar shows them. NOTE is deliberately in no group: it only appears in "All". */
export const ACTIVITY_GROUPS = {
  runs: ["RUN_QUEUED", "RUN_STARTED", "RUN_SUCCEEDED", "RUN_FAILED", "RUN_CANCELLED", "TOOL_USED"],
  deliverables: ["DELIVERABLE_CREATED", "DELIVERABLE_ACCEPTED", "DELIVERABLE_REJECTED", "EVALUATION_COMPLETED", "REVIEW_GENERATED"],
  approvals: ["APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED"],
  hiring: [
    "JOB_CREATED",
    "JOB_SPEC_APPROVED",
    "WORKER_HIRED",
    "WORKER_PAUSED",
    "WORKER_RESUMED",
    "WORKER_RETIRED",
    "WORKER_REPLACED",
    "VERSION_PROPOSED",
    "VERSION_REJECTED",
  ],
  permissions: ["PERMISSION_CHANGED", "INSTRUCTION_RECEIVED"],
} as const satisfies Record<string, readonly ActivityType[]>;

export type ActivityGroup = keyof typeof ACTIVITY_GROUPS;

export const ACTIVITY_GROUP_LABELS: Record<ActivityGroup, string> = {
  runs: "Runs",
  deliverables: "Deliverables",
  approvals: "Approvals",
  hiring: "Hiring & changes",
  permissions: "Permissions & instructions",
};

export function isActivityGroup(value: string | undefined): value is ActivityGroup {
  return value !== undefined && Object.prototype.hasOwnProperty.call(ACTIVITY_GROUPS, value);
}

export interface ActivityFeedOptions {
  workerId?: string;
  group?: ActivityGroup;
  /** ISO cursor: only events strictly older than this. Invalid values are ignored. */
  before?: string;
  /** Default 40. */
  limit?: number;
}

export interface ActivityFeed {
  items: ActivityItem[];
  /** `createdAt` of the last item when more (older) events exist — pass it back as `before`. */
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 40;

function parseCursor(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** One page of the feed, newest first. Fetches one extra row to know whether a next page exists. */
export async function getActivityFeed(organizationId: string, opts: ActivityFeedOptions = {}): Promise<ActivityFeed> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
  const rows = await listActivity(organizationId, {
    workerId: opts.workerId,
    types: opts.group ? [...ACTIVITY_GROUPS[opts.group]] : undefined,
    before: parseCursor(opts.before),
    // listActivity caps at 200, so ask for limit + 1 only while that still fits.
    limit: Math.min(200, limit + 1),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? last.createdAt : null };
}

/** True while any run of the org is queued, running or waiting on a human — the feed is about to grow. */
export async function hasActivityInFlight(organizationId: string): Promise<boolean> {
  const count = await db.run.count({
    where: { organizationId, status: { in: ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"] } },
  });
  return count > 0;
}

export interface ActivityWorkerOption {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
  status: WorkerStatus;
}

/** Workers of the org for the feed's worker filter — retired ones included, their history is still relevant. */
export async function listActivityWorkers(organizationId: string): Promise<ActivityWorkerOption[]> {
  const rows = await db.worker.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, title: true, avatarColor: true, status: true },
  });
  return rows;
}

export interface ActivityDayGroup {
  /** yyyy-MM-dd in server-local time. */
  day: string;
  items: ActivityItem[];
}

/** Pure: bucket newest-first items by local calendar day, preserving order. */
export function groupActivityByDay(items: ActivityItem[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const current = groups[groups.length - 1];
    if (current && current.day === day) current.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
