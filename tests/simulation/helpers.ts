import type { AgentComponent } from "@/server/domain/blueprint";
import type { JobFamily } from "@/server/domain/job-family";
import { renderJobBrief, type JobSpec } from "@/server/domain/job-spec";
import type { ChatMessage, ToolCallRequest, ToolSpec } from "@/server/models/types";
import { createSimulation } from "@/server/simulation";
import type { MockAgentTurnInput, Simulation } from "@/server/simulation/types";
import { TOOL_INPUT_SCHEMAS, type ToolName } from "@/server/tools/schemas";
import { makeBlueprint, makeJobSpec } from "../helpers/fixtures";

/** Pinned clock so fixture dates are identical across the whole suite (the product uses the real clock). */
export const FIXED_NOW = new Date("2026-09-18T12:00:00.000Z");
export const sim: Simulation = createSimulation(() => FIXED_NOW);

export function toolSpecs(names: readonly string[]): ToolSpec[] {
  return names
    .filter((n): n is ToolName => n in TOOL_INPUT_SCHEMAS)
    .map((name) => ({ name, description: `${name} tool`, inputSchema: TOOL_INPUT_SCHEMAS[name] }));
}

export function componentOf(id: string, opts: Parameters<typeof makeBlueprint>[0] = {}): AgentComponent {
  const component = makeBlueprint(opts).components.find((c) => c.id === id);
  if (!component || component.type !== "agent") throw new Error(`no agent component "${id}" in the fixture blueprint`);
  return component;
}

/**
 * Mirrors the runtime's initial user message: brief + instructions + each input key under `## <key>`,
 * fenced JSON for non-strings, raw text for strings.
 */
export function initialMessage(spec: JobSpec, instructions: string[], context: Record<string, unknown> = {}): string {
  const parts = ["Here is everything you need for this run.", "", "## job_brief", renderJobBrief(spec), "", "## instructions", "```json", JSON.stringify(instructions), "```"];
  for (const [key, value] of Object.entries(context)) {
    parts.push("", `## ${key}`);
    if (typeof value === "string") parts.push(value);
    else parts.push("```json", JSON.stringify(value, null, 2), "```");
  }
  return parts.join("\n");
}

export interface AgentSetup {
  component: AgentComponent;
  spec?: JobSpec;
  jobFamily?: JobFamily;
  instructions?: string[];
  /** Extra `## key` sections in the initial message (records, stats, report …). */
  context?: Record<string, unknown>;
  /** Restrict the offered tools (default: the component's tools). */
  tools?: string[];
}

export function agentInput(setup: AgentSetup, messages?: ChatMessage[]): MockAgentTurnInput {
  const spec = setup.spec ?? makeJobSpec();
  const instructions = setup.instructions ?? [];
  return {
    component: setup.component,
    jobFamily: setup.jobFamily ?? spec.jobFamily,
    spec,
    jobBrief: renderJobBrief(spec),
    instructions,
    system: setup.component.instructions,
    messages: messages ?? [{ role: "user", content: initialMessage(spec, instructions, setup.context) }],
    tools: toolSpecs(setup.tools ?? setup.component.tools),
  };
}

export interface DriveOptions {
  /** Tools that should fail with `{ error }` (isError) instead of producing output. */
  failing?: Partial<Record<ToolName, string>>;
  simulation?: Simulation;
}

export interface DriveResult {
  /** Assistant turns taken, including the final one. */
  turns: number;
  messages: ChatMessage[];
  calls: ToolCallRequest[];
  /** The final answer text, or null when the agent never finished within maxTurns. */
  final: string | null;
}

