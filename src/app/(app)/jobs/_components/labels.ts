import type { DeliverableFormat, RunTrigger } from "@prisma/client";

/** Contractor-style wording for enum values that have no StatusBadge mapping. Pure; safe in client files. */

export const TRIGGER_LABELS: Record<RunTrigger, string> = {
  MANUAL: "Run now",
  SCHEDULED: "Scheduled",
  RETRY: "Retry",
  CHAT: "From chat",
  HIRE: "First run",
};

export const FORMAT_LABELS: Record<DeliverableFormat, string> = {
  MARKDOWN: "Report",
  CSV: "CSV",
  JSON: "JSON",
};

export function triggerLabel(trigger: string): string {
  return (TRIGGER_LABELS as Record<string, string>)[trigger] ?? trigger;
}

export function formatLabel(format: string): string {
  return (FORMAT_LABELS as Record<string, string>)[format] ?? format;
}
