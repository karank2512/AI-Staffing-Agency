"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { generatePerformanceReview } from "@/server/evaluation";
import { getWorkerReview } from "@/server/queries/worker-profile";
import { pauseWorker, resumeWorker, retireWorker, startRun } from "@/server/workers";

/**
 * Server actions for the worker profile header: run now (with optional one-off instructions), pause / resume /
 * retire and "Performance review". Every action: requireSession → validate → workers/evaluation call →
 * revalidate. Results are plain JSON; the client toasts.
 */

const WorkerIdSchema = z.string().min(1, "Missing worker");

/** The textarea's free text: one instruction per non-empty line, capped so the runtime's own limits never trip. */
const InstructionsSchema = z
  .string()
  .max(4_000, "Keep one-off instructions under 4,000 characters")
  .optional()
  .transform((text) =>
    (text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 10),
  );

/** The profile, the workforce list and the global feed all show a worker's lifecycle + latest run. */
function revalidateWorker(workerId: string) {
  revalidatePath(`/workers/${workerId}`);
  revalidatePath("/workforce");
  revalidatePath("/activity");
}

export async function runNowAction(workerId: string, input: { instructions?: string } = {}): Promise<ActionResult<{ runId: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = WorkerIdSchema.parse(workerId);
    const instructions = InstructionsSchema.parse(input.instructions);
    const { runId } = await startRun(s, id, instructions.length > 0 ? { instructions } : {});
    revalidateWorker(id);
    revalidatePath(`/runs/${runId}`);
    return { runId };
  });
}

export async function pauseWorkerAction(workerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    const id = WorkerIdSchema.parse(workerId);
    await pauseWorker(s, id);
    revalidateWorker(id);
    revalidatePath("/approvals");
  });
}

export async function resumeWorkerAction(workerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    const id = WorkerIdSchema.parse(workerId);
    await resumeWorker(s, id);
    revalidateWorker(id);
  });
}

export async function retireWorkerAction(workerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    const id = WorkerIdSchema.parse(workerId);
    await retireWorker(s, id);
    revalidateWorker(id);
    revalidatePath("/approvals");
    revalidatePath("/jobs");
  });
}

export async function generateReviewAction(
  workerId: string,
): Promise<ActionResult<{ reviewId: string; recommendation: "KEEP" | "IMPROVE" | "REPLACE"; overallScore: number }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = WorkerIdSchema.parse(workerId);
    const { reviewId } = await generatePerformanceReview(s, id);
    const review = await getWorkerReview(s.organizationId, reviewId);
    revalidateWorker(id);
    return { reviewId, recommendation: review.recommendation, overallScore: review.overallScore };
  });
}
