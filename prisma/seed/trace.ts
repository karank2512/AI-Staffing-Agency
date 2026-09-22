import type { ActivityType, ActorType, PrismaClient, RunStepKind, RunStepStatus, RunTrigger } from "@prisma/client";
import { toJson } from "@/server/db";
import { toDbDeliverableFormat, type JobSpec, type WorkerBlueprint } from "@/server/domain";
import { llm } from "@/server/models";
import type { ChatMessage, ToolCallRequest } from "@/server/models/types";
import { buildRequestTrace, buildResponseTrace } from "@/server/models/persist";
import { compact, oneLine } from "@/server/runtime/compact";
import { narrativeSummary, renderTitle } from "@/server/runtime/deliverable";
import type { RunCheckpoint } from "@/server/runtime/types";
import { tools } from "@/server/tools";
import { recordUsage } from "@/server/usage";
import { seededBetween, Timeline } from "./clock";
import type { EmulatedTurn } from "./emulate";

/**
 * Writes run history the way the executor would have: RunStep rows with monotonic indexes, ModelCall / ToolCall
 * rows pointing at their steps, usage through `recordUsage` (so Run.costUsd/tokens are true rollups), activity
 * with the runtime's own wording and metadata keys. Timestamps come from a Timeline so a run that "took" 90 s
 * of active work is spread over 90 s of steps.
 */

export interface Seat {
  organizationId: string;
  userId: string;
  userName: string;
  workerId: string;
  workerName: string;
  jobId: string;
  jobTitle: string;
  versionId: string;
  blueprint: WorkerBlueprint;
  spec: JobSpec;
}

export interface StepHandle {
  id: string;
  index: number;
  startedAt: Date;
}

const MODEL_LATENCY: Record<string, [number, number]> = { fast: [2_800, 7_500], standard: [6_000, 16_000], reasoning: [11_000, 24_000] };
const TOOL_LATENCY: Record<string, [number, number]> = {
  web_search: [900, 2_300],
  fetch_url: [600, 1_900],
  extract_data: [1_400, 3_600],
  read_dataset: [90, 260],
  send_notification: [180, 520],
  calculator: [5, 20],
};

export const QUEUE_TITLES: Record<RunTrigger, (name: string) => string> = {
  MANUAL: (name) => `${name} was asked to run now`,
  SCHEDULED: (name) => `${name}’s scheduled run was queued`,
  RETRY: (name) => `${name} was asked to try again`,
  CHAT: (name) => `${name} was asked to run from a chat message`,
  HIRE: (name) => `${name}’s first run was queued`,
};

export class RunWriter {
  private nextIndex = 0;
  readonly timeline: Timeline;
  counters = { modelCalls: 0, toolCalls: 0, costUsd: 0 };

  constructor(
    private readonly db: PrismaClient,
    readonly seat: Seat,
    readonly runId: string,
    readonly attempt: number,
    startedAt: Date,
    private readonly simulated = true,
  ) {
    this.timeline = new Timeline(startedAt);
  }

  get nextStepIndex(): number {
    return this.nextIndex;
  }

  private latency(kind: string, key: string): number {
    const range = MODEL_LATENCY[kind] ?? TOOL_LATENCY[kind] ?? [200, 800];
    return seededBetween(`${this.runId}:${key}:${this.nextIndex}`, range[0], range[1]);
  }

  /** One RunStep with explicit timing; `open` leaves it unfinished (WAITING / PENDING). */
  async step(args: {
    kind: RunStepKind;
    title: string;
    componentId?: string;
    status?: RunStepStatus;
    input?: unknown;
    output?: unknown;
    detail?: string;
    error?: string;
    durationMs: number;
    open?: boolean;
    startedAt?: Date;
  }): Promise<StepHandle> {
    const index = this.nextIndex++;
    const startedAt = args.startedAt ?? this.timeline.now;
    const interval = args.open ? null : this.timeline.next(args.durationMs);
    const finishedAt = interval ? interval.finishedAt : null;
    const row = await this.db.runStep.create({
      data: {
        runId: this.runId,
        index,
        attempt: this.attempt,
        componentId: args.componentId ?? null,
        kind: args.kind,
        status: args.status ?? "SUCCEEDED",
        title: oneLine(args.title),
        detail: args.detail ?? null,
        input: args.input === undefined ? undefined : toJson(compact(args.input)),
        output: args.output === undefined ? undefined : toJson(compact(args.output)),
        error: args.error ?? null,
        startedAt,
        finishedAt,
        durationMs: finishedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : null,
      },
      select: { id: true },
    });
    return { id: row.id, index, startedAt };
  }

