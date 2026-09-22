"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";
import { CadenceSchema, describeCadence, type Cadence } from "@/server/domain";
import { getChatExchange, replaceHref, type ChatMessageView } from "@/server/queries/worker-manage";
import {
  hireReplacement,
  proposeReplacement,
  rejectProposedVersion,
  sendMessageToWorker,
  updateSchedule,
  updateToolGrant,
} from "@/server/workers";

/**
 * Server actions for the "manage" side of a worker profile — permissions, schedule, talk-to-worker, proposals and
 * the replace page. Every action: requireSession → validate → workers call → revalidate. Results are plain JSON;
 * the client toasts errors and navigates on `redirectTo`.
 */

const WORKER_NAME_MAX_CHARS = 40;
const MESSAGE_MAX_CHARS = 4_000;

const GrantPatchSchema = z
  .object({ requiresApproval: z.boolean().optional(), revoked: z.boolean().optional() })
  .refine((p) => p.requiresApproval !== undefined || p.revoked !== undefined, "Nothing to change");

const MessageSchema = z
  .string()
  .transform((v) => v.replace(/\r\n/g, "\n").trim())
  .pipe(z.string().min(1, "Write a message first").max(MESSAGE_MAX_CHARS, `Messages are at most ${MESSAGE_MAX_CHARS.toLocaleString("en-US")} characters`));

const HireOptionsSchema = z.object({
  newName: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(WORKER_NAME_MAX_CHARS, `Worker names are at most ${WORKER_NAME_MAX_CHARS} characters`))
    .optional(),
  startFirstRun: z.boolean().optional(),
});

/** The profile (all tabs), the workforce list and the activity feed all reflect these changes. */
function revalidateWorker(workerId: string) {
  revalidatePath(`/workers/${workerId}`);
  revalidatePath(`/workers/${workerId}`, "layout");
  revalidatePath("/workforce");
  revalidatePath("/activity");
}

export async function updateToolGrantAction(
  workerId: string,
  toolName: string,
  patch: { requiresApproval?: boolean; revoked?: boolean },
): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    const clean = GrantPatchSchema.parse(patch);
    await updateToolGrant(s, workerId, toolName, clean);
    revalidateWorker(workerId);
  });
}

export async function updateScheduleAction(workerId: string, schedule: Cadence): Promise<ActionResult<{ label: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const cadence = CadenceSchema.parse(schedule);
    await updateSchedule(s, workerId, cadence);
    revalidateWorker(workerId);
    return { label: describeCadence(cadence) };
  });
}

export async function sendMessageAction(
  workerId: string,
  content: string,
): Promise<ActionResult<{ classification: "QUESTION" | "TEMPORARY_INSTRUCTION" | "SPEC_CHANGE"; proposedVersionId: string | null; href: string | null; messages: ChatMessageView[] }>> {
  return runAction(async () => {
    const s = await requireSession();
    const text = MessageSchema.parse(content);
    const result = await sendMessageToWorker(s, workerId, text);
    const messages = await getChatExchange(s.organizationId, workerId, [result.userMessageId, result.replyMessageId]);
    revalidateWorker(workerId);
    return {
      classification: result.classification,
      proposedVersionId: result.proposedVersionId ?? null,
      href: result.proposedVersionId ? replaceHref(workerId, result.proposedVersionId) : null,
      messages,
    };
  });
}

export async function proposeReplacementAction(workerId: string): Promise<ActionResult<{ redirectTo: string; versionId: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const { versionId } = await proposeReplacement(s, workerId);
    revalidateWorker(workerId);
    return { redirectTo: replaceHref(workerId, versionId), versionId };
  });
}

export async function rejectProposedVersionAction(workerId: string, versionId: string): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await rejectProposedVersion(s, versionId);
    revalidateWorker(workerId);
    revalidatePath(replaceHref(workerId, versionId));
    return { redirectTo: `/workers/${workerId}?tab=versions` };
  });
}

export async function hireReplacementAction(
  workerId: string,
  versionId: string,
  opts: { newName?: string; startFirstRun?: boolean } = {},
): Promise<ActionResult<{ redirectTo: string; firstRunQueued: boolean }>> {
  return runAction(async () => {
    const s = await requireSession();
    const clean = HireOptionsSchema.parse(opts);
    const result = await hireReplacement(s, versionId, {
      ...(clean.newName ? { newName: clean.newName } : {}),
      startFirstRun: clean.startFirstRun !== false,
    });
    revalidateWorker(workerId);
    revalidatePath(replaceHref(workerId, versionId));
    return { redirectTo: `/workers/${workerId}`, firstRunQueued: result.runId !== undefined };
  });
}
