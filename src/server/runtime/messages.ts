import type { AgentComponent, Persona } from "@/server/domain/blueprint";

/**
 * Prompt assembly for agent components. The initial user message follows the format the simulation brain
 * documents in src/server/simulation/brain/input.ts exactly: one `## <context_key>` heading per input key,
 * raw text for strings and a fenced ```json block for everything else.
 */

const INTRO = "Here is everything you need for this run.";

function renderValue(value: unknown): string[] {
  if (value === undefined) return ["(not available for this run)"];
  if (typeof value === "string") return [value.trim().length > 0 ? value : "(empty)"];
  return ["```json", JSON.stringify(value, null, 2), "```"];
}

export function buildInitialMessage(component: Pick<AgentComponent, "inputKeys">, context: Record<string, unknown>): string {
  const parts: string[] = [INTRO];
  for (const key of component.inputKeys) {
    parts.push("", `## ${key}`, ...renderValue(context[key]));
  }
  return parts.join("\n");
}

/** Platform preamble + the component's own instructions. The mock brain ignores it; live models need the rules. */
export function buildSystemPrompt(persona: Pick<Persona, "name" | "title">, component: AgentComponent): string {
  const outputRules =
    component.outputFormat === "json"
      ? [
          "- Your final answer must be ONLY valid JSON: a top-level array of flat records (or the object described below). No prose before or after it, no code fences.",
          component.outputSchemaHint ? `- Expected shape: ${component.outputSchemaHint}.` : "- Use exactly the field names the brief asks for.",
          "- Use null for a value you could not find. Never invent data.",
        ]
      : [
          "- Your final answer is Markdown prose: specific, concise, grounded in the inputs you were given. No preamble like “Here is the summary”.",
        ];
  return [
    `You are ${persona.name}, ${persona.title} — an AI worker on the AI Staffing Agency platform.`,
    `Your task in this run: ${component.goal}`,
    "",
    component.instructions.trim(),
    "",
    "How this works:",
    "- The first user message contains everything you need under “## <key>” headings: the job brief, one-off instructions from your manager, and the outputs of earlier steps.",
    "- Only use tools when they genuinely help. When you have enough information, stop calling tools and give your final answer.",
    `- You have at most ${component.maxTurns} turns; make each one count.`,
    ...outputRules,
  ].join("\n");
}

export function repairPrompt(component: AgentComponent, error: string): string {
  return [
    `Your previous answer could not be used: ${error}.`,
    "Reply again with ONLY the JSON — no prose, no code fences, nothing else.",
    component.outputSchemaHint ? `Expected shape: ${component.outputSchemaHint}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
