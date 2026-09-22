import type { PrismaClient, RunStatus, RunTrigger } from "@prisma/client";
import type { SessionContext } from "@/server/auth/types";
import { toJson } from "@/server/db";
import { renderJobBrief } from "@/server/domain";
import { evaluateRun } from "@/server/evaluation";
import { oneLine } from "@/server/runtime/compact";
import type { AgentCheckpoint, RunCheckpoint, RunOutput } from "@/server/runtime/types";
import { backdate } from "./backdate";
import { addMs, seededBetween } from "./clock";
import { emulateRun, recordsOf, type ApprovalMode, type EmulatedPart, type EmulatedRun } from "./emulate";
import { declinedMessage, writeGatedToolCall, type ApprovalDecision } from "./approval-call";
import { RunWriter, type Seat } from "./trace";

/**
 * One seeded run end to end: the Run row, the queue/start activity, every step the executor would have written,
 * and the terminal bookkeeping (output, checkpoint, duration, evaluation, feed). Three shapes: a finished run, the
 * run paused on an approval (resumable for real), and a failed run built from a caller-supplied failure trace.
 */

export interface SeedEnv {
  db: PrismaClient;
  session: SessionContext;
}

export interface RunPlan {
  trigger: RunTrigger;
  queuedAt: Date;
  /** Varies the simulated web / dataset order so consecutive runs differ. */
  seed: number;
  /** For approval-gated calls in finished runs. */
  approval?: ApprovalDecision;
}

export interface SeededRun {
  runId: string;
  status: RunStatus;
  deliverableId?: string;
  deliverableTitle?: string;
  records?: Array<Record<string, unknown>>;
  finishedAt?: Date;
  approvalId?: string;
  toolCallId?: string;
}

const QUEUED_TITLE: Record<RunTrigger, (name: string) => string> = {
  MANUAL: (name) => `${name} was asked to run now`,
  SCHEDULED: (name) => `${name}’s scheduled run was queued`,
  RETRY: (name) => `${name} was asked to try again`,
  CHAT: (name) => `${name} was asked to run from a chat message`,
  HIRE: (name) => `${name}’s first run was queued`,
};

const usd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The Run row (created directly in its final status so a live executor never claims or "recovers" it mid-seed)
 * plus RUN_QUEUED / RUN_STARTED. Active TEMPORARY_INSTRUCTION messages are consumed like enqueueRun does.
 */
async function openRun(env: SeedEnv, seat: Seat, plan: RunPlan, status: RunStatus): Promise<{ writer: RunWriter; instructions: string[] }> {
  const { db } = env;
  const userRequested = plan.trigger === "MANUAL" || plan.trigger === "HIRE" || plan.trigger === "RETRY" || plan.trigger === "CHAT";
  const pending = await db.workerMessage.findMany({
    where: { organizationId: seat.organizationId, workerId: seat.workerId, classification: "TEMPORARY_INSTRUCTION", instructionActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, content: true },
  });
  const instructions = pending.map((m) => m.content.trim()).filter((s) => s.length > 0);
  const startedAt = addMs(plan.queuedAt, seededBetween(`${seat.workerId}:${plan.seed}:claim`, 600, 2_400));
  const run = await db.run.create({
    data: {
      organizationId: seat.organizationId,
      jobId: seat.jobId,
      workerId: seat.workerId,
      workerVersionId: seat.versionId,
      status,
      trigger: plan.trigger,
      input: toJson({ instructions, params: {} }),
      simulated: true,
      attempt: 1,
      maxAttempts: 2,
      availableAt: plan.queuedAt,
      requestedById: userRequested ? seat.userId : null,
      startedAt,
      createdAt: plan.queuedAt,
      updatedAt: plan.queuedAt,
    },
    select: { id: true },
  });
  if (pending.length > 0) {
    await db.workerMessage.updateMany({ where: { id: { in: pending.map((m) => m.id) } }, data: { instructionActive: false, appliedToRunId: run.id } });
  }
  const writer = new RunWriter(db, seat, run.id, 1, startedAt);
  const details = [seat.jobTitle, ...(instructions.length > 0 ? [plural(instructions.length, "one-off instruction")] : [])];
  await writer.activity({
    type: "RUN_QUEUED",
    title: QUEUED_TITLE[plan.trigger](seat.workerName),
    detail: details.join(" · "),
    actorType: userRequested ? "USER" : "SYSTEM",
    actorName: userRequested ? seat.userName : undefined,
    at: plan.queuedAt,
  });
  await writer.activity({ type: "RUN_STARTED", title: `${seat.workerName} started working`, actorType: "WORKER", actorName: seat.workerName, at: startedAt });
  return { writer, instructions };
}

