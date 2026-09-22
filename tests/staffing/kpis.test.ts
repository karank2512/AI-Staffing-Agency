import { describe, expect, it } from "vitest";
import { DEFAULT_EVALUATION_WEIGHTS, DEFAULT_PASS_THRESHOLD, DETERMINISTIC_CHECK_CONFIG_SCHEMAS, EvaluationPlanSchema, KpiSchema } from "@/server/domain";
import { deriveEvaluationPlan, deriveKpis } from "@/server/staffing";
import { avatarColorFor, PERSONA_NAMES, pickPersonaName, resolvePersonaName } from "@/server/staffing/persona";
import { makeJobSpec } from "../helpers/fixtures";
import { specFor } from "./helpers";

describe("staffing: deriveKpis", () => {
  it("produces the contracted KPI set with targets from the spec", () => {
    const spec = makeJobSpec({ budget: { maxCostPerRunUsd: 0.6 } });
    const kpis = deriveKpis(spec);
    expect(kpis.every((k) => KpiSchema.safeParse(k).success)).toBe(true);
    expect(new Set(kpis.map((k) => k.id)).size).toBe(kpis.length);
    expect(kpis.map((k) => [k.metric, k.target, k.direction])).toEqual([
      ["acceptance_rate", 0.85, "higher_is_better"],
      ["quality_score", 0.8, "higher_is_better"],
      ["records_per_run", 10, "higher_is_better"],
      ["cost_per_run_usd", 0.6, "lower_is_better"],
      ["success_rate", 0.9, "higher_is_better"],
    ]);
    expect(kpis.find((k) => k.metric === "cost_per_run_usd")?.unit).toBe("$");
    expect(kpis.find((k) => k.metric === "acceptance_rate")?.unit).toBe("%");
  });

  it("omits records_per_run without a target and defaults the cost target to $1", () => {
    const base = makeJobSpec();
    const spec = { ...base, deliverable: { ...base.deliverable, targetCount: undefined }, budget: {} };
    const kpis = deriveKpis(spec);
    expect(kpis.map((k) => k.metric)).not.toContain("records_per_run");
    expect(kpis.find((k) => k.metric === "cost_per_run_usd")?.target).toBe(1);
  });
});

describe("staffing: deriveEvaluationPlan", () => {
  it("builds the deterministic checks from the spec and a rubric from the success criteria", () => {
    const spec = makeJobSpec();
    const plan = deriveEvaluationPlan(spec, { keyFields: ["company"] });
    expect(EvaluationPlanSchema.safeParse(plan).success).toBe(true);
    for (const check of plan.deterministicChecks) {
      expect(DETERMINISTIC_CHECK_CONFIG_SCHEMAS[check.type].safeParse(check.config).success).toBe(true);
    }
    const byType = Object.fromEntries(plan.deterministicChecks.map((c) => [c.type, c.config]));
    expect(byType.min_records).toEqual({ min: 8 }); // 0.8 × 10
    expect(byType.required_fields).toEqual({ fields: ["company", "stage", "amount_usd", "source_url"], minCompleteness: 0.9 });
    expect(byType.no_duplicates).toEqual({ keyFields: ["company"] });
    expect(byType.contains_sections).toEqual({ sections: ["Summary", "Top rounds", "Trends"] });
    expect(byType.max_cost_usd).toEqual({ max: 1 });

    expect(plan.rubric.map((r) => r.criterion)).toEqual(["Records per run", "Field completeness", "Accuracy & sourcing", "Usefulness"]);
    expect(plan.rubric.map((r) => r.id)).toEqual(["coverage", "accuracy", "accuracy_sourcing", "usefulness"]);
    expect(plan.rubric[0].description).toContain(">= 10");
    expect(plan.weights).toEqual(DEFAULT_EVALUATION_WEIGHTS);
    expect(plan.passThreshold).toBe(DEFAULT_PASS_THRESHOLD);
  });

  it("drops record checks when the deliverable has no fields, and section checks for non-markdown", () => {
    const base = makeJobSpec();
    const prose = { ...base, deliverable: { ...base.deliverable, fields: [], targetCount: undefined, format: "markdown" as const } };
    const types = deriveEvaluationPlan(prose, { keyFields: [] }).deterministicChecks.map((c) => c.type);
    expect(types).toEqual(["contains_sections", "max_cost_usd"]);

    const csv = specFor("lead_research");
    const csvTypes = deriveEvaluationPlan(csv, { keyFields: ["company", "contact_name"] }).deterministicChecks.map((c) => c.type);
    expect(csvTypes).toEqual(["min_records", "required_fields", "no_duplicates", "max_cost_usd"]);
  });

  it("falls back to the first required field for no_duplicates and de-duplicates rubric ids", () => {
    const base = makeJobSpec({
      successCriteria: [
        { id: "accuracy", description: "Sourced" },
        { id: "accuracy", description: "Also sourced" },
        { id: "Accuracy & Sourcing", description: "Collides with the built-in" },
      ],
    });
    const plan = deriveEvaluationPlan(base, { keyFields: ["nope"] });
    expect(plan.deterministicChecks.find((c) => c.type === "no_duplicates")?.config).toEqual({ keyFields: ["company"] });
    expect(new Set(plan.rubric.map((r) => r.id)).size).toBe(plan.rubric.length);
    expect(plan.rubric[0]).toMatchObject({ id: "accuracy", criterion: "Sourced", description: "Sourced.", weight: 1 });
    expect(plan.rubric[1].id).toBe("accuracy_2");
  });
});

describe("staffing: persona", () => {
  it("has a pool of two dozen distinct first names", () => {
    expect(PERSONA_NAMES.length).toBe(24);
    expect(new Set(PERSONA_NAMES.map((n) => n.toLowerCase())).size).toBe(24);
  });

  it("picks deterministically, skips names in use (case-insensitive) and never collides", () => {
    const first = pickPersonaName("Weekly funding tracker|market_research");
    expect(first).toBe(pickPersonaName("Weekly funding tracker|market_research"));
    expect(PERSONA_NAMES).toContain(first);
    const second = pickPersonaName("Weekly funding tracker|market_research", [first.toUpperCase()]);
    expect(second).not.toBe(first);
    const exhausted = pickPersonaName("x", PERSONA_NAMES);
    expect(PERSONA_NAMES.map((n) => n.toLowerCase())).not.toContain(exhausted.toLowerCase());
    expect(exhausted).toMatch(/^[A-Z][a-z]+ 2$/);
  });

  it("keeps a plausible proposed name, replaces junk or taken names", () => {
    expect(resolvePersonaName("Quinn", "seed")).toBe("Quinn");
    expect(resolvePersonaName("Quinn", "seed", ["QUINN"])).not.toBe("Quinn");
    expect(PERSONA_NAMES).toContain(resolvePersonaName("", "seed"));
    expect(PERSONA_NAMES).toContain(resolvePersonaName("Agent #42", "seed"));
  });

  it("derives the avatar color from the name alone", () => {
    expect(avatarColorFor("Alex")).toBe(avatarColorFor(" alex "));
    expect(new Set(PERSONA_NAMES.map(avatarColorFor)).size).toBeGreaterThan(3);
  });
});
