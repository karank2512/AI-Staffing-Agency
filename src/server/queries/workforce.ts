import type { RunStatus, UserRole, WorkerHealth, WorkerStatus } from "@prisma/client";
import { endOfMonth, startOfDay, startOfMonth, subDays, subMonths } from "date-fns";
import { listActivity, type ActivityItem } from "@/server/activity";
import { db } from "@/server/db";
import { describeCadence, workerFieldsToCadence } from "@/server/domain";
import { llm } from "@/server/models";
import { TERMINAL_RUN_STATUSES } from "@/server/runtime/types";
import { getUsageSummary } from "@/server/usage";
import { listApprovals } from "./approvals";
import { permissionSubset, WORKFORCE_PERMISSION_KEYS, type WorkforcePermissions } from "./permissions";

/**
 * Read side of /workforce, the home page: headline numbers, the "Needs your attention" strip, the roster and the
 * latest activity, in one org-scoped call. Everything returned is plain JSON (numbers, ISO strings).
 */

const IN_FLIGHT: readonly RunStatus[] = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"];
/** How far back failed runs / rejected deliverables stay on the attention strip. */
const ATTENTION_WINDOW_DAYS = 7;
const ATTENTION_ITEMS_PER_KIND = 3;
/** Candidates fetched per kind before dropping the ones already dealt with (see unresolvedFailedRuns). */
const ATTENTION_CANDIDATES = 25;
const RECENT_ACTIVITY_LIMIT = 12;

export interface WorkforceStats {
  activeWorkers: number;
  pausedWorkers: number;
  retiredWorkers: number;
  /** Runs created since local midnight. */
  runsToday: number;
  runsInFlight: number;
  deliverablesAwaitingReview: number;
  deliverablesTotal: number;
  spendThisMonthUsd: number;
  spendLastMonthUsd: number;
  /** Daily cost from the 1st of the month to today, oldest first (sparkline). */
  spendByDay: number[];
  /** True when every dollar this month came from Simulated-mode calls (priced, not spent). */
  spendSimulated: boolean;
}

interface AttentionWorker {
  workerId: string;
  workerName: string;
  avatarColor: string;
}

export type AttentionItem =
  | (AttentionWorker & {
      kind: "approval";
      approvalId: string;
      title: string;
      description: string | null;
      toolLabel: string;
      /** The exact tool input awaiting approval (plain JSON) — shown before the user can approve from the strip. */
      payload: unknown;
      runId: string;
      requestedAt: string;
    })
  | (AttentionWorker & { kind: "health"; workerTitle: string; reason: string | null; score: number | null })
  | (AttentionWorker & { kind: "run_failed"; runId: string; error: string | null; at: string })
  | (AttentionWorker & { kind: "deliverable_rejected"; deliverableId: string; title: string; feedback: string | null; at: string });

export interface WorkerCardView {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
  jobId: string;
  jobTitle: string;
  status: WorkerStatus;
  health: WorkerHealth;
  healthReason: string | null;
  /** 0..100 */
  score: number | null;
  /** "Weekly on Monday at 9am" */
  schedule: string;
  nextRunAt: string | null;
  /** Most recent finished run. */
  lastRun: { id: string; status: RunStatus; at: string } | null;
  /** A run that is queued, running or waiting on you right now (the oldest one when several). */
  activeRun: { id: string; status: RunStatus } | null;
  costThisMonthUsd: number;
  deliverables: number;
  deliverablesAwaitingReview: number;
  hiredAt: string;
}

export interface WorkforceView {
  simulated: boolean;
  /** What the viewer's role may do here — the page hides or disables the rest (the server enforces it anyway). */
  permissions: WorkforcePermissions;
  stats: WorkforceStats;
  /** Ordered by urgency: approvals → workers needing attention → failed runs → rejected deliverables. */
  attention: AttentionItem[];
  /** Non-retired workers; those needing attention first, then active before paused, then by name. */
  workers: WorkerCardView[];
  recentActivity: ActivityItem[];
  hasRunsInFlight: boolean;
}

const HEALTH_RANK: Record<WorkerHealth, number> = { NEEDS_ATTENTION: 0, HEALTHY: 1, UNKNOWN: 2 };
const STATUS_RANK: Record<WorkerStatus, number> = { ACTIVE: 0, PAUSED: 1, RETIRED: 2 };