function emulate(seat: Seat, plan: RunPlan, instructions: string[], approvals: ApprovalMode, startedAt: Date): EmulatedRun {
  return emulateRun({ blueprint: seat.blueprint, spec: seat.spec, workerName: seat.workerName, instructions, now: startedAt, seed: plan.seed, approvals });
}

/** Writes every part in order; creates the deliverable at the first boundary where its keys exist (runtime rule). */
async function writeParts(writer: RunWriter, emulated: EmulatedRun, decision: ApprovalDecision | undefined): Promise<{ deliverableId?: string; deliverableTitle?: string; pending?: { toolCallId: string; approvalId: string } }> {
  const { blueprint } = writer.seat;
  const { contentKey, dataKey } = blueprint.deliverable;
  const produced = new Set<string>(["job_brief", "instructions"]);
  let deliverable: { id: string; title: string } | undefined;
  let pending: { toolCallId: string; approvalId: string } | undefined;

  for (const part of emulated.parts) {
    if (part.kind === "agent") {
      pending = await writeAgentPart(writer, part, decision);
      if (pending) break;
    } else {
      await writer.deterministic({
        componentId: part.component.id,
        name: part.component.name,
        operation: part.component.operation,
        config: part.component.config,
        inputKeys: part.component.inputKeys,
        summary: part.summary,
        detail: part.detail,
      });
    }
    produced.add(part.component.outputKey);
    if (!deliverable && produced.has(contentKey) && (!dataKey || produced.has(dataKey))) {
      const value = emulated.context[contentKey];
      deliverable = await writer.deliverable({
        content: typeof value === "string" ? value : JSON.stringify(value, null, 2),
        records: recordsOf(emulated.context, dataKey),
      });
    }
  }
  return { deliverableId: deliverable?.id, deliverableTitle: deliverable?.title, pending };
}

async function writeAgentPart(writer: RunWriter, part: Extract<EmulatedPart, { kind: "agent" }>, decision: ApprovalDecision | undefined): Promise<{ toolCallId: string; approvalId: string } | undefined> {
  const { component, agent } = part;
  for (let i = 0; i < agent.turns.length; i++) {
    const turn = agent.turns[i];
    await writer.modelTurn({ componentId: component.id, componentName: component.name, tier: component.modelTier, system: agent.system, toolNames: component.tools, turn: i + 1, result: turn });
    for (const ex of turn.executions) {
      if (ex.gated) {
        await writeGatedToolCall(writer, { componentId: component.id, call: ex.call, output: ex.output, decision: decision ?? { decision: "approve", waitMs: 5 * 60_000 } });
      } else {
        await writer.toolCall({ componentId: component.id, call: ex.call, output: ex.output, error: ex.error });
      }
    }
  }
  if (!agent.pending) return undefined;
  const gated = await writeGatedToolCall(writer, { componentId: component.id, call: agent.pending });
  return { toolCallId: gated.toolCallId, approvalId: gated.approvalId };
}

function counters(writer: RunWriter) {
  return { ...writer.counters, activeMs: writer.timeline.activeMs };
}

