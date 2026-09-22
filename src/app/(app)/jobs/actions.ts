"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { runAction, type ActionResult } from "@/lib/action-result";
import { recordActivity } from "@/server/activity";
import { requireSession } from "@/server/auth";
import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { db } from "@/server/db";
import { conflict, notFound } from "@/server/errors";
import { discardJob } from "@/server/staffing";
import { parseId } from "../_lib/action-guards";

/**
 * Server actions for /jobs and /jobs/[jobId]. Every action: requireSession → mutation → revalidate. Results are
 * plain JSON; the client toasts errors and navigates on `redirectTo`.
 */

function revalidateJob(jobId: string) {
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/hire");
  revalidatePath("/workforce");
}

/**
 * CONTRACT GAP: no module owns the Job → CLOSED transition (`closeJob` does not exist in staffing or workers), so
 * the page performs it here with `db` directly. Guarded so a job can only close once nobody holds the seat:
 * ACTIVE/PAUSED workers must be retired first (retireWorker re-opens the job as SPEC_APPROVED, which closes fine).
 */
async function closeJob(s: SessionContext, jobId: string): Promise<{ title: string }> {
  // Closing a job is workforce planning, not day-to-day work (role matrix: jobs.manage).
  assertCan(s, "jobs.manage");
  const job = await db.job.findFirst({
    where: { id: jobId, organizationId: s.organizationId },
    select: { id: true, title: true, status: true, _count: { select: { workers: { where: { status: { in: ["ACTIVE", "PAUSED"] } } } } } },
  });
  if (!job) throw notFound("Job");
  if (job.status === "CLOSED") throw conflict("This job is already closed.");
  if (job.status === "DRAFT") throw conflict("This job is still a draft — discard it instead of closing it.");
  if (job._count.workers > 0) throw conflict("Retire the worker on this job before closing it.");

  // Guarded on the status we just read so a concurrent hire cannot be closed underneath.
  const result = await db.job.updateMany({
    where: { id: job.id, organizationId: s.organizationId, status: job.status },
    data: { status: "CLOSED", pendingProposal: Prisma.DbNull },
  });
  if (result.count === 0) throw conflict("This job changed just now. Refresh and try again.");

  await recordActivity({
    organizationId: s.organizationId,
    type: "NOTE",
    title: `${s.name} closed “${job.title}”`,
    detail: "No worker is assigned any more. History and deliverables are kept.",
    jobId: job.id,
    actorType: "USER",
    actorName: s.name,
  });
  return { title: job.title };
}

export async function closeJobAction(jobId: string): Promise<ActionResult<{ title: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(jobId, "Job");
    const closed = await closeJob(s, id);
    revalidateJob(id);
    return closed;
  });
}

/** Only DRAFT / SPEC_APPROVED jobs that never had a worker (staffing.discardJob enforces it). */
export async function discardJobAction(jobId: string): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(jobId, "Job");
    await discardJob(s, id);
    revalidateJob(id);
    return { redirectTo: "/jobs" };
  });
}
