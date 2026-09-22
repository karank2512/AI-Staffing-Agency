import type { ActivityType, ActorType } from "@prisma/client";

/**
 * Metadata key conventions — writers MUST set these; readers build links from them:
 *   DELIVERABLE_*                                   → { deliverableId }
 *   APPROVAL_*                                      → { approvalId, toolName }
 *   VERSION_PROPOSED / VERSION_REJECTED / WORKER_REPLACED → { versionId, version, changeReason }
 *   REVIEW_GENERATED                                → { reviewId, recommendation }
 *   TOOL_USED                                       → { toolName }
 *   RUN_*                                           → set the runId column
 * Link precedence when rendering: deliverableId → /deliverables/:id · approvalId → /approvals ·
 * versionId → /workers/:workerId/replace/:versionId · runId → /runs/:id · workerId → /workers/:id
 */
export interface ActivityMetadata {
  deliverableId?: string;
  approvalId?: string;
  versionId?: string;
  version?: number;
  changeReason?: string;
  reviewId?: string;
  recommendation?: string;
  toolName?: string;
  [key: string]: unknown;
}

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  detail: string | null;
  actorType: ActorType;
  actorName: string | null;
  workerId: string | null;
  jobId: string | null;
  runId: string | null;
  worker: { id: string; name: string; avatarColor: string } | null;
  metadata: ActivityMetadata;
  /** ISO string */
  createdAt: string;
  /** Pre-computed link target following the precedence above (null = not linkable). */
  href: string | null;
}