  /** MODEL_CALL step + ModelCall row + MODEL usage, exactly as the agent loop records one turn. */
  async modelTurn(args: { componentId: string; componentName: string; tier: string; system: string; toolNames: string[]; turn: number; result: EmulatedTurn }): Promise<StepHandle> {
    const { result } = args;
    const tier = args.tier as "fast" | "standard" | "reasoning";
    const route = llm.route(tier);
    const costUsd = llm.estimateCostUsd(tier, result.usage.inputTokens, result.usage.outputTokens);
    const latencyMs = this.latency(tier, `model:${args.turn}`);
    const tokens = result.usage.inputTokens + result.usage.outputTokens;
    const step = await this.step({
      kind: "MODEL_CALL",
      componentId: args.componentId,
      title: `${this.seat.workerName} is thinking (${args.componentName}, turn ${args.turn})`,
      input: { turn: args.turn, tier, tools: args.toolNames, messages: result.request.length },
      detail: `${route.model} · ${tokens} tokens${this.simulated ? " · Simulated" : ""}`,
      output: { text: result.text, toolCalls: result.toolCalls, finishReason: result.finishReason, usage: result.usage, costUsd },
      durationMs: latencyMs + seededBetween(`${this.runId}:overhead:${args.turn}`, 40, 180),
    });
    const finishedAt = this.timeline.now;
    await this.db.modelCall.create({
      data: {
        organizationId: this.seat.organizationId,
        workerId: this.seat.workerId,
        jobId: this.seat.jobId,
        runId: this.runId,
        runStepId: step.id,
        purpose: "agent.turn",
        provider: route.provider,
        model: route.model,
        tier,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd,
        latencyMs,
        simulated: this.simulated,
        request: toJson(buildRequestTrace({ system: args.system, messages: result.request, tools: args.toolNames })),
        response: toJson(buildResponseTrace({ text: result.text, toolCalls: result.toolCalls, finishReason: result.finishReason })),
        createdAt: finishedAt,
      },
    });
    await this.usage({ kind: "MODEL", provider: route.provider, resource: route.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd, at: finishedAt });
    this.counters.modelCalls += 1;
    this.counters.costUsd += costUsd;
    return step;
  }

  /** TOOL_CALL step + ToolCall row for a call that ran to completion, plus its TOOL usage. */
  async toolCall(args: { componentId: string; call: ToolCallRequest; output: unknown; error?: string; callId?: string; startedAt?: Date; extraWaitMs?: number }): Promise<{ step: StepHandle; toolCallId: string }> {
    const { call } = args;
    const definition = tools.get(call.name);
    const costUsd = definition?.costPerCallUsd ?? 0;
    const latencyMs = this.latency(call.name, `tool:${call.id}`);
    const failed = args.error !== undefined;
    const step = await this.step({
      kind: "TOOL_CALL",
      componentId: args.componentId,
      title: tools.describe(call.name, call.input).title,
      status: failed ? "FAILED" : "SUCCEEDED",
      input: call.input,
      output: failed ? undefined : args.output,
      error: args.error,
      detail: failed ? undefined : this.simulated ? "Simulated" : undefined,
      durationMs: latencyMs + (args.extraWaitMs ?? 0),
      startedAt: args.startedAt,
    });
    const finishedAt = this.timeline.now;
    const row = await this.db.toolCall.create({
      data: {
        runId: this.runId,
        runStepId: step.id,
        workerId: this.seat.workerId,
        toolName: call.name,
        attempt: this.attempt,
        callId: args.callId ?? call.id,
        input: toJson(call.input),
        output: failed ? undefined : toJson(args.output),
        status: failed ? "FAILED" : "SUCCEEDED",
        error: args.error ?? null,
        latencyMs,
        costUsd: failed ? 0 : costUsd,
        simulated: this.simulated,
        createdAt: step.startedAt,
        finishedAt,
      },
      select: { id: true },
    });
    if (!failed) {
      await this.usage({ kind: "TOOL", provider: "tool", resource: call.name, costUsd, at: finishedAt });
      this.counters.toolCalls += 1;
      this.counters.costUsd += costUsd;
    }
    return { step, toolCallId: row.id };
  }

