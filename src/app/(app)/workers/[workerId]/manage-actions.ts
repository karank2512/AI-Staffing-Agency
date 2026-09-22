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
import { limitLlmAction, limitRunAction, parseId, ToolNameSchema } from "../../_lib/action-guards";

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
    const id = parseId(workerId, "Worker");
    const tool = ToolNameSchema.parse(toolName);
    const clean = GrantPatchSchema.parse(patch);
    await updateToolGrant(s, id, tool, clean);
    revalidateWorker(id);
  });
}

export async function updateScheduleAction(workerId: string, schedule: Cadence): Promise<ActionResult<{ label: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(workerId, "Worker");
    const cadence = CadenceSchema.parse(schedule);
    await updateSchedule(s, id, cadence);
    revalidateWorker(id);
    return { label: describeCadence(cadence) };
  });
}

export async function sendMessageAction(
  workerId: string,
  content: string,
): Promise<ActionResult<{ classification: "QUESTION" | "TEMPORARY_INSTRUCTION" | "SPEC_CHANGE"; proposedVersionId: string | null; href: string | null; messages: ChatMessageView[] }>> {
  return runAction(async () => {
    const s = await requireSession();
    await limitLlmAction(s);
    const id = parseId(workerId, "Worker");
    const text = MessageSchema.parse(content);
    const result = await sendMessageToWorker(s, id, text);
    const messages = await getChatExchange(s.organizationId, id, [result.userMessageId, result.replyMessageId]);
    revalidateWorker(id);
    return {
      classification: result.classification,
      proposedVersionId: result.proposedVersionId ?? null,
      href: result.proposedVersionId ? replaceHref(id, result.proposedVersionId) : null,
      messages,
    };
  });
}

export async function proposeReplacementAction(workerId: string): Promise<ActionResult<{ redirectTo: string; versionId: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    await limitLlmAction(s);
    const id = parseId(workerId, "Worker");
    const { versionId } = await proposeReplacement(s, id);
    revalidateWorker(id);
    return { redirectTo: replaceHref(id, versionId), versionId };
  });
}

export async function rejectProposedVersionAction(workerId: string, versionId: string): Promise<ActionResult<{ redirectTo: string }>> {
  return runAction(async () => {
    const s = await requireSession();
    const id = parseId(workerId, "Worker");
    const version = parseId(versionId, "Version");
    await rejectProposedVersion(s, version);
    revalidateWorker(id);
    revalidatePath(replaceHref(id, version));
    return { redirectTo: `/workers/${id}?tab=versions` };
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
    // Hiring a replacement queues its first run unless explicitly told not to.
    if (clean.startFirstRun !== false) await limitRunAction(s);
    const id = parseId(workerId, "Worker");
    const version = parseId(versionId, "Version");
    const result = await hireReplacement(s, version, {
      ...(clean.newName ? { newName: clean.newName } : {}),
      startFirstRun: clean.startFirstRun !== false,
    });
    revalidateWorker(id);
    revalidatePath(replaceHref(id, version));
    return { redirectTo: `/workers/${id}`, firstRunQueued: result.runId !== undefined };
  });
}
