import type { VersionChangeReason, WorkerVersionStatus } from "@prisma/client";
import type { WorkerBlueprint } from "@/server/domain/blueprint";
import type { ReviewMetrics, WorkerScore } from "@/server/domain/evaluation";
import type { BlueprintDiff, ReplacementAnalysis } from "@/server/domain/replacement";

export interface VersionSummary {
  id: string;
  version: number;
  status: WorkerVersionStatus;
  changeReason: VersionChangeReason;
  changeSummary: string | null;
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
  locked: boolean;
  blueprint: WorkerBlueprint;
  runCount: number;
  score: WorkerScore;
  /** null when the version has 0 finished runs. */
  metrics: ReviewMetrics | null;
}

export interface VersionComparison {
  worker: { id: string; name: string; title: string; avatarColor: string };
  /** againstVersionId ?? target.parentVersionId — NOT "current", so the page stays valid after activation. null for v1. */
  base: VersionSummary | null;
  target: VersionSummary;
  diff: BlueprintDiff;
  /** null for SPEC_CHANGE / MANUAL versions (no failure analysis). */
  analysis: ReplacementAnalysis | null;
  /** target.status === "PROPOSED" */
  canDecide: boolean;
}
