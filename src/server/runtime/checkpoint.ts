import { z } from "zod";
import type { ChatMessage } from "@/server/models/types";
import { emptyCheckpoint, type AgentCheckpoint, type RunCheckpoint } from "./types";

/**
 * Lenient reader for Run.checkpoint. The shape is defined by the frozen interfaces in ./types; this schema exists
 * so a hand-written checkpoint (seed data, an older row) still resumes instead of crashing the executor.
 */

const ToolCallRequestSchema = z.object({ id: z.string(), name: z.string(), input: z.unknown() });

const ChatMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string(), toolCalls: z.array(ToolCallRequestSchema).optional() }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
  }),
]);

const PendingToolCallSchema = z.object({
  toolCallId: z.string(),
  callId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});

const AgentCheckpointSchema = z.object({
  componentId: z.string(),
  messages: z.array(ChatMessageSchema).default([]),
  turn: z.number().int().min(0).default(0),
  pendingToolCalls: z.array(PendingToolCallSchema).default([]),
});

const RunCheckpointSchema = z.object({
  version: z.literal(1).default(1),
  componentIndex: z.number().int().min(0).default(0),
  context: z.record(z.string(), z.unknown()).default({}),
  agent: AgentCheckpointSchema.optional(),
  nextStepIndex: z.number().int().min(0).default(0),
  counters: z
    .object({
      modelCalls: z.number().default(0),
      toolCalls: z.number().default(0),
      costUsd: z.number().default(0),
      activeMs: z.number().default(0),
    })
    .default({ modelCalls: 0, toolCalls: 0, costUsd: 0, activeMs: 0 }),
  deliverableId: z.string().optional(),
});

/** Parse a stored checkpoint; `null` when the column is empty or unusable (the slice then starts fresh). */
export function parseCheckpoint(value: unknown): RunCheckpoint | null {
  if (value === null || value === undefined) return null;
  const parsed = RunCheckpointSchema.safeParse(value);
  if (!parsed.success) return null;
  const { agent, ...rest } = parsed.data;
  const checkpoint: RunCheckpoint = { ...emptyCheckpoint(), ...rest, version: 1 };
  if (agent) {
    checkpoint.agent = {
      componentId: agent.componentId,
      messages: agent.messages as ChatMessage[],
      turn: agent.turn,
      pendingToolCalls: agent.pendingToolCalls.map((p) => ({ ...p, input: p.input })),
    } satisfies AgentCheckpoint;
  }
  return checkpoint;
}

/** Deep copy of the JSON-serializable run context (used for the retry restore point). */
export function cloneContext(context: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(context)) as Record<string, unknown>;
}
