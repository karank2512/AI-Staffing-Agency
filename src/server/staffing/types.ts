import type { JobSpecStatus, JobStatus } from "@prisma/client";
import type { WorkerProposal } from "@/server/domain/blueprint";
import type { JobFamily } from "@/server/domain/job-family";
import type { IntakeAnswers, JobSpec } from "@/server/domain/job-spec";

export type HireStep = "questions" | "spec" | "proposal";

/** Server-derived state of the multi-step hire flow for /hire?jobId=… (never trust client state for the step). */
export interface HireFlowState {
  /** latest spec missing → "questions" · latest spec DRAFT → "spec" · APPROVED → "proposal" */
  step: HireStep;
  job: { id: string; title: string; description: string; jobFamily: JobFamily; status: JobStatus };
  intake: IntakeAnswers | null;
  jobSpecId: string | null;
  spec: JobSpec | null;
  specStatus: JobSpecStatus | null;
  /** May be null on the proposal step → the page calls proposeWorker. */
  proposal: WorkerProposal | null;
}