/** A run that finished: SUCCEEDED + output + checkpoint, then the EVALUATION step around the real evaluateRun. */
export async function seedSucceededRun(env: SeedEnv, seat: Seat, plan: RunPlan): Promise<SeededRun> {
  const { db } = env;
  const { writer, instructions } = await openRun(env, seat, plan, "SUCCEEDED");
  const emulated = emulate(seat, plan, instructions, plan.approval?.decision === "reject" ? { reject: declinedMessage(plan.approval.note) } : "approve", writer.timeline.now);
  const written = await writeParts(writer, emulated, plan.approval);
  if (!written.deliverableId || !written.deliverableTitle) throw new Error(`${seat.workerName}'s seeded run produced no deliverable`);

  const finishedAt = writer.timeline.now;
  const records = recordsOf(emulated.context, seat.blueprint.deliverable.dataKey);
  const [modelCalls, toolCalls, costRow] = await Promise.all([
    db.modelCall.count({ where: { runId: writer.runId } }),
    db.toolCall.count({ where: { runId: writer.runId } }),
    db.run.findUniqueOrThrow({ where: { id: writer.runId }, select: { costUsd: true } }),
  ]);
  const steps = writer.nextStepIndex;
  const output: RunOutput = {
    summary: `Produced “${written.deliverableTitle}”${records ? ` (${plural(records.length, "record")})` : ""} in ${plural(steps, "step")}`,
    deliverableIds: [written.deliverableId],
    stats: { steps, modelCalls, toolCalls },
  };
  const checkpoint: RunCheckpoint = {
    version: 1,
    componentIndex: seat.blueprint.components.length,
    context: emulated.context,
    nextStepIndex: steps,
    counters: counters(writer),
    deliverableId: written.deliverableId,
  };
  await db.run.update({
    where: { id: writer.runId },
    data: { output: toJson(output), checkpoint: toJson(checkpoint), durationMs: writer.timeline.activeMs, finishedAt, error: null, updatedAt: finishedAt },
  });

  // The EVALUATION step runs after the terminal transition (outside active time), around the real evaluator.
  const evalStart = addMs(finishedAt, seededBetween(`${writer.runId}:eval`, 20, 90));
  const judgeAt = addMs(evalStart, seededBetween(`${writer.runId}:judge`, 150, 600));
  const t0 = Date.now();
  const evaluated = await backdate(db, seat.organizationId, judgeAt, () => evaluateRun(writer.runId));
  const evalEnd = addMs(judgeAt, Date.now() - t0 + seededBetween(`${writer.runId}:evalend`, 1_200, 3_600));
  const parts: string[] = [];
  if (evaluated.deterministic) parts.push(`Checks ${Math.round(evaluated.deterministic.score * 100)}/100`);
  if (evaluated.judge) parts.push(`Reviewer ${Math.round(evaluated.judge.score * 100)}/100`);
  await writer.writeStep({
    kind: "EVALUATION",
    title: "Evaluating the deliverable",
    status: "SUCCEEDED",
    input: { deliverableId: written.deliverableId },
    output: { deterministic: evaluated.deterministic?.score ?? null, judge: evaluated.judge?.score ?? null },
    detail: parts.join(" · ") || "Nothing to evaluate",
    startedAt: evalStart,
    finishedAt: evalEnd,
  });

  const lastRunAt = addMs(evalEnd, 25);
  const detail = [`Delivered “${written.deliverableTitle}”`, ...(records ? [plural(records.length, "record")] : []), plural(steps, "step"), usd(Number(costRow.costUsd))];
  await writer.activity({
    type: "RUN_SUCCEEDED",
    title: `${seat.workerName} finished a run`,
    detail: detail.join(" · "),
    actorType: "WORKER",
    actorName: seat.workerName,
    metadata: { deliverableId: written.deliverableId },
    at: lastRunAt,
  });
  // The runtime stamps Worker.lastRunAt after the evaluation, just before RUN_SUCCEEDED.
  await db.run.update({ where: { id: writer.runId }, data: { updatedAt: lastRunAt } });
  await db.worker.update({ where: { id: seat.workerId }, data: { lastRunAt } });
  return {
    runId: writer.runId,
    status: "SUCCEEDED",
    deliverableId: written.deliverableId,
    deliverableTitle: written.deliverableTitle,
    records: records ?? undefined,
    finishedAt,
  };
}

/**
 * The run paused on its approval-gated notifier call, exactly as pauseForApproval leaves it: deliverable made,
 * ToolCall PENDING_APPROVAL, Approval PENDING, WAITING APPROVAL step, and a checkpoint whose `agent` holds the
 * conversation + the pending call — so approving it resumes the real executor from here.
 */
