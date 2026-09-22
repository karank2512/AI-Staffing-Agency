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

/**
 * The five tones, and the tokens they map to (docs/DESIGN.md):
 * success → --success green · attention → --warning orange ("waiting on you") · failure → --danger red ·
 * running → --info blue · idle → neutral gray. Status colour only ever appears in a 7px dot or short text;
 * the soft fills are reserved for the one state that needs a person.
 */
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
    badge: "border-transparent bg-success-soft text-success",
    dot: "bg-success",
    text: "text-success",
    soft: "bg-success-soft text-success",
  },
  attention: {
    badge: "border-transparent bg-warning-soft text-warning",
    dot: "bg-warning",
    text: "text-warning",
    soft: "bg-warning-soft text-warning",
  },
  failure: {
    badge: "border-transparent bg-danger-soft text-danger",
    dot: "bg-danger",
    text: "text-danger",
    soft: "bg-danger-soft text-danger",
  },
  running: {
    badge: "border-transparent bg-info-soft text-info",
    dot: "bg-info",
    text: "text-info",
    soft: "bg-info-soft text-info",
  },
  idle: {
    badge: "border-transparent bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    soft: "bg-muted text-muted-foreground",
  },
};

// ── Scores ──────────────────────────────────────────────────────────────────

export type ScoreBand = "good" | "fair" | "poor" | "none";

/**
 * Score bands used by ScoreRing and anywhere a 0..100 score is coloured: >= 80 "Strong", 65–79 "Watch",
 * < 65 "At risk". Banding uses the ROUNDED score so the colour always agrees with the number on screen.
 */
export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  const rounded = Math.round(score);
  if (rounded >= 80) return "good";
  if (rounded >= 65) return "fair";
  return "poor";
}

export const SCORE_BAND_CLASSES: Readonly<Record<ScoreBand, { stroke: string; text: string; label: string }>> = {
  good: { stroke: "stroke-success", text: "text-success", label: "Strong" },
  fair: { stroke: "stroke-warning", text: "text-warning", label: "Watch" },
  poor: { stroke: "stroke-danger", text: "text-danger", label: "At risk" },
  none: { stroke: "stroke-input", text: "text-muted-foreground", label: "Not rated yet" },
};
