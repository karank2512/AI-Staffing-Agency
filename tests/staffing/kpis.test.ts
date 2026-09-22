import { describe, expect, it } from "vitest";
import { DEFAULT_EVALUATION_WEIGHTS, DEFAULT_PASS_THRESHOLD, DEFAULT_RUN_LIMITS, DETERMINISTIC_CHECK_CONFIG_SCHEMAS, EvaluationPlanSchema, KpiSchema } from "@/server/domain";
import { deriveEvaluationPlan, deriveKpis, designBlueprint, draftFromTemplate } from "@/server/staffing";
import { avatarColorFor, PERSONA_NAMES, pickPersonaName, resolvePersonaName } from "@/server/staffing/persona";
import { makeJobSpec } from "../helpers/fixtures";
import { FAMILIES, specFor } from "./helpers";

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

  it("omits records_per_run without a target, and uses ONE cost ceiling for the KPI, the check and the hard limit", () => {
    const base = makeJobSpec();
    const spec = { ...base, deliverable: { ...base.deliverable, targetCount: undefined }, budget: {} };
    const kpis = deriveKpis(spec);
    expect(kpis.map((k) => k.metric)).not.toContain("records_per_run");
    expect(kpis.find((k) => k.metric === "cost_per_run_usd")?.target).toBe(DEFAULT_RUN_LIMITS.maxCostPerRunUsd);
    expect(deriveEvaluationPlan(spec, { keyFields: [] }).deterministicChecks.find((c) => c.type === "max_cost_usd")?.config).toEqual({ max: DEFAULT_RUN_LIMITS.maxCostPerRunUsd });

    // Same for a designed worker: KPI target === check === blueprint limit, with or without a budget.
    for (const budget of [{}, { maxCostPerRunUsd: 0.4 }]) {
      const research = specFor("market_research", { budget });
      const bp = designBlueprint(research, draftFromTemplate(research));
      const kpi = bp.kpis.find((k) => k.metric === "cost_per_run_usd")?.target;
      const check = bp.evaluation.deterministicChecks.find((c) => c.type === "max_cost_usd")?.config;
      expect(check).toEqual({ max: kpi });
      expect(bp.limits.maxCostPerRunUsd).toBe(kpi);
    }
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

    // Criteria are qualities a reviewer can judge from the deliverable, never KPI names.
    expect(plan.rubric.map((r) => r.criterion)).toEqual(["Coverage of the brief", "Every round cites a source", "Accuracy & sourcing", "Specificity of insights", "Usefulness for the people deciding on it"]);
    expect(plan.rubric.map((r) => r.id)).toEqual(["coverage", "accuracy", "accuracy_sourcing", "specificity", "usefulness"]);
    expect(plan.rubric[0].description).toContain("about 10 records per run");
    expect(plan.rubric[0].description).toContain("At least 10 relevant funded startups per report.");
    expect(plan.rubric[1].description).toBe("Every round cites a source. Target: 100%.");
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
    expect(plan.rubric[1]).toMatchObject({ id: "accuracy", criterion: "Sourced", description: "Sourced.", weight: 1 });
    expect(plan.rubric[2].id).toBe("accuracy_2");
  });

  it("never turns a KPI or a measured metric into a judged criterion, for any family or format", () => {
    const kpiNames = new Set(deriveKpis(makeJobSpec()).map((k) => k.name.toLowerCase()));
    const metricish = /acceptance rate|quality score|records per run|field completeness|success rate|cost per run|duplicates$/i;
    for (const family of FAMILIES) {
      for (const format of ["markdown", "csv"] as const) {
        const base = specFor(family);
        const spec = { ...base, deliverable: { ...base.deliverable, format, sections: format === "markdown" ? base.deliverable.sections : [] } };
        const rubric = deriveEvaluationPlan(spec, { keyFields: [] }).rubric;
        for (const r of rubric) {
          expect(kpiNames.has(r.criterion.toLowerCase()), r.criterion).toBe(false);
          expect(r.criterion, r.criterion).not.toMatch(metricish);
          expect(r.criterion.length).toBeLessThanOrEqual(60);
          expect(r.criterion).not.toContain("…");
          // A KPI threshold is not something a reader can check on the page.
          expect(r.description).not.toMatch(/Target: >= \d+%/);
        }
        expect(rubric.map((r) => r.criterion)).toEqual(expect.arrayContaining(["Coverage of the brief", "Accuracy & sourcing", format === "markdown" ? "Specificity of insights" : "Specificity of each record"]));
        expect(rubric.some((r) => r.criterion.startsWith("Usefulness for "))).toBe(true);
      }
    }
    // A stated audience is the one the usefulness criterion names.
    const content = specFor("content", {}, { audience: "Developers, friendly and specific" });
    expect(deriveEvaluationPlan(content, { keyFields: [] }).rubric.at(-1)?.criterion).toBe("Usefulness for developers");
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
