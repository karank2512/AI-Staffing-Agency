import type { JobStatus } from "@prisma/client";
import { db } from "@/server/db";
import { JOB_FAMILY_INFO, type JobFamily } from "@/server/domain";
import { isAppError, notFound } from "@/server/errors";
import { getHireFlowState, type HireFlowState } from "@/server/staffing";
import { tools } from "@/server/tools";
import type { ToolCategory, ToolSideEffect } from "@/server/tools/types";

/**
 * Read side of /hire. Thin on purpose: the step, spec and proposal come straight from
 * `staffing.getHireFlowState` (already plain JSON), and this file only decorates them with what the page
 * needs to render tools by their human names and to send a staffed job to its worker.
 */

export interface ToolMeta {
  name: string;
  displayName: string;
  humanDescription: string;
  category: ToolCategory;
  sideEffect: ToolSideEffect;
  defaultRequiresApproval: boolean;
}

export type HireView =
  | {
      kind: "flow";
      state: HireFlowState;
      /** Every registry tool keyed by name — small enough to ship whole, so unknown names never blank a row. */
      toolMeta: Record<string, ToolMeta>;
      familyLabel: string;
      familyDescription: string;
    }
  | {
      /** The job is no longer hireable (STAFFED / PAUSED / CLOSED). `workerId` is its current non-retired worker, if any. */
      kind: "staffed";
      jobId: string;
      status: JobStatus;
      workerId: string | null;
    };

export interface OpenHireJob {
  id: string;
  title: string;
  status: JobStatus;
  familyLabel: string;
  updatedAt: string;
}

/** The whole registry as display metadata. Pure over the in-memory registry. */
export function toolMetaMap(): Record<string, ToolMeta> {
  const out: Record<string, ToolMeta> = {};
  for (const t of tools.list()) {
    out[t.name] = {
      name: t.name,
      displayName: t.displayName,
      humanDescription: t.humanDescription,
      category: t.category,
      sideEffect: t.sideEffect,
      defaultRequiresApproval: t.defaultRequiresApproval,
    };
  }
  return out;
}

function familyLabelOf(slug: string): string {
  return JOB_FAMILY_INFO[slug as JobFamily]?.label ?? JOB_FAMILY_INFO.general.label;
}

/**
 * Flow state for the page, or a pointer to the worker when the job has already been staffed. Throws NOT_FOUND
 * for jobs outside the caller's organization (the page maps that to `notFound()`).
 */
export async function getHireView(organizationId: string, jobId: string): Promise<HireView> {
  try {
    const state = await getHireFlowState(organizationId, jobId);
    const info = JOB_FAMILY_INFO[state.job.jobFamily];
    return { kind: "flow", state, toolMeta: toolMetaMap(), familyLabel: info.label, familyDescription: info.description };
  } catch (e) {
    if (!isAppError(e) || e.code !== "NOT_FOUND") throw e;
  }

  // getHireFlowState refuses non-open jobs with the same NOT_FOUND it uses for missing ones; tell them apart here.
  const job = await db.job.findFirst({
    where: { id: jobId, organizationId },
    select: {
      id: true,
      status: true,
      workers: { where: { status: { not: "RETIRED" } }, orderBy: { hiredAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  if (!job) throw notFound("Job");
  return { kind: "staffed", jobId: job.id, status: job.status, workerId: job.workers[0]?.id ?? null };
}

/** Unfinished hires, newest first, for "pick up where you left off" on the Describe step. */
export async function listOpenHireJobs(organizationId: string, limit = 5): Promise<OpenHireJob[]> {
  const rows = await db.job.findMany({
    where: { organizationId, status: { in: ["DRAFT", "SPEC_APPROVED"] }, workers: { none: { status: { not: "RETIRED" } } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, title: true, status: true, jobFamily: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    familyLabel: familyLabelOf(r.jobFamily),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Name + title of a worker that was just hired, for the success toast. Org-scoped; null when not ours. */
export async function getHiredWorkerSummary(organizationId: string, workerId: string): Promise<{ name: string; title: string } | null> {
  const worker = await db.worker.findFirst({ where: { id: workerId, organizationId }, select: { name: true, title: true } });
  return worker ? { name: worker.name, title: worker.title } : null;
}
