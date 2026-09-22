import { z } from "zod";
import type { RunStatus, RunStepKind, RunStepStatus, RunTrigger } from "@prisma/client";
import type { ChatMessage } from "@/server/models/types";

/**
 * Runtime contract: run state machine + the durable checkpoint persisted on Run.checkpoint.
 *
 * Durability model: ALL executor state lives in Postgres. The in-process executor loop is stateless —
 * it claims a QUEUED run, loads the checkpoint, continues from there, and writes the checkpoint back
 * at every component boundary and whenever it pauses for approval. A crash/restart loses nothing but
 * the in-flight step (recovered via stale-heartbeat detection).
 */

// ── State machine ───────────────────────────────────────────────────────────

export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  QUEUED: ["RUNNING", "CANCELLED"],
  // RUNNING → QUEUED happens on automatic retry and on stale-lock recovery.
  RUNNING: ["SUCCEEDED", "FAILED", "WAITING_FOR_APPROVAL", "CANCELLED", "QUEUED"],
  // A decision (approve OR reject) re-queues the run so the agent can continue / adapt.
  WAITING_FOR_APPROVAL: ["QUEUED", "CANCELLED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED"];

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

// ── Run input / output ──────────────────────────────────────────────────────

export const RunInputSchema = z.object({
  /** One-off instructions applied to this run only (from "Talk to worker" or the Run dialog). */
  instructions: z.array(z.string()).default([]),
  params: z.record(z.string(), z.unknown()).default({}),
  note: z.string().optional(),
});
export type RunInput = z.infer<typeof RunInputSchema>;

export const RunOutputSchema = z.object({
  summary: z.string(),
  deliverableIds: z.array(z.string()),
  stats: z.object({
    steps: z.number(),
    modelCalls: z.number(),
    toolCalls: z.number(),
  }),
});
export type RunOutput = z.infer<typeof RunOutputSchema>;

// ── Checkpoint ──────────────────────────────────────────────────────────────

export interface PendingToolCall {
  /** ToolCall row id. */
  toolCallId: string;
  /** Provider-issued id from the model turn. */
  callId: string;
  toolName: string;
  input: unknown;
}

/** Persisted at approval pauses and again right after each resumed tool batch (so approved calls never re-execute). */
export interface AgentCheckpoint {
  componentId: string;
  /** Full conversation so far, including the assistant turn that requested the pending tool calls. */
  messages: ChatMessage[];
  turn: number;
  /** Tool calls from the last assistant turn that have not produced a tool message yet. */
  pendingToolCalls: PendingToolCall[];
}

export interface RunCheckpoint {
  version: 1;
  /** Index into blueprint.components of the component to run next (or currently mid-flight if `agent` is set). */
  componentIndex: number;
  /** Shared run context: component outputs by outputKey (+ seeded keys). Must stay JSON-serializable. */
  context: Record<string, unknown>;
  /** Present only while an agent component is paused mid-loop (waiting for approval). */
  agent?: AgentCheckpoint;
  /**
   * Hint only. RunStep.index is monotonic for the life of the run ACROSS attempts: at the start of every
   * executeRun slice the executor uses max(this, max(RunStep.index in DB) + 1). A retry reset never rewinds it.
   */
  nextStepIndex: number;
  /**
   * Informational, except activeMs: accumulated EXECUTING time across slices (excludes approval waits and
   * retry backoff). maxRunDurationSec is enforced against activeMs (+ the current slice); Run.durationMs =
   * activeMs on terminal transition. Cost/tool-call limits are checked against DB truth instead
   * (Run.costUsd, ToolCall rows of the current attempt).
   */
  counters: { modelCalls: number; toolCalls: number; costUsd: number; activeMs: number };
  /** Set once the Deliverable row exists (created at the first component boundary where its keys are present). */
  deliverableId?: string;
}

export function emptyCheckpoint(context: Record<string, unknown> = {}): RunCheckpoint {
  return {
    version: 1,
    componentIndex: 0,
    context,
    nextStepIndex: 0,
    counters: { modelCalls: 0, toolCalls: 0, costUsd: 0, activeMs: 0 },
  };
}

// ── Public surface of src/server/runtime/index.ts ───────────────────────────

export interface EnqueueRunArgs {
  organizationId: string;
  workerId: string;
  trigger: "MANUAL" | "SCHEDULED" | "RETRY" | "CHAT" | "HIRE";
  input?: Partial<RunInput>;
  requestedById?: string;
  /** Delay first attempt. */
  availableAt?: Date;
}

export interface DecideApprovalArgs {
  organizationId: string;
  approvalId: string;
  userId: string;
  decision: "approve" | "reject";
  note?: string;
}

/** Result of driving one run as far as it can go right now. */
export type ExecuteOutcome =
  | { status: "SUCCEEDED"; deliverableIds: string[] }
  | { status: "WAITING_FOR_APPROVAL"; approvalIds: string[] }
  | { status: "FAILED"; error: string; willRetry: boolean }
  | { status: "CANCELLED" };

// ── Live view (GET /api/runs/[runId]) — plain JSON, safe to `import type` from client components ──

export interface RunLiveView {
  run: {
    id: string;
    status: RunStatus;
    trigger: RunTrigger;
    simulated: boolean;
    attempt: number;
    maxAttempts: number;
    error: string | null;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  steps: Array<{
    id: string;
    index: number;
    attempt: number;
    componentId: string | null;
    kind: RunStepKind;
    status: RunStepStatus;
    title: string;
    detail: string | null;
    error: string | null;
    startedAt: string;
    durationMs: number | null;
  }>;
  pendingApprovals: Array<{ id: string; title: string; description: string | null; toolName: string; payload: unknown }>;
  deliverableIds: string[];
  /** true while SUCCEEDED but no DETERMINISTIC/LLM_JUDGE Evaluation exists yet and finishedAt < 3 min ago → keep polling. */
  evaluationPending: boolean;
}
