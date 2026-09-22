"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { startRun } from "@/server/workers";
import { limitRunAction, parseId } from "../_lib/action-guards";

/** "Run now" on a roster card: queues a manual run; the executor picks it up within a poll interval. */
export async function startRunAction(workerId: string): Promise<ActionResult<{ runId: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await limitRunAction(s);
    const id = parseId(workerId, "Worker");
    const { runId } = await startRun(s, id);
    revalidatePath("/workforce");
    revalidatePath("/activity");
    revalidatePath(`/workers/${id}`);
    return { runId };
  });
}
