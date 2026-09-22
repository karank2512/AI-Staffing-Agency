import type { DeliverableFormatSlug } from "@/server/domain/job-spec";

/** Everything the PURE deterministic checker needs about one run's output. */
export interface EvalSubject {
  content: string;
  format: DeliverableFormatSlug;
  /** Deliverable.data when it is a records array, else null. */
  records: Array<Record<string, unknown>> | null;
  costUsd: number;
  /** Run.durationMs / 1000 (ACTIVE executing time only). */
  durationSec: number;
}
