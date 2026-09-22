import type {
  DeliverableFormat,
  DeliverableStatus,
  JobStatus,
  JobSpecStatus,
  RunStatus,
  RunTrigger,
  WorkerHealth,
  WorkerStatus,
} from "@prisma/client";
import { listActivity, type ActivityItem } from "@/server/activity";
import { db } from "@/server/db";
import {
  JOB_FAMILY_INFO,
  JobSpecSchema,
  describeCadence,
  workerFieldsToCadence,
  type JobFamily,
  type JobSpec,
} from "@/server/domain";
import { notFound } from "@/server/errors";

/**
 * Read models for /jobs and /jobs/[jobId]. Everything is org-scoped and plain JSON (Decimal → Number,
 * Date → ISO string) so pages can hand it straight to client leaves.
 */

const JOB_STATUSES: readonly JobStatus[] = ["DRAFT", "SPEC_APPROVED", "STAFFED", "PAUSED", "CLOSED"];
const IN_FLIGHT: readonly RunStatus[] = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"];
/** Workers that still "hold the seat": they block re-hiring and closing. */
const SEATED: readonly WorkerStatus[] = ["ACTIVE", "PAUSED"];

const RECENT_RUNS = 15;
const RECENT_DELIVERABLES = 15;
const ACTIVITY_LIMIT = 25;

/** `?status=` from the URL → a JobStatus, or null for "all" / anything unknown. */
export function parseJobStatusFilter(value: string | undefined): JobStatus | null {
  if (!value) return null;
  const upper = value.toUpperCase() as JobStatus;
  return JOB_STATUSES.includes(upper) ? upper : null;
}

function familyLabel(slug: string): string {
  return (JOB_FAMILY_INFO as Record<string, { label: string }>)[slug]?.label ?? "General Operations";
}

/** Setup-stage jobs continue in the hire flow; everything else has a history page. */
export function jobHref(job: { id: string; status: JobStatus }): string {
  return job.status === "DRAFT" || job.status === "SPEC_APPROVED" ? `/hire?jobId=${job.id}` : `/jobs/${job.id}`;
}

// ── /jobs ───────────────────────────────────────────────────────────────────

export interface JobWorkerSummary {
  id: string;
  name: string;
  title: string;
  avatarColor: string;
  status: WorkerStatus;
}

export interface JobListItem {
  id: string;
  title: string;
  jobFamily: string;
  familyLabel: string;
  status: JobStatus;
  /** The worker currently holding the seat (ACTIVE or PAUSED), or null. */
  worker: JobWorkerSummary | null;
  /** Humanized cadence ("Weekly on Monday at 9am"); from the worker's live schedule, else the spec. */
  cadence: string | null;
  lastRunAt: string | null;
  deliverables: number;
  createdAt: string;
  /** Primary link: /hire?jobId= while setting up, /jobs/[id] afterwards. */
  href: string;
  /** Whether the job has ever had a worker — setup-stage jobs with history get a secondary "Details" link. */
  hasHistory: boolean;
}

export interface JobsListView {
  jobs: JobListItem[];
  filter: JobStatus | null;
  counts: Record<JobStatus | "all", number>;
  hasRunsInFlight: boolean;
}

