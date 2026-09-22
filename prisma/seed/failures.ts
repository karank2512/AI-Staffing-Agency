import type { AgentComponent, JobSpec, WorkerBlueprint } from "@/server/domain";
import { renderJobBrief } from "@/server/domain";
import type { ChatMessage, ToolCallRequest } from "@/server/models/types";
import { repairPrompt } from "@/server/runtime";
import { createSimulation } from "@/server/simulation";
import type { ToolName } from "@/server/tools/schemas";
import { emulateAgent, estimateTurnUsage, simulateTool, type EmulatedTurn, type EmulateRunArgs, type ToolExecution } from "./emulate";
import type { FailedAttempt } from "./runs";

/**
 * Failure traces for the badly designed worker. They start from the collector's real simulated trajectory (same
 * searches, same pages) and end the way a fast-tier model with a one-line prompt actually goes wrong — prose
 * instead of JSON even after the repair turn, or re-searching until the tool-call limit trips — with the exact
 * messages the runtime raises for those cases.
 */

const NO_JSON = "no valid JSON array or object was found in the answer";

interface Args {
  blueprint: WorkerBlueprint;
  spec: JobSpec;
  workerName: string;
  now: Date;
  seed: number;
}

function collectorOf(blueprint: WorkerBlueprint): AgentComponent {
  const collector = blueprint.components.find((c): c is AgentComponent => c.type === "agent" && c.outputFormat === "json");
  if (!collector) throw new Error("The blueprint has no json collector");
  return collector;
}

function baseRun(args: Args): { component: AgentComponent; emulateArgs: EmulateRunArgs; context: Record<string, unknown> } {
  const component = collectorOf(args.blueprint);
  const emulateArgs: EmulateRunArgs = { blueprint: args.blueprint, spec: args.spec, workerName: args.workerName, now: args.now, seed: args.seed };
  return { component, emulateArgs, context: { job_brief: renderJobBrief(args.spec), instructions: [] } };
}

const money = (value: unknown) => (typeof value === "number" ? `$${Math.round(value / 1_000_000)}M` : "amount not disclosed");

/** How a sloppy model "lists" records in prose — no brackets anywhere, so no JSON can be salvaged from it. */
function proseList(records: Array<Record<string, unknown>>, intro: string): string {
  const lines = records.slice(0, 8).map((r, i) => `${i + 1}. ${String(r.company ?? "Unknown")} — ${String(r.category ?? "AI infrastructure")}, ${String(r.stage ?? "stage unknown")}, raised ${money(r.amount_usd)}`);
  return [intro, "", ...lines, "", "Let me know if you want more detail on any of these."].join("\n");
}

function turnOf(system: string, request: ChatMessage[], text: string, toolCalls: ToolCallRequest[] = [], executions: ToolExecution[] = []): EmulatedTurn {
  return { request: structuredClone(request), text, toolCalls, finishReason: toolCalls.length > 0 ? "tool_calls" : "stop", usage: estimateTurnUsage(system, request, text, toolCalls), executions };
}

/** Final answer in prose, the runtime's repair prompt, prose again → "Researcher did not return valid JSON". */
export function invalidJsonAttempt(args: Args): FailedAttempt {
  const { component, emulateArgs, context } = baseRun(args);
  const sim = createSimulation(() => args.now);
  const agent = emulateAgent(component, emulateArgs, context, sim);
  const finalTurn = agent.turns.at(-1);
  if (!finalTurn || finalTurn.toolCalls.length > 0) throw new Error("The collector did not reach a final answer");
  const records = Array.isArray(agent.output) ? (agent.output as Array<Record<string, unknown>>) : [];

  const messages = structuredClone(finalTurn.request);
  const first = proseList(records, "Here are the AI infrastructure companies I found:");
  const turns = [...agent.turns.slice(0, -1), turnOf(agent.system, messages, first)];
  messages.push({ role: "assistant", content: first }, { role: "user", content: repairPrompt(component, NO_JSON) });
  const second = proseList(records, "Sure — here is the list again, cleaned up:");
  turns.push(turnOf(agent.system, messages, second));
  messages.push({ role: "assistant", content: second });

  return {
    part: { kind: "agent", component, agent: { component, system: agent.system, turns, messages } },
    code: "MODEL_ERROR",
    message: `${component.name} did not return valid JSON: ${NO_JSON}`,
    retryable: true,
  };
}

