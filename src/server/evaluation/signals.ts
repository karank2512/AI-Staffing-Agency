import type { z } from "zod";
import { DETERMINISTIC_CHECK_CONFIG_SCHEMAS, type DeterministicCheckType, type EvaluationPlan } from "@/server/domain/blueprint";
import type { JobSpec } from "@/server/domain/job-spec";
import { completenessStats, duplicateStats, type EvalRecord } from "./records";
import type { EvalSubject } from "./types";

/**
 * Measurable properties of a deliverable. PURE. The simulated judge turns these into rubric scores and cites
 * them in its reasoning, so its verdict tracks the actual content instead of being a constant.
 */
export interface DeliverableSignals {
  /** null = the deliverable carries no structured records. */
  recordCount: number | null;
  targetCount: number | null;
  requiredFields: string[];
  /** Records with every required field filled. */
  completeRecords: number | null;
  worstField: { field: string; missing: number } | null;
  duplicates: number | null;
  duplicateExamples: string[];
  expectedSections: string[];
  missingSections: string[];
  /** Characters of prose (tables, headings and rules stripped). null = the format has no narrative (csv/json). */
  narrativeChars: number | null;
  /** Figures quoted in the prose. */
  numbersMentioned: number;
  /** Distinct values from the records (company names, categories …) that the prose refers to. */
  entitiesMentioned: string[];
}

const MAX_ENTITY_POOL = 250;

type CheckConfig<T extends DeterministicCheckType> = z.infer<(typeof DETERMINISTIC_CHECK_CONFIG_SCHEMAS)[T]>;

/** Config of the plan's first check of a given type, or null when absent/invalid. */
function checkConfig<T extends DeterministicCheckType>(plan: EvaluationPlan, type: T): CheckConfig<T> | null {
  const check = plan.deterministicChecks.find((c) => c.type === type);
  if (!check) return null;
  const parsed = DETERMINISTIC_CHECK_CONFIG_SCHEMAS[type].safeParse(check.config);
  // The indexed schema lookup widens to the union of all configs; the type parameter pins it back down.
  return parsed.success ? (parsed.data as CheckConfig<T>) : null;
}

/** Prose only: markdown tables, headings, rules and code fences say nothing about the quality of the analysis. */
export function extractNarrative(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(\||#{1,6}\s|[-*_=]{3,}$|```)/.test(line))
    .join("\n");
}

function isEntityLike(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return v.length >= 3 && v.length <= 48 && !/^https?:\/\//i.test(v) && !/^[\d\s.,$%:/-]+$/.test(v);
}

function entityPool(records: readonly EvalRecord[]): string[] {
  const pool = new Map<string, string>();
  for (const record of records) {
    for (const value of Object.values(record)) {
      if (!isEntityLike(value)) continue;
      const key = value.trim().toLowerCase();
      if (!pool.has(key)) pool.set(key, value.trim());
      if (pool.size >= MAX_ENTITY_POOL) return [...pool.values()];
    }
  }
  return [...pool.values()];
}

export function measureDeliverable(spec: JobSpec, plan: EvaluationPlan, subject: EvalSubject): DeliverableSignals {
  const records = subject.records;

  const specRequired = spec.deliverable.fields.filter((f) => f.required).map((f) => f.name);
  const requiredFields = specRequired.length > 0 ? specRequired : (checkConfig(plan, "required_fields")?.fields ?? []);
  const keyFields = checkConfig(plan, "no_duplicates")?.keyFields ?? requiredFields.slice(0, 1);
  const targetCount = spec.deliverable.targetCount ?? checkConfig(plan, "min_records")?.min ?? null;

  // The plan's section list reflects what the pipeline actually assembles; the spec is the fallback.
  const expectedSections =
    subject.format === "markdown" ? (checkConfig(plan, "contains_sections")?.sections ?? spec.deliverable.sections) : [];
  const haystack = subject.content.toLowerCase().replace(/\s+/g, " ");
  const missingSections = expectedSections.filter((s) => !haystack.includes(s.toLowerCase().replace(/\s+/g, " ").trim()));

  const completeness = records && requiredFields.length > 0 ? completenessStats(records, requiredFields) : null;
  const dupes = records && keyFields.length > 0 ? duplicateStats(records, keyFields) : null;

  const narrative = subject.format === "markdown" ? extractNarrative(subject.content) : null;
  const narrativeLower = narrative?.toLowerCase() ?? "";
  const entitiesMentioned =
    narrative && records
      ? entityPool(records).filter((entity) => narrativeLower.includes(entity.toLowerCase()))
      : [];

  return {
    recordCount: records ? records.length : null,
    targetCount,
    requiredFields,
    completeRecords: completeness ? completeness.completeRecords : null,
    worstField: completeness?.missingByField[0] ?? null,
    duplicates: dupes ? dupes.duplicates : null,
    duplicateExamples: dupes?.examples ?? [],
    expectedSections,
    missingSections,
    narrativeChars: narrative === null ? null : narrative.length,
    numbersMentioned: narrative ? (narrative.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).length : 0,
    entitiesMentioned,
  };
}