export async function seedWaitingRun(env: SeedEnv, seat: Seat, plan: RunPlan): Promise<SeededRun> {
  const { db } = env;
  const { writer, instructions } = await openRun(env, seat, plan, "WAITING_FOR_APPROVAL");
  const emulated = emulate(seat, plan, instructions, "pause", writer.timeline.now);
  const written = await writeParts(writer, emulated, undefined);
  const pausedPart = emulated.parts.at(-1);
  if (!written.pending || !written.deliverableId || pausedPart?.kind !== "agent" || !pausedPart.agent.pending) {
    throw new Error(`${seat.workerName}'s seeded run did not pause on an approval`);
  }
  const call = pausedPart.agent.pending;
  const agent: AgentCheckpoint = {
    componentId: pausedPart.component.id,
    messages: pausedPart.agent.messages,
    turn: pausedPart.agent.turns.length,
    pendingToolCalls: [{ toolCallId: written.pending.toolCallId, callId: call.id, toolName: call.name, input: call.input }],
  };
  const checkpoint: RunCheckpoint = {
    version: 1,
    componentIndex: emulated.componentIndex,
    context: emulated.context,
    agent,
    nextStepIndex: writer.nextStepIndex,
    counters: counters(writer),
    deliverableId: written.deliverableId,
  };
  await db.run.update({ where: { id: writer.runId }, data: { checkpoint: toJson(checkpoint), updatedAt: writer.timeline.now, lockedBy: null, lockedAt: null, heartbeatAt: null } });
  return {
    runId: writer.runId,
    status: "WAITING_FOR_APPROVAL",
    deliverableId: written.deliverableId,
    deliverableTitle: written.deliverableTitle,
    records: recordsOf(emulated.context, seat.blueprint.deliverable.dataKey) ?? undefined,
    approvalId: written.pending.approvalId,
    toolCallId: written.pending.toolCallId,
  };
}

/** What one failed attempt looked like: the collector's turns up to the failure, and how the runtime classified it. */
export interface FailedAttempt {
  part: Extract<EmulatedPart, { kind: "agent" }>;
  code: "MODEL_ERROR" | "LIMIT_EXCEEDED";
  message: string;
  retryable: boolean;
}

/**
 * A run that failed inside its first component. Each attempt writes its turns and an ERROR step; a retryable
 * failure re-queues with the runtime's backoff (attempt + 1), a final one ends FAILED with RUN_FAILED.
 */
export async function seedFailedRun(env: SeedEnv, seat: Seat, plan: RunPlan, attemptsFor: (startedAt: Date) => FailedAttempt[]): Promise<SeededRun> {
  const { db } = env;
  const { writer, instructions } = await openRun(env, seat, plan, "FAILED");
  const attempts = attemptsFor(writer.timeline.now);
  let last: FailedAttempt | undefined;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    last = attempt;
    writer.attempt = i + 1;
    await writeAgentPart(writer, attempt.part, undefined);
    await writer.step({
      kind: "ERROR",
      title: oneLine(attempt.message, 1_000),
      status: "FAILED",
      error: attempt.message,
      componentId: attempt.part.component.id,
      output: { code: attempt.code, retryable: attempt.retryable, attempt: i + 1, maxAttempts: 2 },
      durationMs: seededBetween(`${writer.runId}:error:${i}`, 3, 12),
    });
    const willRetry = attempt.retryable && i + 1 < 2 && i + 1 < attempts.length;
    if (!willRetry) break;
    // Backoff (15 s × attempt) + the executor picking it up again; none of it is active time.
    writer.timeline.wait(15_000 * (i + 1) + seededBetween(`${writer.runId}:reclaim:${i}`, 400, 1_800));
  }
  if (!last) throw new Error("A failed run needs at least one attempt");

  const finishedAt = writer.timeline.now;
  // What finishFailure persists: the failed component's restore point (the seeded context), no agent in flight.
  const checkpoint: RunCheckpoint = {
    version: 1,
    componentIndex: 0,
    context: { job_brief: renderJobBrief(seat.spec), instructions },
    nextStepIndex: writer.nextStepIndex,
    counters: counters(writer),
  };
  const message = oneLine(last.message, 1_000);
  await db.run.update({
    where: { id: writer.runId },
    data: { attempt: writer.attempt, error: message, checkpoint: toJson(checkpoint), durationMs: writer.timeline.activeMs, finishedAt, updatedAt: finishedAt },
  });
  await writer.activity({ type: "RUN_FAILED", title: `${seat.workerName} could not finish a run`, detail: message, actorType: "WORKER", actorName: seat.workerName, at: addMs(finishedAt, 40) });
  return { runId: writer.runId, status: "FAILED", finishedAt };
}
