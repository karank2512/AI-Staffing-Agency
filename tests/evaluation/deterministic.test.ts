import { describe, expect, it } from "vitest";
import type { DeterministicCheck, EvaluationPlan } from "@/server/domain/blueprint";
import { runDeterministicChecks } from "@/server/evaluation";
import { goodRecords, poorRecords, subject } from "./helpers";

const RUBRIC = [{ id: "relevance", criterion: "Relevance", description: "Records are relevant", weight: 1 }];

function plan(checks: Array<Partial<DeterministicCheck> & Pick<DeterministicCheck, "type" | "config">>, passThreshold = 0.7): EvaluationPlan {
  return {
    deterministicChecks: checks.map((c, i) => ({
      id: c.id ?? `${c.type}_${i}`,
      type: c.type,
      description: c.description ?? c.type,
      config: c.config,
      weight: c.weight ?? 1,
    })),
    rubric: RUBRIC,
    weights: { deterministic: 0.3, judge: 0.4, user: 0.3 },
    passThreshold,
  };
}

function single(check: Parameters<typeof plan>[0][number], s = subject()) {
  const result = runDeterministicChecks(plan([check]), s);
  expect(result.checks).toHaveLength(1);
  return result.checks[0];
}

describe("evaluation: deterministic checks (pure)", () => {
  it.each([
    { records: goodRecords(10), min: 8, passed: true, score: 1 },
    { records: goodRecords(4), min: 8, passed: false, score: 0.5 },
    { records: [], min: 8, passed: false, score: 0 },
    { records: goodRecords(10), min: 10, passed: true, score: 1 },
  ])("min_records: $records.length records vs min $min → passed=$passed score=$score", ({ records, min, passed, score }) => {
    const check = single({ type: "min_records", config: { min } }, subject({ records }));
    expect(check.passed).toBe(passed);
    expect(check.score).toBeCloseTo(score, 5);
    expect(check.observed).toBe(`${records.length} record${records.length === 1 ? "" : "s"}`);
    expect(check.expected).toBe(`at least ${min} records`);
  });

  it("required_fields: partial credit = filled cells / total, passed at minCompleteness", () => {
    const fields = ["company", "stage", "amount_usd", "source_url"];
    const good = single({ type: "required_fields", config: { fields, minCompleteness: 0.9 } });
    expect(good).toMatchObject({ passed: true, score: 1 });
    expect(good.observed).toContain("100% filled (40 of 40 cells)");

    // poorRecords: 7 rows × 4 fields = 28 cells; amount_usd missing ×2, source_url missing ×3 → 23 filled.
    const poor = single({ type: "required_fields", config: { fields, minCompleteness: 0.9 } }, subject({ records: poorRecords() }));
    expect(poor.passed).toBe(false);
    expect(poor.score).toBeCloseTo(23 / 28, 5);
    expect(poor.observed).toContain("82% filled (23 of 28 cells)");
    expect(poor.observed).toContain("source_url missing in 3");

    const lenient = single({ type: "required_fields", config: { fields, minCompleteness: 0.7 } }, subject({ records: poorRecords() }));
    expect(lenient.passed).toBe(true);

    const empty = single({ type: "required_fields", config: { fields, minCompleteness: 0 } }, subject({ records: [] }));
    expect(empty).toMatchObject({ passed: false, score: 0, observed: "0 records to check" });
  });

  it("no_duplicates: score = unique / total, case- and whitespace-insensitive on the key fields", () => {
    const clean = single({ type: "no_duplicates", config: { keyFields: ["company"] } });
    expect(clean).toMatchObject({ passed: true, score: 1 });
    expect(clean.observed).toBe("10 records, all unique");

    const records = [...goodRecords(4), { ...goodRecords(1)[0], company: "  vectorline   SYSTEMS " }];
    const dupes = single({ type: "no_duplicates", config: { keyFields: ["company"] } }, subject({ records }));
    expect(dupes.passed).toBe(false);
    expect(dupes.score).toBeCloseTo(4 / 5, 5);
    expect(dupes.observed).toContain("1 duplicate among 5 records");
    expect(dupes.observed).toContain("vectorline systems");

    // Composite keys: same company, different stage → not a duplicate.
    const composite = single({ type: "no_duplicates", config: { keyFields: ["company", "stage"] } }, subject({ records }));
    expect(composite.score).toBeCloseTo(4 / 5, 5); // stage matches too ("Series B" vs "Series B")
    const distinctStage = [...goodRecords(4), { ...goodRecords(1)[0], stage: "Seed" }];
    expect(single({ type: "no_duplicates", config: { keyFields: ["company", "stage"] } }, subject({ records: distinctStage })).passed).toBe(true);
  });

  it("min_length / contains_sections: proportional credit on the content", () => {
    const content = "word ".repeat(100).trim(); // 499 chars
    const short = single({ type: "min_length", config: { minChars: 1000 } }, subject({ content }));
    expect(short.passed).toBe(false);
    expect(short.score).toBeCloseTo(0.499, 3);
    expect(single({ type: "min_length", config: { minChars: 400 } }, subject({ content })).passed).toBe(true);

    const sections = single({ type: "contains_sections", config: { sections: ["Summary", "TOP ROUNDS", "Appendix"] } });
    expect(sections.passed).toBe(false);
    expect(sections.score).toBeCloseTo(2 / 3, 5);
    expect(sections.observed).toBe("2 of 3 sections present — missing: Appendix");
    expect(single({ type: "contains_sections", config: { sections: ["summary", "trends"] } })).toMatchObject({ passed: true, score: 1 });
  });

  it("max_cost_usd / max_duration_sec are binary on the run rollups", () => {
    expect(single({ type: "max_cost_usd", config: { max: 0.5 } }, subject({ costUsd: 0.2 }))).toMatchObject({ passed: true, score: 1 });
    const over = single({ type: "max_cost_usd", config: { max: 0.1 } }, subject({ costUsd: 0.2 }));
    expect(over).toMatchObject({ passed: false, score: 0, observed: "$0.20", expected: "at most $0.10" });
    expect(single({ type: "max_cost_usd", config: { max: 0.01 } }, subject({ costUsd: 0.0035 })).observed).toBe("$0.0035");
    expect(single({ type: "max_duration_sec", config: { max: 60 } }, subject({ durationSec: 40 })).passed).toBe(true);
    expect(single({ type: "max_duration_sec", config: { max: 30 } }, subject({ durationSec: 40 }))).toMatchObject({ passed: false, score: 0 });
  });

  it("record-based checks fail with 'no structured records' when the subject has none", () => {
    const s = subject({ records: null });
    for (const type of ["min_records", "required_fields", "no_duplicates"] as const) {
      const config =
        type === "min_records" ? { min: 5 } : type === "required_fields" ? { fields: ["company"], minCompleteness: 0.5 } : { keyFields: ["company"] };
      expect(single({ type, config }, s)).toMatchObject({ passed: false, score: 0, observed: "no structured records" });
    }
    // Content-based checks still work without records.
    expect(single({ type: "contains_sections", config: { sections: ["Summary"] } }, s).passed).toBe(true);
  });

  it("overall score is the weighted mean and passes at the plan threshold", () => {
    const p = plan(
      [
        { id: "recs", type: "min_records", config: { min: 8 }, weight: 2 }, // 4/8 → 0.5
        { id: "cost", type: "max_cost_usd", config: { max: 1 }, weight: 1 }, // 1
        { id: "sections", type: "contains_sections", config: { sections: ["Summary", "Missing"] }, weight: 1 }, // 0.5
      ],
      0.6,
    );
    const result = runDeterministicChecks(p, subject({ records: goodRecords(4) }));
    expect(result.score).toBeCloseTo((0.5 * 2 + 1 + 0.5) / 4, 5); // 0.625
    expect(result.passed).toBe(true);
    expect(result.checks.map((c) => c.id)).toEqual(["recs", "cost", "sections"]);
    expect(result.checks.map((c) => c.weight)).toEqual([2, 1, 1]);
    expect(runDeterministicChecks({ ...p, passThreshold: 0.7 }, subject({ records: goodRecords(4) })).passed).toBe(false);
  });

  it("an invalid config fails the check instead of throwing; an empty plan scores 1", () => {
    const check = single({ type: "min_records", config: { min: "eight" } });
    expect(check.passed).toBe(false);
    expect(check.score).toBe(0);
    expect(check.observed).toContain("invalid check configuration");

    const empty = runDeterministicChecks(plan([]), subject());
    expect(empty).toEqual({ score: 1, passed: true, checks: [] });
  });
});
