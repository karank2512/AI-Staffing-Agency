import type { AgentComponent, BlueprintComponent, DeterministicComponent, JobSpec, WorkerBlueprint } from "@/server/domain";
import { renderJobBrief } from "@/server/domain";
import type { ChatMessage, ToolCallRequest } from "@/server/models/types";
import { runDeterministic, type ReportMeta } from "@/server/runtime/deterministic";
import { buildInitialMessage, buildSystemPrompt } from "@/server/runtime/messages";
import { createSimulation, seededShuffle } from "@/server/simulation";
import type { Simulation } from "@/server/simulation/types";
import { tools } from "@/server/tools";
import type { ToolName } from "@/server/tools/schemas";

/**
 * In-memory replay of a run through the SAME mock brain, simulated tools and deterministic operations the
 * executor uses — minus the database. The seed writes the resulting trace as rows, so seeded history reads
 * exactly like a live Simulated-mode run (same prompts, same tool inputs, same report layout), while staying
 * fast and fully deterministic.
 *
 * Variety across runs comes from two knobs that a live run also has: the clock (fixture dates are relative to
 * it) and the order in which the simulated web/datasets surface results (rotated by `seed`).
 */

export interface ToolExecution {
  call: ToolCallRequest;
  output: unknown;
  error?: string;
  costUsd: number;
}

export interface EmulatedTurn {
  /** The conversation the model was given for this turn. */
  request: ChatMessage[];
  text: string;
  toolCalls: ToolCallRequest[];
  finishReason: "stop" | "tool_calls";
  usage: { inputTokens: number; outputTokens: number };
  /** Executed after this turn, in order (empty when the turn was a final answer or the run paused). */
  executions: ToolExecution[];
}

export interface EmulatedAgent {
  component: AgentComponent;
  system: string;
  turns: EmulatedTurn[];
  /** Full conversation at the end (or at the pause). */
  messages: ChatMessage[];
  /** Final answer; undefined when the agent paused for approval. */
  output?: unknown;
  /** The tool call the run paused on (approval-gated). */
  pending?: ToolCallRequest;
}

export type EmulatedPart =
  | { kind: "agent"; component: AgentComponent; agent: EmulatedAgent }
  | { kind: "deterministic"; component: DeterministicComponent; summary: Record<string, unknown>; detail: string };

export interface EmulatedRun {
  context: Record<string, unknown>;
  parts: EmulatedPart[];
  /** Index of the component that paused (agent still mid-flight), or components.length when everything ran. */
  componentIndex: number;
}

