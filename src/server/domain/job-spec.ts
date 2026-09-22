import { z } from "zod";
import { JobFamilySchema } from "./job-family";

/**
 * JobSpec — the structured, human-approved definition of a job. Produced by Job Scoping from the
 * customer's plain-English description (+ follow-up answers), stored in JobSpec.spec (JSON).
 *
 * NOTE for LLM structured output: keep this schema free of transforms/defaults-with-side-effects so
 * it can be passed to generateObject directly. Optional fields use `.optional()` (never `.nullable()`).
 */

export const SPEC_SCHEMA_VERSION = 1 as const;

export const CadenceSchema = z.object({
  kind: z.enum(["manual", "hourly", "daily", "weekly"]),
  /** 0-23, for daily/weekly. */
  hour: z.number().int().min(0).max(23).optional(),
  /** 0=Sunday..6=Saturday, for weekly. */
  dayOfWeek: z.number().int().min(0).max(6).optional(),
});
export type Cadence = z.infer<typeof CadenceSchema>;

export const DeliverableFormatSchema = z.enum(["markdown", "csv", "json"]);
export type DeliverableFormatSlug = z.infer<typeof DeliverableFormatSchema>;

export const SpecFieldSchema = z.object({
  name: z.string().min(1).describe("snake_case field/column name"),
  description: z.string().min(1),
  required: z.boolean(),
});
export type SpecField = z.infer<typeof SpecFieldSchema>;

export const SpecDeliverableSchema = z.object({
  title: z.string().min(1).describe("Short name of the recurring deliverable, e.g. 'Weekly AI Infra Funding Report'"),
  description: z.string().min(1),
  format: DeliverableFormatSchema,
  /** For csv/json deliverables (and any record-based research): the fields each record should have. */
  fields: z.array(SpecFieldSchema).max(20),
  /** For markdown deliverables: the section headings expected in the report. */
  sections: z.array(z.string().min(1)).max(12),
  /** Expected number of records/items per run, if applicable. */
  targetCount: z.number().int().positive().optional(),
});
export type SpecDeliverable = z.infer<typeof SpecDeliverableSchema>;

export const SpecInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  source: z.enum(["web", "provided_data", "user_instruction", "previous_runs"]),
  required: z.boolean(),
});
export type SpecInput = z.infer<typeof SpecInputSchema>;

export const SuccessCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** How it's measured, human readable: "Acceptance rate", "Records per run". */
  metric: z.string().optional(),
  /** Human readable target: ">= 90%", "at least 15". */
  target: z.string().optional(),
});
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;

export const JobSpecSchema = z.object({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  title: z.string().min(3).max(120),
  jobFamily: JobFamilySchema,
  /** One or two sentences a manager would use to describe the role. */
  summary: z.string().min(10),
  objective: z.string().min(10),
  responsibilities: z.array(z.string().min(3)).min(1).max(8),
  inputs: z.array(SpecInputSchema).max(8),
  deliverable: SpecDeliverableSchema,
  cadence: CadenceSchema,
  successCriteria: z.array(SuccessCriterionSchema).min(1).max(8),
  constraints: z.array(z.string()).max(10),
  outOfScope: z.array(z.string()).max(10),
  /** Tool names from the Tool Registry the scoper expects the worker to need. */
  toolsLikelyNeeded: z.array(z.string()).max(12),
  approvalPolicy: z.object({
    /** Plain-English descriptions of actions that need a human OK, e.g. "Sending anything externally". */
    requireApprovalFor: z.array(z.string()).max(8),
    notes: z.string().optional(),
  }),
  budget: z.object({
    maxCostPerRunUsd: z.number().positive().optional(),
    maxMonthlyUsd: z.number().positive().optional(),
  }),
  assumptions: z.array(z.string()).max(10),
});
export type JobSpec = z.infer<typeof JobSpecSchema>;

// ── Intake / follow-up questions ────────────────────────────────────────────

export const FollowUpQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  /** Why we're asking — shown as helper text. */
  why: z.string().optional(),
  placeholder: z.string().optional(),
  /** Quick-pick answers the user can click. */
  suggestions: z.array(z.string()).max(5),
});
export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;

export const MAX_FOLLOW_UP_QUESTIONS = 3;

export const ScopingQuestionsSchema = z.object({
  draftTitle: z.string().min(3).max(120),
  jobFamily: JobFamilySchema,
  /** Minimal set: only ask what materially changes the spec. May be empty. */
  questions: z.array(FollowUpQuestionSchema).max(MAX_FOLLOW_UP_QUESTIONS),
});
export type ScopingQuestions = z.infer<typeof ScopingQuestionsSchema>;

/** Stored on Job.intake. */
export const IntakeAnswersSchema = z.object({
  questions: z.array(FollowUpQuestionSchema),
  /** questionId → answer text ("" / missing = skipped). */
  answers: z.record(z.string(), z.string()),
});
export type IntakeAnswers = z.infer<typeof IntakeAnswersSchema>;

/** What the LLM is asked to produce: everything except schemaVersion (added in code before JobSpecSchema.parse). */
export const JobSpecLlmSchema = JobSpecSchema.omit({ schemaVersion: true });
export type JobSpecLlm = z.infer<typeof JobSpecLlmSchema>;

/**
 * The single renderer of the `job_brief` context value that every agent component receives.
 * (Simulation never parses this string — it is handed the structured JobSpec alongside it.)
 */
export function renderJobBrief(spec: JobSpec): string {
  const lines: string[] = [];
  lines.push(`# Job: ${spec.title}`, "", `Objective: ${spec.objective}`, "", "Responsibilities:");
  for (const r of spec.responsibilities) lines.push(`- ${r}`);
  lines.push("", `Deliverable: ${spec.deliverable.title} (${spec.deliverable.format})`, spec.deliverable.description);
  if (spec.deliverable.targetCount) lines.push(`Target: about ${spec.deliverable.targetCount} records per run.`);
  if (spec.deliverable.fields.length > 0) {
    lines.push("", "Each record must have these fields:");
    for (const f of spec.deliverable.fields) {
      lines.push(`- ${f.name}${f.required ? " (required)" : ""}: ${f.description}`);
    }
  }
  if (spec.deliverable.sections.length > 0) {
    lines.push("", `Report sections: ${spec.deliverable.sections.join(" · ")}`);
  }
  if (spec.successCriteria.length > 0) {
    lines.push("", "Success criteria:");
    for (const c of spec.successCriteria) lines.push(`- ${c.description}${c.target ? ` (target: ${c.target})` : ""}`);
  }
  if (spec.constraints.length > 0) {
    lines.push("", "Constraints:");
    for (const c of spec.constraints) lines.push(`- ${c}`);
  }
  if (spec.outOfScope.length > 0) {
    lines.push("", "Out of scope:");
    for (const c of spec.outOfScope) lines.push(`- ${c}`);
  }
  return lines.join("\n");
}

export function parseJobSpec(value: unknown): JobSpec {
  return JobSpecSchema.parse(value);
}