function execute(call: ToolCallRequest, s: Simulation): unknown {
  const input = call.input as Record<string, unknown>;
  switch (call.name as ToolName) {
    case "web_search":
      return { results: s.search(String(input.query), { maxResults: typeof input.maxResults === "number" ? input.maxResults : undefined }) };
    case "fetch_url":
      return s.fetchPage(String(input.url));
    case "extract_data":
      return { records: s.extractRecords(String(input.text), input.fields as string[], { maxRecords: typeof input.maxRecords === "number" ? input.maxRecords : undefined }) };
    case "read_dataset": {
      const records = s.dataset(String(input.dataset));
      return { dataset: input.dataset, records, total: records.length };
    }
    case "send_notification":
      return { delivered: true, simulated: true, channel: input.channel, recipients: (input.recipients as string[]).length };
    default:
      return { error: `tool ${call.name} is not wired in the test driver` };
  }
}

/** Runs the agent loop the way the runtime does, executing tool calls through the simulation itself. */
export function driveAgent(setup: AgentSetup, opts: DriveOptions = {}): DriveResult {
  const s = opts.simulation ?? sim;
  const base = agentInput(setup);
  const messages: ChatMessage[] = [...base.messages];
  const calls: ToolCallRequest[] = [];
  const maxTurns = setup.component.maxTurns;
  let turns = 0;
  let final: string | null = null;
  // One extra iteration on purpose: a brain that keeps calling tools past maxTurns must be caught by the test.
  while (turns < maxTurns + 1) {
    const res = s.agentTurn({ ...base, messages });
    turns++;
    if (!res.toolCalls || res.toolCalls.length === 0) {
      final = res.text;
      break;
    }
    const turnIndex = messages.filter((m) => m.role === "assistant").length;
    const issued = res.toolCalls.map((c, i) => ({ id: `mock_${turnIndex}_${i}`, name: c.name, input: c.input }));
    messages.push({ role: "assistant", content: res.text, toolCalls: issued });
    for (const call of issued) {
      calls.push(call);
      const failure = opts.failing?.[call.name as ToolName];
      const output = failure !== undefined ? { error: failure } : execute(call, s);
      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, output, isError: failure !== undefined });
    }
  }
  return { turns, messages, calls, final };
}

export function parseRecords(text: string | null): Array<Record<string, unknown>> {
  if (text === null) throw new Error("agent produced no final answer");
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("final answer is not a JSON array");
  return parsed as Array<Record<string, unknown>>;
}

export function feedbackSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return makeJobSpec({
    title: "Customer Feedback Categorizer",
    jobFamily: "feedback_analysis",
    summary: "Categorizes incoming customer feedback and reports the main themes each week.",
    objective: "Read the customer feedback dataset, categorize each item by theme, sentiment and severity, and summarize priorities.",
    responsibilities: ["Categorize every feedback item", "Flag high-severity negative feedback", "Summarize themes for the product team"],
    inputs: [{ name: "Customer feedback", description: "Feedback export", source: "provided_data", required: true }],
    deliverable: {
      title: "Weekly Feedback Themes",
      description: "Categorized feedback with a themes summary.",
      format: "markdown",
      fields: [
        { name: "id", description: "Feedback id", required: true },
        { name: "customer", description: "Customer name", required: true },
        { name: "text", description: "Verbatim feedback", required: true },
        { name: "category", description: "Theme", required: true },
        { name: "sentiment", description: "positive / neutral / negative", required: true },
        { name: "severity", description: "low / medium / high", required: false },
      ],
      sections: ["Summary", "Themes", "Priorities"],
      targetCount: 40,
    },
    toolsLikelyNeeded: ["read_dataset"],
    ...overrides,
  });
}

export function categorizerComponent(tier: "fast" | "standard" | "reasoning" = "standard"): AgentComponent {
  return {
    type: "agent",
    id: "collector",
    name: "Categorizer",
    description: "Categorizes customer feedback.",
    goal: "Read the feedback dataset and label every item with a category, sentiment and severity.",
    instructions:
      "You are a careful customer-feedback analyst. Read every item in the customer_feedback dataset, assign a theme category, a sentiment and a severity, and return one record per item with exactly the requested fields.",
    modelTier: tier,
    tools: ["read_dataset"],
    maxTurns: 6,
    inputKeys: ["job_brief", "instructions"],
    outputKey: "records",
    outputFormat: "json",
  };
}
