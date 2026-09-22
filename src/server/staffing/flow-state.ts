import { JobFamilySchema, detectJobFamily } from "@/server/domain";
import { notFound } from "@/server/errors";
import { getJob, latestOpenSpec, parseIntake, parseProposal, parseStoredSpec } from "./jobs";
import type { HireFlowState, HireStep } from "./types";

/**
 * The /hire?jobId= page derives its step from here, never from client state: no spec yet → questions,
 * draft spec → spec, approved spec → proposal. Once the job is staffed there is nothing left to resume.
 */
export async function getHireFlowState(organizationId: string, jobId: string): Promise<HireFlowState> {
  const job = await getJob(organizationId, jobId);
  if (job.status !== "DRAFT" && job.status !== "SPEC_APPROVED") throw notFound("Hire flow");

  const family = JobFamilySchema.safeParse(job.jobFamily);
  const jobFamily = family.success ? family.data : detectJobFamily(job.description);
  const latest = await latestOpenSpec(job.id);
  const step: HireStep = !latest ? "questions" : latest.status === "APPROVED" ? "proposal" : "spec";

  return {
    step,
    job: { id: job.id, title: job.title, description: job.description, jobFamily, status: job.status },
    intake: parseIntake(job.intake),
    jobSpecId: latest?.id ?? null,
    spec: latest ? parseStoredSpec(latest.spec) : null,
    specStatus: latest?.status ?? null,
    proposal: step === "proposal" && latest ? parseProposal(job.pendingProposal, latest.id) : null,
  };
}
