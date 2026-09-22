import { z } from "zod";
import { CadenceSchema, type JobSpec, type Kpi, type ModelTier } from "@/server/domain";
import { formatNumber, formatUsd } from "@/lib/format";

/**
 * Pure, client-safe constants and schemas for the hire flow. Actions validate their inputs with the schemas
 * here; client leaves import the constants and helpers (never anything from `@/server/*` except domain).
 */

// ── Steps ───────────────────────────────────────────────────────────────────

export const HIRE_STEPS = [
  { key: "describe", label: "Describe", hint: "Tell us about the job" },
  { key: "clarify", label: "Clarify", hint: "A few quick questions" },
  { key: "spec", label: "Job spec", hint: "Review and approve" },
  { key: "proposal", label: "Meet your worker", hint: "Your proposed hire" },
  { key: "hired", label: "Hired", hint: "First run starts" },
] as const;
export type HireStepKey = (typeof HIRE_STEPS)[number]["key"];

/** Maps the server-derived `HireFlowState.step` onto the stepper. A missing jobId is the Describe step. */
export function stepKeyFor(serverStep: "questions" | "spec" | "proposal" | null): HireStepKey {
  if (serverStep === null) return "describe";
  if (serverStep === "questions") return "clarify";
  return serverStep;
}

// ── Describe step ───────────────────────────────────────────────────────────

export const DESCRIPTION_MIN_CHARS = 10;
export const DESCRIPTION_MAX_CHARS = 5_000;

export const DESCRIPTION_PLACEHOLDER =
  "Describe the job like you would to a new contractor. What should they produce, how often, and who is it for?\n\nFor example: “Every Monday, find AI infrastructure startups that announced funding in the last week, capture the round details with a source, and send the report to our research team.”";

export interface ExampleJob {
  id: string;
  label: string;
  description: string;
}

/**
 * Three example jobs that land on distinct families and exercise different deliverable formats. Each opens with a
 * short sentence because the scoper takes the job's working title from it (≤ 80 chars before it clips).
 */
export const EXAMPLE_JOBS: readonly ExampleJob[] = [
  {
    id: "funding-tracker",
    label: "Funding tracker",
    description:
      "Track newly funded AI infrastructure startups every week. For each round capture the company, stage, amount, lead investor and a source link, rank the biggest rounds and write a short market research report on what changed.",
  },
  {
    id: "feedback-digest",
    label: "Weekly feedback analysis",
    description:
      "Weekly customer feedback analysis with a Monday email to the product team. Every week, categorize all the customer feedback and NPS survey responses we received by theme and sentiment, tell us what to fix first, and email the summary to the product team on Monday morning.",
  },
  {
    id: "fintech-leads",
    label: "Series A fintech lead list",
    description:
      "Build a weekly lead list of Series A fintech companies as a CSV. Each week, find 25 accounts with a likely decision-maker, why they fit our ICP, and a source for each, delivered as a CSV we can import into our CRM.",
  },
];

export const ScopeJobInputSchema = z
  .string()
  .transform((v) => v.replace(/\r\n/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(DESCRIPTION_MIN_CHARS, "Describe the job in a sentence or two so it can be scoped.")
      .max(DESCRIPTION_MAX_CHARS, `Keep the description under ${DESCRIPTION_MAX_CHARS.toLocaleString("en-US")} characters.`),
  );

// ── Clarify step ────────────────────────────────────────────────────────────

export const MAX_ANSWER_CHARS = 1_000;

/** questionId → answer; blank answers are kept (the server drops them) so "skip" is just an empty string. */
export const AnswersSchema = z.record(z.string().min(1).max(64), z.string().max(MAX_ANSWER_CHARS, "Keep each answer under 1,000 characters."));
export type Answers = z.infer<typeof AnswersSchema>;

// ── Job spec step ───────────────────────────────────────────────────────────

/** The light inline edits the review form allows. Everything else in the spec stays as scoped. */
export const SpecPatchSchema = z.object({
  title: z.string().trim().min(3, "Give the job a title of at least 3 characters.").max(120, "Keep the title under 120 characters.").optional(),
  summary: z.string().trim().min(10, "The summary needs at least 10 characters.").optional(),
  objective: z.string().trim().min(10, "The objective needs at least 10 characters.").optional(),
  responsibilities: z
    .array(z.string().trim().min(3, "Each responsibility needs at least 3 characters."))
    .min(1, "List at least one responsibility.")
    .max(8, "Keep it to 8 responsibilities.")
    .optional(),
  /** `null` clears the target. */
  targetCount: z.number().int().positive("The target must be a positive whole number.").max(10_000).nullable().optional(),
  cadence: CadenceSchema.optional(),
});
export type SpecPatch = z.infer<typeof SpecPatchSchema>;

/**
 * Turns the form's flat patch into the nested JobSpec shape `updateJobSpec` merges key by key. Only keys the
 * customer touched are sent, so a partial edit never overwrites the rest of the scoped spec.
 */
export function toSpecPatch(patch: SpecPatch): Partial<JobSpec> {
  const out: Partial<JobSpec> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.summary !== undefined) out.summary = patch.summary;
  if (patch.objective !== undefined) out.objective = patch.objective;
  if (patch.responsibilities !== undefined) out.responsibilities = patch.responsibilities;
  if (patch.cadence !== undefined) out.cadence = patch.cadence;
  if (patch.targetCount !== undefined) {
    // Nested objects merge key by key server-side, so only the target changes; `undefined` clears it.
    out.deliverable = { targetCount: patch.targetCount ?? undefined } as JobSpec["deliverable"];
  }
  return out;
}

/** Splits a textarea into responsibilities: one per line, bullets and blank lines stripped. */
export function parseResponsibilityLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0);
}

export const CADENCE_KIND_LABELS: Record<z.infer<typeof CadenceSchema>["kind"], string> = {
  manual: "On demand",
  hourly: "Every hour",
  daily: "Daily",
  weekly: "Weekly",
};

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function hourLabel(hour: number): string {
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

// ── Proposal step ───────────────────────────────────────────────────────────

export const WORKER_NAME_MAX_CHARS = 40;

export const HireInputSchema = z.object({
  name: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(WORKER_NAME_MAX_CHARS, `Worker names are at most ${WORKER_NAME_MAX_CHARS} characters.`))
    .optional(),
});

export const MODEL_TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast model",
  standard: "Standard model",
  reasoning: "Reasoning model",
};

/** Deterministic operations, in words a manager would use. */
export const OPERATION_LABELS: Record<string, string> = {
  dedupe: "Remove duplicates",
  validate_records: "Check required fields",
  rank: "Rank results",
  filter: "Filter records",
  compute_stats: "Compute statistics",
  to_csv: "Export CSV",
  compile_report: "Assemble report",
};

export function operationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? operation.replace(/_/g, " ");
}

/** A KPI target in its display unit: rates are stored 0..1, money in USD, durations in seconds. */
export function formatKpiTarget(kpi: Pick<Kpi, "target" | "unit" | "direction">): string {
  const prefix = kpi.direction === "higher_is_better" ? "≥ " : "≤ ";
  switch (kpi.unit) {
    case "%":
      return `${prefix}${formatNumber(kpi.target * 100, 0)}%`;
    case "$":
      return `${prefix}${formatUsd(kpi.target)}`;
    case "sec":
      return `${prefix}${formatNumber(kpi.target, 0)} s`;
    default:
      return `${prefix}${formatNumber(kpi.target, 0)} ${kpi.unit}`.trim();
  }
}

export const CONFIDENCE_LABELS: Record<"low" | "medium" | "high", string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};