function rosterOrder(a: WorkerCardView, b: WorkerCardView): number {
  return (
    HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Only work from a worker's CURRENT version counts (replacing or rolling back a version is how the user deals with
 * its failures), and never a retired worker's: the version must still be the `currentFor` of a non-retired worker.
 */
const CURRENT_VERSION_OF_SEATED_WORKER = { currentFor: { is: { status: { not: "RETIRED" as const } } } };

/**
 * Failed runs from the window that nobody has followed up on yet. A failure is resolved once the same worker has a
 * later run that succeeded, or a later retry (whose own outcome then speaks for it: a failed retry is listed itself).
 */
async function unresolvedFailedRuns(organizationId: string, since: Date) {
  const failed = await db.run.findMany({
    where: { organizationId, status: "FAILED", finishedAt: { gte: since }, workerVersion: CURRENT_VERSION_OF_SEATED_WORKER },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    take: ATTENTION_CANDIDATES,
    select: { id: true, workerId: true, error: true, finishedAt: true, createdAt: true, worker: { select: { name: true, avatarColor: true } } },
  });
  if (failed.length === 0) return [];

  const oldest = new Date(Math.min(...failed.map((r) => r.createdAt.getTime())));
  const followUps = await db.run.groupBy({
    by: ["workerId"],
    where: {
      organizationId,
      workerId: { in: [...new Set(failed.map((r) => r.workerId))] },
      createdAt: { gt: oldest },
      OR: [{ status: "SUCCEEDED" }, { trigger: "RETRY" }],
    },
    _max: { createdAt: true },
  });
  const latestFollowUp = new Map(followUps.map((g) => [g.workerId, g._max.createdAt]));
  return failed
    .filter((r) => {
      const followUp = latestFollowUp.get(r.workerId);
      return !followUp || followUp <= r.createdAt;
    })
    .slice(0, ATTENTION_ITEMS_PER_KIND);
}

/** Rejected deliverables from the window, minus those the same worker has since made up for with accepted work. */
async function unresolvedRejections(organizationId: string, since: Date) {
  const rejected = await db.deliverable.findMany({
    where: { organizationId, status: "REJECTED", reviewedAt: { gte: since }, workerVersion: CURRENT_VERSION_OF_SEATED_WORKER },
    orderBy: [{ reviewedAt: "desc" }, { id: "desc" }],
    take: ATTENTION_CANDIDATES,
    select: { id: true, title: true, feedback: true, reviewedAt: true, createdAt: true, workerId: true, worker: { select: { name: true, avatarColor: true } } },
  });
  if (rejected.length === 0) return [];

  const oldest = new Date(Math.min(...rejected.map((d) => d.createdAt.getTime())));
  const accepted = await db.deliverable.groupBy({
    by: ["workerId"],
    where: { organizationId, workerId: { in: [...new Set(rejected.map((d) => d.workerId))] }, status: "ACCEPTED", createdAt: { gt: oldest } },
    _max: { createdAt: true },
  });
  const latestAccepted = new Map(accepted.map((g) => [g.workerId, g._max.createdAt]));
  return rejected
    .filter((d) => {
      const acceptedAt = latestAccepted.get(d.workerId);
      return !acceptedAt || acceptedAt <= d.createdAt;
    })
    .slice(0, ATTENTION_ITEMS_PER_KIND);
}

export async function getWorkforce(
  organizationId: string,
  now: Date = new Date(),
  opts: { role?: UserRole } = {},
): Promise<WorkforceView> {
  const monthStart = startOfMonth(now);
  const lastMonth = subMonths(now, 1);
  const attentionSince = subDays(now, ATTENTION_WINDOW_DAYS);

  const [
    workerRows,
    retiredWorkers,
    inFlightRuns,
    runsToday,
    deliverablesAwaitingReview,
    deliverablesTotal,
    pendingByWorker,
    usage,
    lastMonthUsage,
    pendingApprovals,
    failedRuns,
    rejectedDeliverables,
    recentActivity,
  ] = await Promise.all([
    db.worker.findMany({
      where: { organizationId, status: { not: "RETIRED" } },
      select: {
        id: true,
        name: true,
        title: true,
        avatarColor: true,
        jobId: true,
        status: true,
        health: true,
        healthReason: true,
        score: true,
        scheduleKind: true,
        scheduleHour: true,
        scheduleDow: true,
        nextRunAt: true,
        hiredAt: true,
        job: { select: { title: true } },
        runs: {
          where: { status: { in: [...TERMINAL_RUN_STATUSES] } },
          orderBy: [{ createdAt: "desc" }],
          take: 1,
          select: { id: true, status: true, finishedAt: true, createdAt: true },
        },
        _count: { select: { deliverables: true } },
      },
    }),
    db.worker.count({ where: { organizationId, status: "RETIRED" } }),
    db.run.findMany({
      where: { organizationId, status: { in: [...IN_FLIGHT] } },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, workerId: true, status: true },
    }),
    db.run.count({ where: { organizationId, createdAt: { gte: startOfDay(now) } } }),
    db.deliverable.count({ where: { organizationId, status: "PENDING_REVIEW" } }),
    db.deliverable.count({ where: { organizationId } }),
    db.deliverable.groupBy({ by: ["workerId"], where: { organizationId, status: "PENDING_REVIEW" }, _count: { _all: true } }),
    getUsageSummary(organizationId, { from: monthStart, to: now }),
    getUsageSummary(organizationId, { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) }),
    listApprovals(organizationId, { status: "PENDING" }),
    unresolvedFailedRuns(organizationId, attentionSince),
    unresolvedRejections(organizationId, attentionSince),
    listActivity(organizationId, { limit: RECENT_ACTIVITY_LIMIT }),
  ]);

  const activeRunByWorker = new Map<string, { id: string; status: RunStatus }>();
  for (const run of inFlightRuns) {
    // Oldest first, so the first one seen per worker is the one actually being worked on.
    if (!activeRunByWorker.has(run.workerId)) activeRunByWorker.set(run.workerId, { id: run.id, status: run.status });
  }
  const pendingReviewByWorker = new Map(pendingByWorker.map((g) => [g.workerId, g._count._all]));
  const costByWorker = new Map(usage.byWorker.filter((w) => w.workerId !== null).map((w) => [w.workerId as string, w.costUsd]));

  const workers: WorkerCardView[] = workerRows
    .map((w) => {
      const last = w.runs[0];
      return {
        id: w.id,
        name: w.name,
        title: w.title,
        avatarColor: w.avatarColor,
        jobId: w.jobId,
        jobTitle: w.job.title,
        status: w.status,
        health: w.health,
        healthReason: w.healthReason,
        score: w.score,
        schedule: describeCadence(workerFieldsToCadence(w)),
        nextRunAt: w.nextRunAt?.toISOString() ?? null,
        lastRun: last ? { id: last.id, status: last.status, at: (last.finishedAt ?? last.createdAt).toISOString() } : null,
        activeRun: activeRunByWorker.get(w.id) ?? null,
        costThisMonthUsd: costByWorker.get(w.id) ?? 0,
        deliverables: w._count.deliverables,
        deliverablesAwaitingReview: pendingReviewByWorker.get(w.id) ?? 0,
        hiredAt: w.hiredAt.toISOString(),
      };
    })
    .sort(rosterOrder);

  const attention: AttentionItem[] = [
    ...pendingApprovals
      .slice()
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
      .map((a): AttentionItem => ({
        kind: "approval",
        approvalId: a.id,
        title: a.title,
        description: a.description,
        toolLabel: a.toolLabel,
        payload: a.payload,
        runId: a.runId,
        requestedAt: a.requestedAt,
        workerId: a.worker.id,
        workerName: a.worker.name,
        avatarColor: a.worker.avatarColor,
      })),
    ...workers
      .filter((w) => w.health === "NEEDS_ATTENTION")
      .map((w): AttentionItem => ({
        kind: "health",
        workerId: w.id,
        workerName: w.name,
        avatarColor: w.avatarColor,
        workerTitle: w.title,
        reason: w.healthReason,
        score: w.score,
      })),
    ...failedRuns.map((r): AttentionItem => ({
      kind: "run_failed",
      runId: r.id,
      error: r.error,
      at: (r.finishedAt ?? r.createdAt).toISOString(),
      workerId: r.workerId,
      workerName: r.worker.name,
      avatarColor: r.worker.avatarColor,
    })),
    ...rejectedDeliverables.map((d): AttentionItem => ({
      kind: "deliverable_rejected",
      deliverableId: d.id,
      title: d.title,
      feedback: d.feedback,
      at: (d.reviewedAt ?? d.createdAt).toISOString(),
      workerId: d.workerId,
      workerName: d.worker.name,
      avatarColor: d.worker.avatarColor,
    })),
  ];

  return {
    simulated: llm.isSimulated(),
    permissions: permissionSubset(opts.role, WORKFORCE_PERMISSION_KEYS),
    stats: {
      activeWorkers: workers.filter((w) => w.status === "ACTIVE").length,
      pausedWorkers: workers.filter((w) => w.status === "PAUSED").length,
      retiredWorkers,
      runsToday,
      runsInFlight: inFlightRuns.length,
      deliverablesAwaitingReview,
      deliverablesTotal,
      spendThisMonthUsd: usage.totals.costUsd,
      spendLastMonthUsd: lastMonthUsage.totals.costUsd,
      spendByDay: usage.byDay.map((d) => d.costUsd),
      spendSimulated: usage.totals.costUsd > 0 && usage.totals.simulatedCostUsd >= usage.totals.costUsd,
    },
    attention,
    workers,
    recentActivity,
    hasRunsInFlight: inFlightRuns.length > 0,
  };
}