  /** Meter through the real ledger (atomic Run rollups), then move the row to the run's own timeline. */
  private async usage(args: { kind: "MODEL" | "TOOL"; provider: string; resource: string; inputTokens?: number; outputTokens?: number; costUsd: number; at: Date }): Promise<void> {
    await recordUsage({
      organizationId: this.seat.organizationId,
      kind: args.kind,
      provider: args.provider,
      resource: args.resource,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: args.costUsd,
      simulated: this.simulated,
      workerId: this.seat.workerId,
      jobId: this.seat.jobId,
      runId: this.runId,
    });
    const newest = await this.db.usageRecord.findFirst({ where: { runId: this.runId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { id: true } });
    if (newest) await this.db.usageRecord.update({ where: { id: newest.id }, data: { occurredAt: args.at } });
  }

  async deterministic(args: { componentId: string; name: string; operation: string; config: unknown; inputKeys: string[]; summary: unknown; detail: string }): Promise<StepHandle> {
    return this.step({
      kind: "DETERMINISTIC",
      componentId: args.componentId,
      title: args.name,
      input: { operation: args.operation, config: args.config, inputKeys: args.inputKeys },
      output: args.summary,
      detail: args.detail,
      durationMs: seededBetween(`${this.runId}:det:${args.componentId}`, 4, 38),
    });
  }

  /** Deliverable row + DELIVERABLE step + activity, mirroring runtime/deliverable.ts. */
  async deliverable(args: { content: string; records: Array<Record<string, unknown>> | null }): Promise<{ id: string; title: string; step: StepHandle }> {
    const { blueprint, spec } = this.seat;
    const { deliverable } = blueprint;
    const now = this.timeline.now;
    const title = renderTitle(deliverable.titleTemplate, { jobTitle: spec.title, now });
    const narrative = narrativeSummary(args.content);
    const count = args.records?.length ?? null;
    const summary = narrative || (count !== null ? `${count} record${count === 1 ? "" : "s"}` : oneLine(args.content, 280));
    const row = await this.db.deliverable.create({
      data: {
        organizationId: this.seat.organizationId,
        jobId: this.seat.jobId,
        workerId: this.seat.workerId,
        workerVersionId: this.seat.versionId,
        runId: this.runId,
        title,
        summary,
        format: toDbDeliverableFormat(deliverable.format),
        content: args.content,
        ...(args.records ? { data: toJson(args.records) } : {}),
        status: "PENDING_REVIEW",
        createdAt: now,
      },
      select: { id: true },
    });
    const step = await this.step({
      kind: "DELIVERABLE",
      title: `Delivered “${title}”`,
      detail: count !== null ? `${count} record${count === 1 ? "" : "s"} · ${deliverable.format}` : deliverable.format,
      output: { deliverableId: row.id, title, format: deliverable.format, records: count, chars: args.content.length },
      durationMs: seededBetween(`${this.runId}:deliverable`, 12, 45),
    });
    await this.activity({
      type: "DELIVERABLE_CREATED",
      title: `${this.seat.workerName} delivered “${title}”`,
      detail: count !== null ? `${count} record${count === 1 ? "" : "s"}` : summary,
      actorType: "WORKER",
      actorName: this.seat.workerName,
      metadata: { deliverableId: row.id },
      at: this.timeline.now,
    });
    return { id: row.id, title, step };
  }

  async activity(args: { type: ActivityType; title: string; detail?: string; actorType: ActorType; actorName?: string; metadata?: Record<string, unknown>; at: Date; withRun?: boolean }): Promise<void> {
    await this.db.activityEvent.create({
      data: {
        organizationId: this.seat.organizationId,
        workerId: this.seat.workerId,
        jobId: this.seat.jobId,
        runId: args.withRun === false ? null : this.runId,
        type: args.type,
        actorType: args.actorType,
        actorName: args.actorName ?? null,
        title: oneLine(args.title),
        detail: args.detail ?? null,
        metadata: args.metadata === undefined ? undefined : toJson(args.metadata),
        createdAt: args.at,
      },
    });
  }
}

/** The checkpoint the executor leaves on a finished run: everything produced, no agent mid-flight. */
export function terminalCheckpoint(args: { componentIndex: number; context: Record<string, unknown>; nextStepIndex: number; counters: { modelCalls: number; toolCalls: number; costUsd: number }; activeMs: number; deliverableId?: string }): RunCheckpoint {
  return {
    version: 1,
    componentIndex: args.componentIndex,
    context: args.context,
    nextStepIndex: args.nextStepIndex,
    counters: { ...args.counters, activeMs: args.activeMs },
    ...(args.deliverableId ? { deliverableId: args.deliverableId } : {}),
  };
}

export function assistantWithCalls(text: string, toolCalls: ToolCallRequest[]): ChatMessage {
  return { role: "assistant", content: text, ...(toolCalls.length > 0 ? { toolCalls } : {}) };
}