export async function listJobs(organizationId: string, opts: { status?: JobStatus | null } = {}): Promise<JobsListView> {
  const filter = opts.status ?? null;
  const [rows, grouped, inFlight] = await Promise.all([
    db.job.findMany({
      where: { organizationId, ...(filter ? { status: filter } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        workers: { orderBy: { hiredAt: "desc" }, select: { id: true, name: true, title: true, avatarColor: true, status: true, scheduleKind: true, scheduleHour: true, scheduleDow: true } },
        specs: { where: { status: { in: ["APPROVED", "DRAFT"] } }, orderBy: { version: "desc" }, take: 1, select: { spec: true } },
        runs: { where: { status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { finishedAt: true, createdAt: true } },
        _count: { select: { deliverables: true } },
      },
    }),
    db.job.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
    db.run.count({ where: { organizationId, status: { in: [...IN_FLIGHT] } } }),
  ]);

  const counts: Record<JobStatus | "all", number> = { all: 0, DRAFT: 0, SPEC_APPROVED: 0, STAFFED: 0, PAUSED: 0, CLOSED: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }

  const jobs = rows.map((job): JobListItem => {
    const seated = job.workers.find((w) => SEATED.includes(w.status)) ?? null;
    const spec = job.specs[0] ? JobSpecSchema.safeParse(job.specs[0].spec) : null;
    const cadence = seated
      ? describeCadence(workerFieldsToCadence(seated))
      : spec?.success
        ? describeCadence(spec.data.cadence)
        : null;
    const lastRun = job.runs[0];
    return {
      id: job.id,
      title: job.title,
      jobFamily: job.jobFamily,
      familyLabel: familyLabel(job.jobFamily),
      status: job.status,
      worker: seated ? { id: seated.id, name: seated.name, title: seated.title, avatarColor: seated.avatarColor, status: seated.status } : null,
      cadence,
      lastRunAt: lastRun ? (lastRun.finishedAt ?? lastRun.createdAt).toISOString() : null,
      deliverables: job._count.deliverables,
      createdAt: job.createdAt.toISOString(),
      href: jobHref(job),
      hasHistory: job.workers.length > 0,
    };
  });

  return { jobs, filter, counts, hasRunsInFlight: inFlight > 0 };
}

// ── /jobs/[jobId] ───────────────────────────────────────────────────────────

export interface JobSpecVersionItem {
  id: string;
  version: number;
  status: JobSpecStatus;
  approvedAt: string | null;
  createdAt: string;
  /** True for the version rendered on the page. */
  shown: boolean;
}

export interface JobWorkerItem extends JobWorkerSummary {
  health: WorkerHealth;
  score: number | null;
  hiredAt: string;
  retiredAt: string | null;
  lastRunAt: string | null;
  /** Number of the version currently in charge (null when the worker has none). */
  versionNumber: number | null;
  runs: number;
}

export interface JobRunItem {
  id: string;
  status: RunStatus;
  trigger: RunTrigger;
  simulated: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number;
  error: string | null;
  worker: { id: string; name: string; avatarColor: string };
  deliverable: { id: string; title: string } | null;
}

export interface JobDeliverableItem {
  id: string;
  title: string;
  status: DeliverableStatus;
  format: DeliverableFormat;
  createdAt: string;
  runId: string;
  worker: { id: string; name: string; avatarColor: string };
}

export interface JobDetailView {
  job: {
    id: string;
    title: string;
    description: string;
    jobFamily: JobFamily | string;
    familyLabel: string;
    status: JobStatus;
    createdAt: string;
    updatedAt: string;
  };
  /** The approved spec (or the latest one while still drafting); null before scoping produced one. */
  spec: JobSpec | null;
  specVersions: JobSpecVersionItem[];
  workers: JobWorkerItem[];
  currentWorker: JobWorkerItem | null;
  runs: JobRunItem[];
  deliverables: JobDeliverableItem[];
  activity: ActivityItem[];
  stats: { runs: number; succeeded: number; failed: number; deliverables: number; accepted: number; totalCostUsd: number };
  can: {
    /** SPEC_APPROVED and nobody holds the seat → /hire?jobId= */
    hire: boolean;
    /** DRAFT → the hire flow still needs answers / approval. */
    continueSetup: boolean;
    /** Not DRAFT/CLOSED and nobody holds the seat. */
    close: boolean;
    /** DRAFT/SPEC_APPROVED with no worker ever hired (mirrors staffing.discardJob). */
    discard: boolean;
  };
  hasRunsInFlight: boolean;
}

export async function getJobDetail(organizationId: string, jobId: string): Promise<JobDetailView> {
  const job = await db.job.findFirst({
    where: { id: jobId, organizationId },
    include: {
      specs: { orderBy: { version: "desc" } },
      workers: {
        orderBy: { hiredAt: "desc" },
        include: { currentVersion: { select: { version: true } }, _count: { select: { runs: true } } },
      },
    },
  });
  if (!job) throw notFound("Job");

  const [runs, deliverables, activity, runGroups, costAgg, deliverableGroups] = await Promise.all([
    db.run.findMany({
      where: { jobId: job.id, organizationId },
      orderBy: { createdAt: "desc" },
      take: RECENT_RUNS,
      include: {
        worker: { select: { id: true, name: true, avatarColor: true } },
        deliverables: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, title: true } },
      },
    }),
    db.deliverable.findMany({
      where: { jobId: job.id, organizationId },
      orderBy: { createdAt: "desc" },
      take: RECENT_DELIVERABLES,
      include: { worker: { select: { id: true, name: true, avatarColor: true } } },
    }),
    listActivity(organizationId, { jobId: job.id, limit: ACTIVITY_LIMIT }),
    db.run.groupBy({ by: ["status"], where: { jobId: job.id, organizationId }, _count: { _all: true } }),
    db.run.aggregate({ where: { jobId: job.id, organizationId }, _sum: { costUsd: true } }),
    db.deliverable.groupBy({ by: ["status"], where: { jobId: job.id, organizationId }, _count: { _all: true } }),
  ]);

  // The spec people approved is the one that matters; while drafting, show the draft so the page is never blank.
  const shownRow = job.specs.find((s) => s.status === "APPROVED") ?? job.specs[0] ?? null;
  const parsed = shownRow ? JobSpecSchema.safeParse(shownRow.spec) : null;
  const spec = parsed?.success ? parsed.data : null;

  const workers = job.workers.map(
    (w): JobWorkerItem => ({
      id: w.id,
      name: w.name,
      title: w.title,
      avatarColor: w.avatarColor,
      status: w.status,
      health: w.health,
      score: w.score,
      hiredAt: w.hiredAt.toISOString(),
      retiredAt: w.retiredAt?.toISOString() ?? null,
      lastRunAt: w.lastRunAt?.toISOString() ?? null,
      versionNumber: w.currentVersion?.version ?? null,
      runs: w._count.runs,
    }),
  );
  const currentWorker = workers.find((w) => SEATED.includes(w.status)) ?? null;
  const seatTaken = currentWorker !== null;

  const runCount = (status: RunStatus) => runGroups.find((g) => g.status === status)?._count._all ?? 0;
  const stats = {
    runs: runGroups.reduce((acc, g) => acc + g._count._all, 0),
    succeeded: runCount("SUCCEEDED"),
    failed: runCount("FAILED"),
    deliverables: deliverableGroups.reduce((acc, g) => acc + g._count._all, 0),
    accepted: deliverableGroups.find((g) => g.status === "ACCEPTED")?._count._all ?? 0,
    totalCostUsd: Number(costAgg._sum.costUsd ?? 0),
  };

  return {
    job: {
      id: job.id,
      title: job.title,
      description: job.description,
      jobFamily: job.jobFamily,
      familyLabel: familyLabel(job.jobFamily),
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    },
    spec,
    specVersions: job.specs.map((s) => ({
      id: s.id,
      version: s.version,
      status: s.status,
      approvedAt: s.approvedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      shown: s.id === shownRow?.id,
    })),
    workers,
    currentWorker,
    runs: runs.map(
      (r): JobRunItem => ({
        id: r.id,
        status: r.status,
        trigger: r.trigger,
        simulated: r.simulated,
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt?.toISOString() ?? null,
        finishedAt: r.finishedAt?.toISOString() ?? null,
        durationMs: r.durationMs,
        costUsd: Number(r.costUsd),
        error: r.error,
        worker: r.worker,
        deliverable: r.deliverables[0] ?? null,
      }),
    ),
    deliverables: deliverables.map(
      (d): JobDeliverableItem => ({
        id: d.id,
        title: d.title,
        status: d.status,
        format: d.format,
        createdAt: d.createdAt.toISOString(),
        runId: d.runId,
        worker: d.worker,
      }),
    ),
    activity,
    stats,
    can: {
      hire: job.status === "SPEC_APPROVED" && !seatTaken,
      continueSetup: job.status === "DRAFT",
      close: job.status !== "DRAFT" && job.status !== "CLOSED" && !seatTaken,
      discard: (job.status === "DRAFT" || job.status === "SPEC_APPROVED") && job.workers.length === 0,
    },
    hasRunsInFlight: runs.some((r) => IN_FLIGHT.includes(r.status)),
  };
}
