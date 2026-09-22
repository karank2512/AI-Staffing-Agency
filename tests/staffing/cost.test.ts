import { describe, expect, it } from "vitest";
import { CostEstimateSchema, runsPerMonth, type AgentComponent, type WorkerBlueprint } from "@/server/domain";
import { llm } from "@/server/models";
import { designBlueprint, draftFromTemplate, estimateCost } from "@/server/staffing";
import { estimateTurns } from "@/server/staffing/cost";
import { tools } from "@/server/tools";
import { makeBlueprint } from "../helpers/fixtures";
import { specFor } from "./helpers";

type Uncosted = Omit<WorkerBlueprint, "costEstimate">;

function uncosted(bp: WorkerBlueprint): Uncosted {
  const rest: Partial<WorkerBlueprint> = { ...bp };
  delete rest.costEstimate;
  return rest as Uncosted;
}

function withCollectorTier(bp: Uncosted, modelTier: AgentComponent["modelTier"]): Uncosted {
  return { ...bp, components: bp.components.map((c) => (c.type === "agent" && c.id === "collector" ? { ...c, modelTier } : c)) };
}

describe("staffing: estimateCost", () => {
  const base = uncosted(makeBlueprint({ withNotifier: true }));

  it("returns a schema-valid estimate with one breakdown item per component, deterministic steps free", () => {
    const est = estimateCost(base);
    expect(CostEstimateSchema.safeParse(est).success).toBe(true);
    expect(est.breakdown.map((b) => b.componentId)).toEqual(base.components.map((c) => c.id));
    for (const item of est.breakdown) {
      const component = base.components.find((c) => c.id === item.componentId)!;
      if (component.type === "deterministic") {
        expect(item).toMatchObject({ estModelCalls: 0, estInputTokens: 0, estOutputTokens: 0, estToolCalls: 0, costUsd: 0 });
        expect(item.modelTier).toBeUndefined();
      } else {
        expect(item.modelTier).toBe(component.modelTier);
        expect(item.estModelCalls).toBe(estimateTurns(component));
        expect(item.costUsd).toBeGreaterThan(0);
      }
    }
    expect(est.perRunUsd).toBeCloseTo(est.breakdown.reduce((s, b) => s + b.costUsd, 0), 6);
    expect(est.runsPerMonth).toBe(runsPerMonth(base.schedule));
    expect(est.monthlyUsd).toBeCloseTo(est.perRunUsd * est.runsPerMonth, 6);
    expect(est.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(est.confidence).toBe("medium"); // market_research
  });

  it("uses the documented token heuristics and prices them at the tier", () => {
    const collector = base.components.find((c) => c.id === "collector") as AgentComponent;
    const item = estimateCost(base).breakdown.find((b) => b.componentId === "collector")!;
    const turns = Math.min(collector.maxTurns, 2 + collector.tools.length * 1.5);
    expect(turns).toBe(6.5);
    const input = 1_800 * turns + 600 * collector.inputKeys.length + 300 * collector.tools.length;
    const output = 900 * turns; // json collector
    expect(item.estInputTokens).toBe(Math.round(input));
    expect(item.estOutputTokens).toBe(Math.round(output));
    expect(item.estToolCalls).toBe(turns - 1);
    const fees = collector.tools.map((t) => tools.get(t)!.costPerCallUsd);
    const avgFee = fees.reduce((a, b) => a + b, 0) / fees.length;
    expect(item.costUsd).toBeCloseTo(llm.estimateCostUsd("standard", input, output) + (turns - 1) * avgFee, 6);

    const analyst = estimateCost(base).breakdown.find((b) => b.componentId === "analyst")!;
    expect(analyst.estModelCalls).toBe(2); // no tools → min(maxTurns 2, 2)
    expect(analyst.estOutputTokens).toBe(500 * 2); // markdown
    expect(analyst.estToolCalls).toBe(0);
  });

  it("is monotonic in model tier: reasoning > standard > fast for the same pipeline", () => {
    const fast = estimateCost(withCollectorTier(base, "fast")).perRunUsd;
    const standard = estimateCost(withCollectorTier(base, "standard")).perRunUsd;
    const reasoning = estimateCost(withCollectorTier(base, "reasoning")).perRunUsd;
    expect(fast).toBeLessThan(standard);
    expect(standard).toBeLessThan(reasoning);
  });

  it("is monotonic in cadence: weekly < daily < hourly monthly cost, same per-run cost", () => {
    const weekly = estimateCost({ ...base, schedule: { kind: "weekly", hour: 9, dayOfWeek: 1 } });
    const daily = estimateCost({ ...base, schedule: { kind: "daily", hour: 9 } });
    const hourly = estimateCost({ ...base, schedule: { kind: "hourly" } });
    const manual = estimateCost({ ...base, schedule: { kind: "manual" } });
    expect(weekly.perRunUsd).toBe(daily.perRunUsd);
    expect(weekly.monthlyUsd).toBeLessThan(daily.monthlyUsd);
    expect(daily.monthlyUsd).toBeLessThan(hourly.monthlyUsd);
    expect(manual.runsPerMonth).toBe(4);
    expect(weekly.assumptions.some((a) => /Weekly on Monday/.test(a))).toBe(true);
  });

  it("grows with more tools and shrinks when a step moves into code", () => {
    const fewerTools = { ...base, components: base.components.map((c) => (c.type === "agent" && c.id === "collector" ? { ...c, tools: ["web_search"] } : c)) };
    expect(estimateCost(fewerTools).perRunUsd).toBeLessThan(estimateCost(base).perRunUsd);
    const noAnalyst = { ...base, components: base.components.filter((c) => c.id !== "analyst") };
    expect(estimateCost(noAnalyst).perRunUsd).toBeLessThan(estimateCost(base).perRunUsd);
  });

  it("assigns confidence by family and matches what designBlueprint embeds", () => {
    const research = specFor("market_research");
    const bp = designBlueprint(research, draftFromTemplate(research));
    expect(bp.costEstimate).toEqual(estimateCost(uncosted(bp)));
    const feedback = specFor("feedback_analysis");
    expect(designBlueprint(feedback, draftFromTemplate(feedback)).costEstimate.confidence).toBe("high");
    const general = specFor("general");
    expect(designBlueprint(general, draftFromTemplate(general)).costEstimate.confidence).toBe("low");
  });
});