export interface EmulateRunArgs {
  blueprint: WorkerBlueprint;
  spec: JobSpec;
  workerName: string;
  instructions?: string[];
  /** The run's wall-clock "now": fixture dates and report footers are relative to it. */
  now: Date;
  /** Rotates simulated search results / dataset order so consecutive runs do not repeat each other. */
  seed: number;
  /** "pause" leaves the approval-gated call unanswered (WAITING_FOR_APPROVAL); "approve" executes it. */
  approvals?: "pause" | "approve";
  /** Stop before this component (used to build partial traces for failed runs). */
  stopBefore?: string;
  /**
   * Applied to a json collector's final records before they enter the context. The brain is deterministic per
   * blueprint, so this is how consecutive runs of the same worker end up with a slightly different set.
   */
  shapeRecords?: (records: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
}

const CHARS_PER_TOKEN = 4;
const estimateTokens = (chars: number) => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

function rotate<T>(items: readonly T[], seed: number): T[] {
  if (items.length < 2 || seed === 0) return [...items];
  return seededShuffle(items, seed);
}

/** Simulated tool backends, exactly as tools/impl/* call them in Simulated mode, plus the per-run rotation. */
function executeTool(name: ToolName, input: unknown, sim: Simulation, seed: number): { output: unknown; error?: string } {
  const args = input as Record<string, unknown>;
  switch (name) {
    case "web_search": {
      const query = String(args.query);
      const maxResults = typeof args.maxResults === "number" ? args.maxResults : 6;
      const results = rotate(sim.search(query, { maxResults: 10 }), seed ^ (query.length * 7919)).slice(0, maxResults);
      return { output: { results } };
    }
    case "fetch_url":
      return { output: sim.fetchPage(String(args.url)) };
    case "extract_data": {
      const fields = Array.isArray(args.fields) ? args.fields.map(String) : [];
      const maxRecords = typeof args.maxRecords === "number" ? args.maxRecords : undefined;
      return { output: { records: sim.extractRecords(String(args.text), fields, maxRecords ? { maxRecords } : undefined) } };
    }
    case "read_dataset": {
      const dataset = String(args.dataset);
      const all = rotate(sim.dataset(dataset), seed);
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      return { output: { dataset, records: limit ? all.slice(0, limit) : all, total: all.length } };
    }
    case "send_notification": {
      const recipients = Array.isArray(args.recipients) ? args.recipients.length : 1;
      return { output: { delivered: true, simulated: true, channel: args.channel, recipients } };
    }
    default:
      return { output: { error: `The tool "${name}" is not available in this replay` }, error: `The tool "${name}" is not available in this replay` };
  }
}

function runAgent(component: AgentComponent, args: EmulateRunArgs, context: Record<string, unknown>, sim: Simulation): EmulatedAgent {
  const { blueprint, spec } = args;
  const system = buildSystemPrompt(blueprint.persona, component);
  const toolSpecs = tools.specsFor(component.tools);
  const instructions = args.instructions ?? [];
  const jobBrief = typeof context.job_brief === "string" ? context.job_brief : "";
  const messages: ChatMessage[] = [{ role: "user", content: buildInitialMessage(component, context) }];
  const turns: EmulatedTurn[] = [];

  for (let turn = 0; turn < component.maxTurns; turn++) {
    const request = structuredClone(messages);
    const produced = sim.agentTurn({ component, jobFamily: blueprint.jobFamily, spec, jobBrief, instructions, system, messages, tools: toolSpecs });
    const offered = new Set(toolSpecs.map((t) => t.name));
    const toolCalls: ToolCallRequest[] = (produced.toolCalls ?? [])
      .filter((c) => offered.has(c.name))
      .map((c, i) => ({ id: `mock_${turn}_${i}`, name: c.name, input: c.input }));
    let text = produced.text ?? "";
    let output: unknown = text;
    if (toolCalls.length === 0 && component.outputFormat === "json") {
      const parsed = JSON.parse(text) as unknown;
      output = args.shapeRecords && Array.isArray(parsed) ? args.shapeRecords(parsed as Array<Record<string, unknown>>) : parsed;
      if (output !== parsed) text = JSON.stringify(output, null, 2);
    }
    const usage = {
      inputTokens: estimateTokens(system.length + JSON.stringify(messages).length),
      outputTokens: estimateTokens(text.length + (toolCalls.length > 0 ? JSON.stringify(toolCalls).length : 0)),
    };
    const entry: EmulatedTurn = { request, text, toolCalls, finishReason: toolCalls.length > 0 ? "tool_calls" : "stop", usage, executions: [] };
    turns.push(entry);
    messages.push({ role: "assistant", content: text, ...(toolCalls.length > 0 ? { toolCalls } : {}) });

    if (toolCalls.length === 0) return { component, system, turns, messages, output };

    for (const call of toolCalls) {
      const definition = tools.get(call.name);
      const gated = blueprint.tools.find((t) => t.toolName === call.name)?.requiresApproval ?? definition?.defaultRequiresApproval ?? false;
      if (gated && (args.approvals ?? "approve") === "pause") {
        return { component, system, turns, messages, pending: call };
      }
      const result = executeTool(call.name as ToolName, call.input, sim, args.seed);
      const costUsd = definition?.costPerCallUsd ?? 0;
      entry.executions.push({ call, output: result.output, error: result.error, costUsd });
      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, output: result.output, ...(result.error ? { isError: true } : {}) });
    }
  }
  throw new Error(`${component.name} did not finish within ${component.maxTurns} turns`);
}

/** Facts the report's methodology footer cites, gathered from the parts that ran so far (mirrors the executor). */
function reportMeta(args: EmulateRunArgs, parts: EmulatedPart[]): ReportMeta {
  const usage = new Map<string, number>();
  const trail: ReportMeta["recordTrail"] = [];
  for (const part of parts) {
    if (part.kind === "agent") {
      for (const turn of part.agent.turns) {
        for (const ex of turn.executions) {
          if (ex.error) continue;
          const label = tools.get(ex.call.name)?.displayName ?? ex.call.name;
          usage.set(label, (usage.get(label) ?? 0) + 1);
        }
      }
    } else if (typeof part.summary.before === "number" && typeof part.summary.after === "number") {
      trail.push({ label: part.component.name, before: part.summary.before, after: part.summary.after });
    }
  }
  return {
    personaName: args.workerName,
    now: args.now,
    pipeline: args.blueprint.components.map((c) => c.name),
    toolUsage: [...usage.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    recordTrail: trail,
  };
}

export function emulateRun(args: EmulateRunArgs): EmulatedRun {
  const sim = createSimulation(() => args.now);
  const context: Record<string, unknown> = { job_brief: renderJobBrief(args.spec), instructions: args.instructions ?? [] };
  const parts: EmulatedPart[] = [];
  const components: BlueprintComponent[] = args.blueprint.components;

  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    if (component.id === args.stopBefore) return { context, parts, componentIndex: index };
    if (component.type === "agent") {
      const agent = runAgent(component, args, context, sim);
      parts.push({ kind: "agent", component, agent });
      if (agent.pending) return { context, parts, componentIndex: index };
      context[component.outputKey] = agent.output;
    } else {
      const result = runDeterministic(component, context, reportMeta(args, parts));
      parts.push({ kind: "deterministic", component, summary: result.summary, detail: result.detail });
      context[component.outputKey] = result.value;
    }
  }
  return { context, parts, componentIndex: components.length };
}

/** Records behind the deliverable (the `dataKey` context value), when they are flat records. */
export function recordsOf(context: Record<string, unknown>, key: string | undefined): Array<Record<string, unknown>> | null {
  if (!key) return null;
  const value = context[key];
  if (!Array.isArray(value)) return null;
  return value.every((r) => typeof r === "object" && r !== null && !Array.isArray(r)) ? (value as Array<Record<string, unknown>>) : null;
}
