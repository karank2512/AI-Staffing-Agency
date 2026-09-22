import type { ActivityMetadata } from "./types";

/** Structural subset of ActivityItem, so both DB rows and view models can be passed. */
export interface ActivityHrefInput {
  workerId?: string | null;
  jobId?: string | null;
  runId?: string | null;
  metadata?: ActivityMetadata | null;
}

const idOf = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const seg = (id: string) => encodeURIComponent(id);

/**
 * Link target for an activity row. Precedence (documented in activity/types.ts):
 * deliverableId → approvalId → versionId (needs workerId) → runId → workerId.
 * A job-only event (JOB_CREATED, JOB_SPEC_APPROVED) falls back to its job page; otherwise null.
 */
export function activityHref(item: ActivityHrefInput): string | null {
  const meta = item.metadata ?? {};
  const workerId = idOf(item.workerId);

  const deliverableId = idOf(meta.deliverableId);
  if (deliverableId) return `/deliverables/${seg(deliverableId)}`;

  if (idOf(meta.approvalId)) return "/approvals";

  const versionId = idOf(meta.versionId);
  if (versionId && workerId) return `/workers/${seg(workerId)}/replace/${seg(versionId)}`;

  const runId = idOf(item.runId);
  if (runId) return `/runs/${seg(runId)}`;

  if (workerId) return `/workers/${seg(workerId)}`;

  const jobId = idOf(item.jobId);
  if (jobId) return `/jobs/${seg(jobId)}`;

  return null;
}
