import type { RunStepKind, RunStepStatus, RunTrigger, ToolCallStatus } from "@prisma/client";
import type { StatusTone } from "@/lib/status";

/**
 * Pure lookups shared by the timeline pieces (Prisma enums are type-only imports, so this is client-safe).
 * Labels are contractor-style: a step is something the worker did, not something the system executed. There
 * are deliberately no icons here — the timeline carries state in a single coloured dot per step.
 */

export const STEP_KIND_LABEL: Record<RunStepKind, string> = {
  PLAN: "Plan",
  MODEL_CALL: "Thinking",
  TOOL_CALL: "Tool",
  DETERMINISTIC: "Processing",
  APPROVAL: "Approval",
  DELIVERABLE: "Deliverable",
  EVALUATION: "Evaluation",
  NOTE: "Note",
  ERROR: "Problem",
};

export const STEP_STATUS_META: Record<RunStepStatus, { label: string; tone: StatusTone; pulse?: boolean }> = {
  PENDING: { label: "Pending", tone: "idle" },
  RUNNING: { label: "In progress", tone: "running", pulse: true },
  WAITING: { label: "Waiting for you", tone: "attention", pulse: true },
  SUCCEEDED: { label: "Done", tone: "success" },
  FAILED: { label: "Failed", tone: "failure" },
  SKIPPED: { label: "Skipped", tone: "idle" },
};

export const TOOL_CALL_STATUS_META: Record<ToolCallStatus, { label: string; tone: StatusTone }> = {
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "attention" },
  APPROVED: { label: "Approved", tone: "success" },
  RUNNING: { label: "Running", tone: "running" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "failure" },
  DENIED: { label: "Declined", tone: "failure" },
};

export const TRIGGER_LABEL: Record<RunTrigger, string> = {
  MANUAL: "Started manually",
  SCHEDULED: "Scheduled run",
  RETRY: "Retry of an earlier run",
  CHAT: "Started from a conversation",
  HIRE: "First run after hiring",
};

/** Deterministic steps report `{ before, after }` record counts when they filter a list. */
export function recordCounts(output: unknown): { before: number; after: number } | null {
  const o = output as { before?: unknown; after?: unknown } | null;
  return typeof o?.before === "number" && typeof o?.after === "number" ? { before: o.before, after: o.after } : null;
}

/** Deliverable steps store the id they created in their output. */
export function deliverableIdOf(output: unknown): string | null {
  const id = (output as { deliverableId?: unknown } | null)?.deliverableId;
  return typeof id === "string" ? id : null;
}