/** The collector keeps re-searching and re-reading until the next batch would pass `maxToolCallsPerRun`. */
export function toolLimitAttempt(args: Args): FailedAttempt {
  const { component, emulateArgs, context } = baseRun(args);
  const sim = createSimulation(() => args.now);
  const normal = emulateAgent(component, emulateArgs, context, sim);
  const limit = args.blueprint.limits.maxToolCallsPerRun;
  // Keep the real opening (search → read); everything after it is the model wandering.
  const opening = normal.turns.filter((t) => t.toolCalls.length > 0).slice(0, 2);
  const turns: EmulatedTurn[] = [...opening];
  const messages: ChatMessage[] = structuredClone(opening[0]?.request ?? normal.messages.slice(0, 1));
  const fetched = new Set<string>();
  for (const t of opening) {
    messages.push({ role: "assistant", content: t.text, toolCalls: t.toolCalls });
    for (const ex of t.executions) {
      messages.push({ role: "tool", toolCallId: ex.call.id, toolName: ex.call.name, output: ex.output });
      if (ex.call.name === "fetch_url") fetched.add(String((ex.call.input as { url?: unknown }).url));
    }
  }
  let used = turns.reduce((n, t) => n + t.executions.length, 0);

  const runTurn = (text: string, calls: Array<{ name: ToolName; input: Record<string, unknown> }>) => {
    const turnIndex = turns.length;
    const toolCalls = calls.map((c, i) => ({ id: `mock_${turnIndex}_${i}`, name: c.name, input: c.input }));
    const executions: ToolExecution[] = toolCalls.map((call) => ({ call, ...simulateTool(call.name as ToolName, call.input, sim, args.seed + turnIndex), costUsd: 0 }));
    turns.push(turnOf(normal.system, messages, text, toolCalls, executions));
    messages.push({ role: "assistant", content: text, toolCalls });
    for (const ex of executions) messages.push({ role: "tool", toolCallId: ex.call.id, toolName: ex.call.name, output: ex.output });
    used += executions.length;
    return executions;
  };

  const queries = ["AI infrastructure companies list", "top AI infra startups raised"];
  const searches = runTurn(`Not enough yet — searching again for ${queries.map((q) => `"${q}"`).join(" and ")}.`, queries.map((query) => ({ name: "web_search", input: { query, maxResults: 8 } })));
  const urls = searches
    .flatMap((ex) => ((ex.output as { results?: Array<{ url: string }> }).results ?? []).map((r) => r.url))
    .filter((url, i, all) => !fetched.has(url) && all.indexOf(url) === i)
    // Exactly fills the budget: this batch still passes the check (used + batch <= limit), the next one cannot.
    .slice(0, Math.max(1, Math.min(4, limit - used)));
  runTurn(`Opening the ${urls.length} most relevant sources.`, urls.map((url) => ({ name: "fetch_url", input: { url } })));

  // The next batch is created only after the limit check passes — it never gets rows, just the failure.
  const pages = messages.filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool" && m.toolName === "fetch_url");
  const text = pages.map((m) => String((m.output as { text?: unknown }).text ?? "")).join("\n\n---\n\n").slice(0, 24_000);
  const extract = [{ id: `mock_${turns.length}_0`, name: "extract_data", input: { text, fields: args.spec.deliverable.fields.map((f) => f.name), maxRecords: 24 } }];
  turns.push(turnOf(normal.system, messages, "Extracting structured records from what I read.", extract));
  messages.push({ role: "assistant", content: "Extracting structured records from what I read.", toolCalls: extract });

  return {
    part: { kind: "agent", component, agent: { component, system: normal.system, turns, messages } },
    code: "LIMIT_EXCEEDED",
    message: `The run would exceed its limit of ${limit} tool call${limit === 1 ? "" : "s"} (${used} used, ${extract.length} more requested)`,
    retryable: false,
  };
}
