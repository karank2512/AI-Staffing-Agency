import type { DeliverableFormat, EvaluationType, ReviewRecommendation, RunTrigger } from "@prisma/client";
import type { StatusTone } from "@/lib/status";

/** Contractor-style labels for enums the profile shows in several tabs. Pure; safe in client leaves. */

const TRIGGER_LABELS: Record<RunTrigger, string> = {
  MANUAL: "On request",
  SCHEDULED: "Scheduled",
  RETRY: "Retry",
  CHAT: "From a conversation",
  HIRE: "First run",
};

export function triggerLabel(trigger: RunTrigger): string {
  return TRIGGER_LABELS[trigger] ?? trigger;
}

const FORMAT_LABELS: Record<DeliverableFormat, string> = {
  MARKDOWN: "Report",
  CSV: "CSV",
  JSON: "JSON",
};

export function formatLabel(format: DeliverableFormat): string {
  return FORMAT_LABELS[format] ?? format;
}

const EVALUATION_LABELS: Record<EvaluationType, { label: string; hint: string }> = {
  DETERMINISTIC: { label: "Automated checks", hint: "Rules from the blueprint: record counts, required fields, duplicates, sections, cost." },
  LLM_JUDGE: { label: "AI judge", hint: "A reviewer model scores the deliverable against the job's rubric." },
  USER_FEEDBACK: { label: "Your feedback", hint: "Accepted or rejected deliverables." },
};

export function evaluationLabel(type: EvaluationType): string {
  return EVALUATION_LABELS[type]?.label ?? type;
}

export function evaluationHint(type: EvaluationType): string {
  return EVALUATION_LABELS[type]?.hint ?? "";
}

export const RECOMMENDATION_META: Record<ReviewRecommendation, { label: string; tone: StatusTone; headline: (name: string) => string }> = {
  KEEP: { label: "Keep", tone: "success", headline: (name) => `Keep ${name} on the job` },
  IMPROVE: { label: "Improve", tone: "attention", headline: (name) => `${name} could do better` },
  REPLACE: { label: "Replace", tone: "failure", headline: (name) => `Time to replace ${name}` },
};

const OPERATION_LABELS: Record<string, string> = {
  validate_records: "Checks required fields",
  dedupe: "Removes duplicates",
  rank: "Ranks the results",
  filter: "Filters the results",
  compute_stats: "Computes statistics",
  to_csv: "Exports to CSV",
  compile_report: "Assembles the report",
};

export function operationLabel(operation: string | null): string {
  if (!operation) return "Deterministic step";
  return OPERATION_LABELS[operation] ?? operation.replace(/_/g, " ");
}
