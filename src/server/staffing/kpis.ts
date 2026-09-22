import {
  DEFAULT_EVALUATION_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
  DEFAULT_RUN_LIMITS,
  type BlueprintDraft,
  type DeterministicCheck,
  type EvaluationPlan,
  type JobSpec,
  type Kpi,
  type RubricCriterion,
} from "@/server/domain";
import { clipText, toSnakeCase } from "./cues";

/**
 * KPIs and the evaluation plan are derived from the approved JobSpec alone, so two workers hired for the same
 * job are always measured the same way (which is what makes "Replace" comparable). PURE.
 */

const DEFAULT_MAX_COST_PER_RUN_USD = 1;

export function requiredFieldNames(spec: JobSpec): string[] {
  return spec.deliverable.fields.filter((f) => f.required).map((f) => f.name);
}

/** Key fields limited to real spec fields; the first required field when the draft names none that exist. */
export function usableKeyFields(spec: JobSpec, keyFields: readonly string[]): string[] {
  const names = new Set(spec.deliverable.fields.map((f) => f.name));
  const kept = [...new Set(keyFields.map((k) => k.trim()).filter((k) => names.has(k)))];
  if (kept.length > 0) return kept;
  const required = requiredFieldNames(spec);
  return required.length > 0 ? [required[0]] : [];
}

export function deriveKpis(spec: JobSpec): Kpi[] {
  const kpis: Kpi[] = [
    {
      id: "acceptance_rate",
      name: "Acceptance rate",
      description: "Share of reviewed deliverables you accept without sending them back.",
      metric: "acceptance_rate",
      target: 0.85,
      unit: "%",
      direction: "higher_is_better",
    },
    {
      id: "quality_score",
      name: "Quality score",
      description: "Average score from the quality review against the job's rubric.",
      metric: "quality_score",
      target: 0.8,
      unit: "%",
      direction: "higher_is_better",
    },
  ];
  if (spec.deliverable.targetCount) {
    kpis.push({
      id: "records_per_run",
      name: "Records per run",
      description: `Items delivered each run (the job asks for about ${spec.deliverable.targetCount}).`,
      metric: "records_per_run",
      target: spec.deliverable.targetCount,
      unit: "records",
      direction: "higher_is_better",
    });
  }
  kpis.push(
    {
      id: "cost_per_run",
      name: "Cost per run",
      description: "Model and tool spend per run.",
      metric: "cost_per_run_usd",
      target: spec.budget.maxCostPerRunUsd ?? DEFAULT_MAX_COST_PER_RUN_USD,
      unit: "$",
      direction: "lower_is_better",
    },
    {
      id: "success_rate",
      name: "Run success rate",
      description: "Runs that finish with a deliverable, out of all finished runs.",
      metric: "success_rate",
      target: 0.9,
      unit: "%",
      direction: "higher_is_better",
    },
  );
  return kpis;
}

function uniqueId(base: string, taken: Set<string>): string {
  const root = toSnakeCase(base) || "criterion";
  let id = root;
  for (let n = 2; taken.has(id); n++) id = `${root}_${n}`;
  taken.add(id);
  return id;
}

function rubricFromSpec(spec: JobSpec): RubricCriterion[] {
  const taken = new Set<string>();
  const rubric: RubricCriterion[] = spec.successCriteria.map((c) => {
    const label = c.metric?.trim() || clipText(c.description, 60);
    const target = c.target ? ` Target: ${c.target}.` : "";
    return {
      id: uniqueId(c.id, taken),
      criterion: label,
      description: `${c.description.trim().replace(/\.?$/, ".")}${target}`,
      weight: 1,
    };
  });
  rubric.push(
    {
      id: uniqueId("accuracy_sourcing", taken),
      criterion: "Accuracy & sourcing",
      description: "Facts are correct, specific and traceable to a source; nothing is invented or padded.",
      weight: 2,
    },
    {
      id: uniqueId("usefulness", taken),
      criterion: "Usefulness",
      description: `Someone could act on this ${spec.deliverable.title} as delivered, without re-doing the work.`,
      weight: 1,
    },
  );
  return rubric;
}

export function deriveEvaluationPlan(spec: JobSpec, draft: Pick<BlueprintDraft, "keyFields">): EvaluationPlan {
  const checks: DeterministicCheck[] = [];
  const required = requiredFieldNames(spec);
  const keyFields = usableKeyFields(spec, draft.keyFields);
  const hasFields = spec.deliverable.fields.length > 0;
  const target = spec.deliverable.targetCount;

  if (target) {
    const min = Math.max(1, Math.round(target * 0.8));
    checks.push({
      id: "min_records",
      type: "min_records",
      description: `At least ${min} records per run (80% of the ${target} asked for)`,
      config: { min },
      weight: 2,
    });
  }
  if (hasFields && required.length > 0) {
    checks.push({
      id: "required_fields",
      type: "required_fields",
      description: `Required fields are filled (${required.join(", ")})`,
      config: { fields: required, minCompleteness: 0.9 },
      weight: 2,
    });
  }
  if (hasFields && keyFields.length > 0) {
    checks.push({
      id: "no_duplicates",
      type: "no_duplicates",
      description: `No repeated ${keyFields.join(" + ")}`,
      config: { keyFields },
      weight: 1,
    });
  }
  if (spec.deliverable.format === "markdown" && spec.deliverable.sections.length > 0) {
    checks.push({
      id: "contains_sections",
      type: "contains_sections",
      description: `Report has the expected sections (${spec.deliverable.sections.join(", ")})`,
      config: { sections: spec.deliverable.sections },
      weight: 1,
    });
  }
  const maxCost = spec.budget.maxCostPerRunUsd ?? DEFAULT_RUN_LIMITS.maxCostPerRunUsd;
  checks.push({
    id: "max_cost_usd",
    type: "max_cost_usd",
    description: `Run cost stays under $${maxCost}`,
    config: { max: maxCost },
    weight: 1,
  });

  return {
    deterministicChecks: checks,
    rubric: rubricFromSpec(spec),
    weights: { ...DEFAULT_EVALUATION_WEIGHTS },
    passThreshold: DEFAULT_PASS_THRESHOLD,
  };
}
