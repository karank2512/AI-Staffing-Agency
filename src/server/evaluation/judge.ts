import type { EvaluationPlan, RubricCriterion } from "@/server/domain/blueprint";
import { JudgeOutputSchema, type JudgeCriterionResult, type JudgeOutput } from "@/server/domain/evaluation";
import type { JobSpec } from "@/server/domain/job-spec";
import { llm } from "@/server/models";
import type { CallTracking } from "@/server/models/types";
import { mockJudgeOutput } from "./judge-mock";
import { measureDeliverable } from "./signals";
import type { EvalSubject } from "./types";

/** LLM-as-judge: scores one deliverable against the blueprint's rubric and the approved JobSpec. */

const MAX_CONTENT_CHARS = 12_000;
const MAX_SAMPLE_RECORDS = 20;
const NOT_ASSESSED = { score: 0.5, reasoning: "not assessed" } as const;

const JUDGE_SYSTEM = [
  "You are a demanding but fair quality reviewer at a staffing agency. A contractor (an AI worker) has handed in a deliverable for a client job.",
  "Score the deliverable against EACH rubric criterion from 0 to 1 (0 = unusable, 0.5 = needs significant rework, 0.7 = acceptable, 0.9+ = excellent).",
  "Judge only what is in front of you: reward specific, sourced, complete work; penalize missing fields, duplicates, vagueness, filler and anything that ignores the job's constraints.",
  "Return every rubric criterion id exactly once. Keep each reasoning to 1–3 sentences that cite concrete evidence from the deliverable.",
].join("\n");

export interface JudgeArgs {
  spec: JobSpec;
  plan: EvaluationPlan;
  subject: EvalSubject;
  deliverableTitle: string;
}

export interface JudgeVerdict {
  /** Weighted mean of the criterion scores, 0..1. */
  score: number;
  passed: boolean;
  criteria: JudgeCriterionResult[];
  overallReasoning: string;
  model: string;
  simulated: boolean;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} characters]`;
}

export function buildJudgePrompt({ spec, plan, subject, deliverableTitle }: JudgeArgs): string {
  const lines: string[] = [
    `# Job: ${spec.title}`,
    `Objective: ${spec.objective}`,
    "",
    "## Success criteria",
    ...spec.successCriteria.map((c) => `- ${c.description}${c.target ? ` (target: ${c.target})` : ""}`),
  ];
  if (spec.constraints.length > 0) lines.push("", "## Constraints", ...spec.constraints.map((c) => `- ${c}`));
  if (spec.deliverable.targetCount) lines.push("", `Expected volume: about ${spec.deliverable.targetCount} records per run.`);
  const required = spec.deliverable.fields.filter((f) => f.required).map((f) => f.name);
  if (required.length > 0) lines.push(`Required fields per record: ${required.join(", ")}.`);

  lines.push("", "## Rubric (score every criterion)");
  for (const c of plan.rubric) lines.push(`- id: ${c.id} | ${c.criterion} (weight ${c.weight}) — ${c.description}`);

  lines.push("", `## Deliverable: ${deliverableTitle} (${subject.format})`, truncate(subject.content, MAX_CONTENT_CHARS));

  if (subject.records && subject.records.length > 0) {
    const sample = subject.records.slice(0, MAX_SAMPLE_RECORDS);
    lines.push(
      "",
      `## Structured records (${sample.length} of ${subject.records.length} shown)`,
      truncate(JSON.stringify(sample, null, 1), MAX_CONTENT_CHARS),
    );
  }
  return lines.join("\n");
}

function toScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/**
 * Providers do not enforce ranges or id sets. Clamp scores to 0..1, drop criteria that are not in the rubric
 * (first occurrence wins) and fill anything the model skipped with a neutral "not assessed".
 */
export function normalizeJudgeOutput(rubric: readonly RubricCriterion[]): (raw: unknown) => unknown {
  return (raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const input = raw as { criteria?: unknown; overallReasoning?: unknown };
    const byId = new Map<string, { score: number; reasoning: string }>();
    for (const item of Array.isArray(input.criteria) ? input.criteria : []) {
      if (typeof item !== "object" || item === null) continue;
      const { id, score, reasoning } = item as { id?: unknown; score?: unknown; reasoning?: unknown };
      const clamped = toScore(score);
      if (typeof id !== "string" || byId.has(id) || clamped === null) continue;
      byId.set(id, { score: clamped, reasoning: typeof reasoning === "string" ? reasoning : "" });
    }
    return {
      criteria: rubric.map((c) => ({ id: c.id, ...(byId.get(c.id) ?? NOT_ASSESSED) })),
      overallReasoning: typeof input.overallReasoning === "string" ? input.overallReasoning : "",
    };
  };
}

export function toVerdictCriteria(rubric: readonly RubricCriterion[], output: JudgeOutput): JudgeCriterionResult[] {
  const byId = new Map(output.criteria.map((c) => [c.id, c]));
  return rubric.map((c) => {
    const scored = byId.get(c.id) ?? NOT_ASSESSED;
    return { id: c.id, criterion: c.criterion, score: scored.score, weight: c.weight, reasoning: scored.reasoning };
  });
}

export async function judgeDeliverable(args: JudgeArgs, tracking: CallTracking): Promise<JudgeVerdict> {
  const { spec, plan, subject } = args;
  const result = await llm.generateObject(
    {
      tier: "standard",
      system: JUDGE_SYSTEM,
      prompt: buildJudgePrompt(args),
      schema: JudgeOutputSchema,
      schemaName: "JudgeOutput",
      normalize: normalizeJudgeOutput(plan.rubric),
      mock: () => mockJudgeOutput(plan.rubric, measureDeliverable(spec, plan, subject), subject.content),
    },
    tracking,
  );

  const criteria = toVerdictCriteria(plan.rubric, result.object);
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const score = totalWeight > 0 ? criteria.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight : 0;
  return {
    score,
    passed: score >= plan.passThreshold,
    criteria,
    overallReasoning: result.object.overallReasoning,
    model: result.model,
    simulated: result.simulated,
  };
}
