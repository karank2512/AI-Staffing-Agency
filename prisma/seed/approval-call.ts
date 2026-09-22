import { toJson } from "@/server/db";
import type { ToolCallRequest } from "@/server/models/types";
import { DECLINED_MESSAGE } from "@/server/runtime";
import { tools } from "@/server/tools";
import { seededBetween } from "./clock";
import type { RunWriter, StepHandle } from "./trace";

/** How a human answered an approval-gated call in history. */
export interface ApprovalDecision {
  decision: "approve" | "reject";
  note?: string;
  /** Wall-clock time between the request and the decision (not active time). */
  waitMs: number;
}

export function declinedMessage(note: string | undefined): string {
  return note ? `${DECLINED_MESSAGE}: ${note}` : DECLINED_MESSAGE;
}

/**
 * An approval-gated call, as the executor writes it across the pause: TOOL_CALL step + ToolCall row first, then
 * (in the pause transaction) the Approval + WAITING APPROVAL step + APPROVAL_REQUESTED. With a `decision` the
 * human's answer, the re-queue and the resumed execution follow; without one the call is left pending.
 */
export async function writeGatedToolCall(
  writer: RunWriter,
  args: {
    componentId: string;
    call: ToolCallRequest;
    /** Output of the executed call (approve only). */
    output?: unknown;
    decision?: ApprovalDecision;
  },
): Promise<{ toolCallId: string; approvalId: string; toolStep: StepHandle; approvalStep: StepHandle }> {
  const { call, decision } = args;
  const described = tools.describe(call.name, call.input);
  const approval = described.approval;
  const { organizationId, workerId, workerName, userName, userId } = writer.seat;

  const toolStart = writer.timeline.now;
  writer.timeline.next(seededBetween(`${writer.runId}:gate`, 25, 70)); // invoke → approval_required
  const approvalAt = writer.timeline.now;
  let decidedAt: Date | null = null;
  let executedAt: Date | null = null;
  const latencyMs = writer.latency(call.name, `tool:${call.id}`);
  if (decision) {
    writer.timeline.wait(decision.waitMs);
    decidedAt = writer.timeline.now;
    writer.timeline.wait(seededBetween(`${writer.runId}:claim`, 700, 2_400)); // executor claim after re-queue
    if (decision.decision === "approve") writer.timeline.next(latencyMs);
    else writer.timeline.next(seededBetween(`${writer.runId}:replay`, 4, 15));
    executedAt = writer.timeline.now;
  }
  const approved = decision?.decision === "approve";
  const declined = decision ? declinedMessage(decision.note) : undefined;

  const toolStep = await writer.writeStep({
    kind: "TOOL_CALL",
    componentId: args.componentId,
    title: described.title,
    status: !decision ? "PENDING" : approved ? "SUCCEEDED" : "FAILED",
    input: call.input,
    output: approved ? args.output : undefined,
    detail: !decision ? "Waiting for approval" : approved ? "Simulated" : undefined,
    error: decision && !approved ? declined : undefined,
    startedAt: toolStart,
    finishedAt: executedAt,
    // The executor times the call itself, not the human wait before it; a declined call never ran at all.
    durationMs: !decision ? undefined : approved ? latencyMs : null,
  });
  const toolRow = await writer.db.toolCall.create({
    data: {
      runId: writer.runId,
      runStepId: toolStep.id,
      workerId,
      toolName: call.name,
      attempt: writer.attempt,
      callId: call.id,
      input: toJson(call.input),
      output: approved ? toJson(args.output) : undefined,
      status: !decision ? "PENDING_APPROVAL" : approved ? "SUCCEEDED" : "DENIED",
      error: declined ?? null,
      latencyMs: approved ? latencyMs : null,
      costUsd: approved ? (tools.get(call.name)?.costPerCallUsd ?? 0) : 0,
      simulated: true,
      createdAt: toolStart,
      finishedAt: decision ? (approved ? executedAt : decidedAt) : null,
    },
    select: { id: true },
  });
  const approvalRow = await writer.db.approval.create({
    data: {
      organizationId,
      runId: writer.runId,
      workerId,
      toolCallId: toolRow.id,
      toolName: call.name,
      title: approval.title,
      description: approval.description ?? null,
      payload: toJson(call.input),
      status: !decision ? "PENDING" : approved ? "APPROVED" : "REJECTED",
      decidedById: decision ? userId : null,
      decidedAt,
      decisionNote: decision?.note ?? null,
      createdAt: approvalAt,
    },
    select: { id: true },
  });
  const approvalStep = await writer.writeStep({
    kind: "APPROVAL",
    componentId: args.componentId,
    title: approval.title,
    status: !decision ? "WAITING" : approved ? "SUCCEEDED" : "FAILED",
    input: { approvalId: approvalRow.id, toolCallId: toolRow.id },
    output: decision ? { decision: decision.decision, decidedBy: userName, note: decision.note } : undefined,
    detail: decision ? `${approved ? "Approved" : "Rejected"} by ${userName}` : undefined,
    error: decision && !approved ? DECLINED_MESSAGE : undefined,
    startedAt: approvalAt,
    finishedAt: decidedAt,
  });
  const meta = { approvalId: approvalRow.id, toolName: call.name };
  await writer.activity({ type: "APPROVAL_REQUESTED", title: `${workerName} is asking for approval`, detail: approval.title, actorType: "WORKER", actorName: workerName, metadata: meta, at: approvalAt });
  if (decision && decidedAt) {
    const note = decision.note?.trim();
    await writer.activity({
      type: approved ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
      title: `${userName} ${approved ? "approved" : "declined"} ${workerName}’s request`,
      detail: note ? `${approval.title} · “${note}”` : approval.title,
      actorType: "USER",
      actorName: userName,
      metadata: meta,
      at: decidedAt,
    });
  }
  if (approved && executedAt) {
    const costUsd = tools.get(call.name)?.costPerCallUsd ?? 0;
    await writer.usage({ kind: "TOOL", provider: "tool", resource: call.name, costUsd, at: executedAt });
    writer.counters.toolCalls += 1;
    writer.counters.costUsd += costUsd;
    if (tools.get(call.name)?.sideEffect === "external_write") {
      await writer.activity({ type: "TOOL_USED", title: `${workerName}: ${described.title}`, actorType: "WORKER", actorName: workerName, metadata: { toolName: call.name }, at: executedAt });
    }
  }
  return { toolCallId: toolRow.id, approvalId: approvalRow.id, toolStep, approvalStep };
}
