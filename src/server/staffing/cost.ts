import {
  describeCadence,
  runsPerMonth,
  type AgentComponent,
  type BlueprintComponent,
  type CostBreakdownItem,
  type CostEstimate,
  type JobFamily,
  type WorkerBlueprint,
} from "@/server/domain";
import { llm } from "@/server/models";
import { tools } from "@/server/tools";

/**
 * Cost estimate for a blueprint — the number on the proposal card. Heuristic but honest: token counts per
 * model turn, priced at what the tier currently routes to (reference prices in Simulated mode), plus flat tool
 * fees. Deterministic components are free, which is exactly why the Staffing Engine prefers them.
 */

const INPUT_TOKENS_PER_TURN = 1_800;
const INPUT_TOKENS_PER_INPUT_KEY = 600;
const INPUT_TOKENS_PER_TOOL = 300;
const OUTPUT_TOKENS_PER_TURN_MARKDOWN = 500;
const OUTPUT_TOKENS_PER_TURN_JSON = 900;

const CONFIDENCE_BY_FAMILY: Record<JobFamily, CostEstimate["confidence"]> = {
  feedback_analysis: "high", // reads a dataset: a fixed number of calls
  support_triage: "high",
  market_research: "medium", // web research varies with how many sources are worth opening
  lead_research: "medium",
  market_analysis: "medium",
  finance_ops: "low", // depends entirely on how much source material each run brings
  content: "low",
  general: "low",
};

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** Expected model turns: one to plan, one to answer, and about 1.5 per tool (call + read), capped by maxTurns. */
export function estimateTurns(agent: Pick<AgentComponent, "maxTurns" | "tools">): number {
  return Math.min(agent.maxTurns, 2 + agent.tools.length * 1.5);
}

function averageToolFee(toolNames: readonly string[]): number {
  const fees = toolNames.map((name) => tools.get(name)?.costPerCallUsd).filter((fee): fee is number => typeof fee === "number");
  return fees.length > 0 ? fees.reduce((sum, fee) => sum + fee, 0) / fees.length : 0;
}

function agentItem(agent: AgentComponent): CostBreakdownItem {
  const turns = estimateTurns(agent);
  const inputTokens = INPUT_TOKENS_PER_TURN * turns + INPUT_TOKENS_PER_INPUT_KEY * agent.inputKeys.length + INPUT_TOKENS_PER_TOOL * agent.tools.length;
  const outputTokens = (agent.outputFormat === "json" ? OUTPUT_TOKENS_PER_TURN_JSON : OUTPUT_TOKENS_PER_TURN_MARKDOWN) * turns;
  const toolCalls = agent.tools.length > 0 ? Math.max(0, turns - 1) : 0;
  const modelCost = llm.estimateCostUsd(agent.modelTier, inputTokens, outputTokens);
  const toolCost = toolCalls * averageToolFee(agent.tools);
  return {
    componentId: agent.id,
    label: agent.name,
    modelTier: agent.modelTier,
    estModelCalls: round6(turns),
    estInputTokens: Math.round(inputTokens),
    estOutputTokens: Math.round(outputTokens),
    estToolCalls: round6(toolCalls),
    costUsd: round6(modelCost + toolCost),
  };
}

function deterministicItem(component: Extract<BlueprintComponent, { type: "deterministic" }>): CostBreakdownItem {
  return {
    componentId: component.id,
    label: component.name,
    estModelCalls: 0,
    estInputTokens: 0,
    estOutputTokens: 0,
    estToolCalls: 0,
    costUsd: 0,
  };
}

export function estimateCost(blueprint: Omit<WorkerBlueprint, "costEstimate">): CostEstimate {
  const breakdown = blueprint.components.map((c) => (c.type === "agent" ? agentItem(c) : deterministicItem(c)));
  const perRunUsd = round6(breakdown.reduce((sum, item) => sum + item.costUsd, 0));
  const perMonth = runsPerMonth(blueprint.schedule);
  const agents = blueprint.components.filter((c): c is AgentComponent => c.type === "agent");
  const deterministic = blueprint.components.length - agents.length;
  const toolCalls = breakdown.reduce((sum, item) => sum + item.estToolCalls, 0);

  const assumptions: string[] = agents.map((agent) => {
    const turns = estimateTurns(agent);
    const tools = agent.tools.length > 0 ? ` using ${agent.tools.join(", ")}` : " with no tools";
    return `${agent.name}: about ${turns} model turns on the ${agent.modelTier} tier${tools}.`;
  });
  assumptions.push(
    `Roughly ${INPUT_TOKENS_PER_TURN.toLocaleString("en-US")} input and ${OUTPUT_TOKENS_PER_TURN_MARKDOWN}–${OUTPUT_TOKENS_PER_TURN_JSON} output tokens per model turn, priced at each tier's current model.`,
  );
  if (toolCalls > 0) assumptions.push(`About ${Math.round(toolCalls)} tool calls per run at the platform's per-call fees.`);
  if (deterministic > 0) assumptions.push(`${deterministic} deterministic step${deterministic === 1 ? "" : "s"} (validation, ranking, formatting) run for free.`);
  assumptions.push(`${describeCadence(blueprint.schedule)} → about ${perMonth} runs per month.`);

  return {
    perRunUsd,
    runsPerMonth: perMonth,
    monthlyUsd: round6(perRunUsd * perMonth),
    breakdown,
    assumptions,
    confidence: CONFIDENCE_BY_FAMILY[blueprint.jobFamily],
  };
}
