import type { z } from "zod";
import {
  DETERMINISTIC_CHECK_CONFIG_SCHEMAS,
  type DeterministicCheck,
  type DeterministicCheckType,
  type EvaluationPlan,
} from "@/server/domain/blueprint";
import type { CheckResult } from "@/server/domain/evaluation";
import { completenessStats, duplicateStats, type EvalRecord } from "./records";
import type { EvalSubject } from "./types";

/**
 * Deterministic checks — free, reproducible quality gates over one run's deliverable. PURE: no I/O, no clock.
 * Partial credit wherever a ratio is meaningful, so the score degrades smoothly instead of flipping 1 → 0.
 */

type CheckConfig<T extends DeterministicCheckType> = z.infer<(typeof DETERMINISTIC_CHECK_CONFIG_SCHEMAS)[T]>;

interface CheckOutcome {
  passed: boolean;
  /** 0..1 */
  score: number;
  observed: string;
  expected: string;
}

type CheckEvaluators = { [T in DeterministicCheckType]: (config: CheckConfig<T>, subject: EvalSubject) => CheckOutcome };

const NO_RECORDS_OBSERVED = "no structured records";

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
/** Cents normally; four decimals only when the amount has sub-cent precision (typical for a single model call). */
const usd = (n: number) => `$${n.toFixed(Math.abs(Math.round(n * 100) / 100 - n) < 1e-9 ? 2 : 4)}`;
const seconds = (n: number) => `${Math.round(n * 10) / 10}s`;

/** Record-based checks cannot say anything about a deliverable that carries no structured data. */
function withRecords(
  subject: EvalSubject,
  expected: string,
  evaluate: (records: EvalRecord[]) => CheckOutcome,
): CheckOutcome {
  if (subject.records === null) return { passed: false, score: 0, observed: NO_RECORDS_OBSERVED, expected };
  return evaluate(subject.records);
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

const EVALUATORS: CheckEvaluators = {
  min_records: ({ min }, subject) =>
    withRecords(subject, `at least ${plural(min, "record")}`, (records) => ({
      passed: records.length >= min,
      score: clamp01(records.length / min),
      observed: plural(records.length, "record"),
      expected: `at least ${plural(min, "record")}`,
    })),

  required_fields: ({ fields, minCompleteness }, subject) => {
    const expected = `at least ${percent(minCompleteness)} of required fields filled (${fields.join(", ")})`;
    return withRecords(subject, expected, (records) => {
      const stats = completenessStats(records, fields);
      const gaps = stats.missingByField
        .slice(0, 3)
        .map((g) => `${g.field} missing in ${g.missing}`)
        .join(", ");
      const observed =
        records.length === 0
          ? "0 records to check"
          : `${percent(stats.completeness)} filled (${stats.filled} of ${stats.total} cells)${gaps ? ` — ${gaps}` : ""}`;
      return {
        // An empty dataset has nothing filled: it must not satisfy a completeness bar by vacuous truth.
        passed: records.length > 0 && stats.completeness >= minCompleteness,
        score: clamp01(stats.completeness),
        observed,
        expected,
      };
    });
  },

  no_duplicates: ({ keyFields }, subject) => {
    const expected = `no repeated ${keyFields.join(" + ")}`;
    return withRecords(subject, expected, (records) => {
      const stats = duplicateStats(records, keyFields);
      const examples = stats.examples.length > 0 ? ` (e.g. ${stats.examples.join(", ")})` : "";
      return {
        passed: stats.duplicates === 0,
        score: stats.total === 0 ? 1 : clamp01(stats.unique / stats.total),
        observed:
          stats.duplicates === 0
            ? `${plural(stats.total, "record")}, all unique`
            : `${plural(stats.duplicates, "duplicate")} among ${plural(stats.total, "record")}${examples}`,
        expected,
      };
    });
  },

  min_length: ({ minChars }, subject) => {
    const length = subject.content.trim().length;
    return {
      passed: length >= minChars,
      score: clamp01(length / minChars),
      observed: `${length.toLocaleString("en-US")} characters`,
      expected: `at least ${minChars.toLocaleString("en-US")} characters`,
    };
  },

  contains_sections: ({ sections }, subject) => {
    const haystack = normalizeForSearch(subject.content);
    const missing = sections.filter((section) => !haystack.includes(normalizeForSearch(section)));
    const found = sections.length - missing.length;
    return {
      passed: missing.length === 0,
      score: clamp01(found / sections.length),
      observed:
        missing.length === 0
          ? `all ${plural(sections.length, "section")} present`
          : `${found} of ${sections.length} sections present — missing: ${missing.join(", ")}`,
      expected: `sections: ${sections.join(", ")}`,
    };
  },

  max_cost_usd: ({ max }, subject) => {
    const passed = subject.costUsd <= max;
    return { passed, score: passed ? 1 : 0, observed: usd(subject.costUsd), expected: `at most ${usd(max)}` };
  },

  max_duration_sec: ({ max }, subject) => {
    const passed = subject.durationSec <= max;
    return { passed, score: passed ? 1 : 0, observed: seconds(subject.durationSec), expected: `at most ${seconds(max)}` };
  },
};

function evaluateCheck(check: DeterministicCheck, subject: EvalSubject): CheckOutcome {
  const parsed = DETERMINISTIC_CHECK_CONFIG_SCHEMAS[check.type].safeParse(check.config);
  if (!parsed.success) {
    // Blueprints are validated on write, so this only happens for hand-edited data. Fail loudly, never throw.
    return {
      passed: false,
      score: 0,
      observed: `invalid check configuration: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      expected: "a valid configuration",
    };
  }
  // TypeScript cannot correlate `check.type` with its config type across the lookup; the schema parse above did.
  const evaluate = EVALUATORS[check.type] as (config: unknown, subject: EvalSubject) => CheckOutcome;
  return evaluate(parsed.data, subject);
}

export function runDeterministicChecks(
  plan: EvaluationPlan,
  subject: EvalSubject,
): { score: number; passed: boolean; checks: CheckResult[] } {
  const checks: CheckResult[] = plan.deterministicChecks.map((check) => ({
    id: check.id,
    type: check.type,
    description: check.description,
    weight: check.weight,
    ...evaluateCheck(check, subject),
  }));

  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  // A plan without checks has nothing to fail: score 1 (vacuous) rather than NaN.
  const score = totalWeight > 0 ? clamp01(checks.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight) : 1;
  return { score, passed: score >= plan.passThreshold, checks };
}
