import type {
  ApprovalStatus,
  DeliverableStatus,
  JobSpecStatus,
  JobStatus,
  RunStatus,
  WorkerHealth,
  WorkerStatus,
  WorkerVersionStatus,
} from "@prisma/client";
import { sentenceCase } from "@/lib/format";

/**
 * Single source of truth for how every lifecycle enum reads and which colour it gets. Pure (Prisma enums are
 * imported as TYPES only) so client components can use it. The `Record<Enum, …>` typing makes the compiler
 * fail when a schema enum gains a value that has no label here.
 */

/** success = emerald · attention = amber · failure = rose · running = sky · idle = slate */
export type StatusTone = "success" | "attention" | "failure" | "running" | "idle";

export type StatusKind = "run" | "worker" | "health" | "deliverable" | "version" | "approval" | "job" | "spec";

export interface StatusMeta {
  /** Humanized, contractor-style label. */
  label: string;
  tone: StatusTone;
  /** Animate the dot — reserved for work that is happening right now. */
  pulse?: boolean;
}

const RUN: Record<RunStatus, StatusMeta> = {
  QUEUED: { label: "Queued", tone: "idle" },
  RUNNING: { label: "Running", tone: "running", pulse: true },
  WAITING_FOR_APPROVAL: { label: "Needs approval", tone: "attention" },
  SUCCEEDED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "failure" },
  CANCELLED: { label: "Cancelled", tone: "idle" },
};

const WORKER: Record<WorkerStatus, StatusMeta> = {
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "attention" },
  RETIRED: { label: "Retired", tone: "idle" },
};

const HEALTH: Record<WorkerHealth, StatusMeta> = {
  UNKNOWN: { label: "Not enough data", tone: "idle" },
  HEALTHY: { label: "Healthy", tone: "success" },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "attention" },
};

const DELIVERABLE: Record<DeliverableStatus, StatusMeta> = {
  PENDING_REVIEW: { label: "Awaiting review", tone: "attention" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  REJECTED: { label: "Rejected", tone: "failure" },
};

const VERSION: Record<WorkerVersionStatus, StatusMeta> = {
  PROPOSED: { label: "Proposed", tone: "attention" },
  ACTIVE: { label: "Active", tone: "success" },
  REPLACED: { label: "Replaced", tone: "idle" },
  REJECTED: { label: "Declined", tone: "idle" },
};

const APPROVAL: Record<ApprovalStatus, StatusMeta> = {
  PENDING: { label: "Pending", tone: "attention" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "failure" },
  EXPIRED: { label: "Expired", tone: "idle" },
};

const JOB: Record<JobStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "idle" },
  SPEC_APPROVED: { label: "Ready to hire", tone: "running" },
  STAFFED: { label: "Staffed", tone: "success" },
  PAUSED: { label: "Paused", tone: "attention" },
  CLOSED: { label: "Closed", tone: "idle" },
};

const SPEC: Record<JobSpecStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "idle" },
  APPROVED: { label: "Approved", tone: "success" },
  SUPERSEDED: { label: "Superseded", tone: "idle" },
};

export const STATUS_META: Readonly<Record<StatusKind, Readonly<Record<string, StatusMeta>>>> = {
  run: RUN,
  worker: WORKER,
  health: HEALTH,
  deliverable: DELIVERABLE,
  version: VERSION,
  approval: APPROVAL,
  job: JOB,
  spec: SPEC,
};

/** Never throws: an unknown status (e.g. a newer enum value in old UI) falls back to a humanized idle label. */
export function getStatusMeta(kind: StatusKind, status: string): StatusMeta {
  return STATUS_META[kind]?.[status] ?? { label: sentenceCase(status), tone: "idle" };
}

/** Just the label, for sentences and tooltips ("Run is waiting: Needs approval"). */
export function statusLabel(kind: StatusKind, status: string): string {
  return getStatusMeta(kind, status).label;
}

/** Full static class strings per tone (Tailwind cannot see dynamically built class names). */
export const TONE_CLASSES: Readonly<Record<StatusTone, { badge: string; dot: string; text: string; soft: string }>> = {
  success: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
    text: "text-emerald-600",
    soft: "bg-emerald-50 text-emerald-700",
  },
  attention: {
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    text: "text-amber-600",
    soft: "bg-amber-50 text-amber-800",
  },
  failure: {
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
    text: "text-rose-600",
    soft: "bg-rose-50 text-rose-700",
  },
  running: {
    badge: "border-sky-200 bg-sky-50 text-sky-700",
    dot: "bg-sky-500",
    text: "text-sky-600",
    soft: "bg-sky-50 text-sky-700",
  },
  idle: {
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    dot: "bg-slate-400",
    text: "text-slate-500",
    soft: "bg-slate-100 text-slate-600",
  },
};

// ── Scores ──────────────────────────────────────────────────────────────────

export type ScoreBand = "good" | "fair" | "poor" | "none";

/**
 * Score bands used by ScoreRing and anywhere a 0..100 score is coloured: ≥ 80 good (emerald), 65–79 fair (amber),
 * < 65 poor (rose). Banding uses the ROUNDED score so the colour always agrees with the number on screen.
 */
export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  const rounded = Math.round(score);
  if (rounded >= 80) return "good";
  if (rounded >= 65) return "fair";
  return "poor";
}

export const SCORE_BAND_CLASSES: Readonly<Record<ScoreBand, { stroke: string; text: string; label: string }>> = {
  good: { stroke: "stroke-emerald-500", text: "text-emerald-600", label: "Strong" },
  fair: { stroke: "stroke-amber-500", text: "text-amber-600", label: "Mixed" },
  poor: { stroke: "stroke-rose-500", text: "text-rose-600", label: "Poor" },
  none: { stroke: "stroke-slate-300", text: "text-muted-foreground", label: "Not rated yet" },
};
