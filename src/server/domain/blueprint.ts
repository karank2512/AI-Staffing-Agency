import { z } from "zod";
import { JobFamilySchema } from "./job-family";
import { CadenceSchema, DeliverableFormatSchema } from "./job-spec";

/**
 * WorkerBlueprint — the immutable design of an AI worker, stored in WorkerVersion.blueprint.
 *
 * A blueprint is an ordered pipeline of COMPONENTS that read/write a shared run context
 * (Record<string, unknown>) by key:
 *   - "agent" components run an LLM tool-calling loop (non-deterministic, costs tokens)
 *   - "deterministic" components run plain code (free, reliable) — CSV, dedupe, validation, ranking…
 * The Staffing Engine's job is to push as much work as possible into deterministic components:
 * that is how workers get cheaper over time.
 *
 * Pipeline conventions (relied on by staffing, runtime, workers/replace and simulation):
 *   - A json-output agent that feeds record operations emits a TOP-LEVEL ARRAY of flat records.
 *   - Record transforms (validate_records, dedupe, filter, rank) are IN-PLACE: outputKey === inputKeys[0].
 *   - Deterministic components receive the FULL run context; inputKeys[0] is the primary input.
 *   - Standard context keys: `records` (collector output), `stats`, `insights`, `report`, `csv`,
 *     `notification_status`.
 */

export const BLUEPRINT_SCHEMA_VERSION = 1 as const;

export const ModelTierSchema = z.enum(["fast", "standard", "reasoning"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

const ComponentIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, "component ids are snake_case");
const ContextKeySchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, "context keys are snake_case");

// ── Agent component ─────────────────────────────────────────────────────────

export const AgentComponentSchema = z.object({
  type: z.literal("agent"),
  id: ComponentIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  /** What this agent must accomplish in one run, in plain English. */
  goal: z.string().min(1),
  /** System prompt. */
  instructions: z.string().min(1),
  modelTier: ModelTierSchema,
  /** Tool names this agent may call. Must be a subset of blueprint.tools[].toolName. */
  tools: z.array(z.string()),
  maxTurns: z.number().int().min(1).max(20),
  /** Context keys whose values are given to the agent as input. */
  inputKeys: z.array(ContextKeySchema),
  /** Context key the agent's final answer is written to. */
  outputKey: ContextKeySchema,
  /** "json" → final answer must be JSON (records array or object); "markdown" → prose. */
  outputFormat: z.enum(["markdown", "json"]),
  /** For json output: description of the expected shape, e.g. "array of {company, stage, amount_usd}". */
  outputSchemaHint: z.string().optional(),
});
export type AgentComponent = z.infer<typeof AgentComponentSchema>;

// ── Deterministic components ────────────────────────────────────────────────

const deterministicBase = {
  type: z.literal("deterministic"),
  id: ComponentIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  inputKeys: z.array(ContextKeySchema).min(1),
  outputKey: ContextKeySchema,
};

/** Remove duplicate records (case/whitespace-insensitive on keyFields). Input: records[]. Output: records[]. */
export const DedupeComponentSchema = z.object({
  ...deterministicBase,
  operation: z.literal("dedupe"),
  config: z.object({ keyFields: z.array(z.string()).min(1) }),
});

/** Check required fields are present/non-empty. Input: records[]. Output: records[] (invalid dropped if dropInvalid). */
export const ValidateRecordsComponentSchema = z.object({
  ...deterministicBase,
  operation: z.literal("validate_records"),
  config: z.object({ requiredFields: z.array(z.string()).min(1), dropInvalid: z.boolean() }),
});

/** Sort records by a field and optionally keep the top N; adds a 1-based `rank` field. */
export const RankComponentSchema = z.object({
  ...deterministicBase,
  operation: z.literal("rank"),
  config: z.object({
    by: z.string(),
    direction: z.enum(["asc", "desc"]),
    limit: z.number().int().positive().optional(),
  }),
});

/** Keep records matching a condition. `value` is required for every op except "exists" (enforced in WorkerBlueprintSchema). */
export const FilterComponentSchema = z.object({
  ...deterministicBase,
  operation: z.literal("filter"),
  config: z.object({
    field: z.string(),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }),
});

/** Aggregate records: counts by group + numeric summaries. Output: { total, groups: [{key,count,share}], numeric: {...} }. */
export const ComputeStatsComponentSchema = z.object({
  ...deterministicBase,
  operation: z.literal("compute_stats"),
  config: z.object({
    groupBy: z.string().optional(),
    numericFields: z.array(z.string()),
  }),
});

/** Serialize records to CSV text. Input: records[]. Output: string. */
export const ToCsvComponentSchema = z.object({
  ...deterministicBase,
  operation: z.literal("to_csv"),
  config: z.object({ columns: z.array(z.string()).optional() }),
});

export const ReportSectionSchema = z.object({
  heading: z.string().min(1),
  /** Context key to render. */
  sourceKey: ContextKeySchema,
  /** markdown: insert string as-is · table: records[] → md table · bullets: string[]/records[] → list · stats: compute_stats output. */
  as: z.enum(["markdown", "table", "bullets", "stats"]),
  columns: z.array(z.string()).optional(),
  maxRows: z.number().int().positive().optional(),
});
export type ReportSection = z.infer<typeof ReportSectionSchema>;

/** Assemble a markdown report from context values. Output: string (markdown). */
export const CompileReportComponentSchema = z.object({
  ...deterministicBase,
  operation: z.literal("compile_report"),
  config: z.object({
    title: z.string().min(1),
    sections: z.array(ReportSectionSchema).min(1),
    includeMethodology: z.boolean(),
  }),
});

export const DeterministicComponentSchema = z.discriminatedUnion("operation", [
  DedupeComponentSchema,
  ValidateRecordsComponentSchema,
  RankComponentSchema,
  FilterComponentSchema,
  ComputeStatsComponentSchema,
  ToCsvComponentSchema,
  CompileReportComponentSchema,
]);
export type DeterministicComponent = z.infer<typeof DeterministicComponentSchema>;
export type DeterministicOperation = DeterministicComponent["operation"];
export const DETERMINISTIC_OPERATIONS = [
  "dedupe",
  "validate_records",
  "rank",
  "filter",
  "compute_stats",
  "to_csv",
  "compile_report",
] as const satisfies readonly DeterministicOperation[];

export const ComponentSchema = z.discriminatedUnion("type", [AgentComponentSchema, DeterministicComponentSchema]);
export type BlueprintComponent = z.infer<typeof ComponentSchema>;

// ── Tools, KPIs, evaluation, cost ───────────────────────────────────────────

export const ToolRequirementSchema = z.object({
  toolName: z.string().min(1),
  /** Why the worker needs it — shown on the proposal card and Permissions tab. */
  reason: z.string().min(1),
  requiresApproval: z.boolean(),
});
export type ToolRequirement = z.infer<typeof ToolRequirementSchema>;

/** Metrics the platform can compute from run data. KPIs must use one of these so targets are checkable. */
export const KPI_METRICS = [
  "success_rate", // succeeded runs / finished runs (0..1)
  "acceptance_rate", // accepted deliverables / reviewed deliverables (0..1)
  "quality_score", // avg LLM-judge score (0..1)
  "records_per_run", // avg deliverable record count
  "cost_per_run_usd",
  "duration_sec",
] as const;
export const KpiMetricSchema = z.enum(KPI_METRICS);
export type KpiMetric = z.infer<typeof KpiMetricSchema>;

export const KpiSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  metric: KpiMetricSchema,
  target: z.number(),
  /** Display unit: "%", "records", "$", "sec". Rates are stored 0..1 and displayed ×100. */
  unit: z.string(),
  direction: z.enum(["higher_is_better", "lower_is_better"]),
});
export type Kpi = z.infer<typeof KpiSchema>;

export const DETERMINISTIC_CHECK_TYPES = [
  "min_records", // config: { min: number }
  "required_fields", // config: { fields: string[], minCompleteness: number (0..1) }
  "no_duplicates", // config: { keyFields: string[] }
  "min_length", // config: { minChars: number }
  "contains_sections", // config: { sections: string[] }
  "max_cost_usd", // config: { max: number }
  "max_duration_sec", // config: { max: number }
] as const;
export const DeterministicCheckTypeSchema = z.enum(DETERMINISTIC_CHECK_TYPES);
export type DeterministicCheckType = z.infer<typeof DeterministicCheckTypeSchema>;

/** One definition of each check's config, shared by staffing (writes), seed (writes) and evaluation (reads). */
export const DETERMINISTIC_CHECK_CONFIG_SCHEMAS = {
  min_records: z.object({ min: z.number().int().min(1) }),
  required_fields: z.object({ fields: z.array(z.string()).min(1), minCompleteness: z.number().min(0).max(1) }),
  no_duplicates: z.object({ keyFields: z.array(z.string()).min(1) }),
  min_length: z.object({ minChars: z.number().int().min(1) }),
  contains_sections: z.object({ sections: z.array(z.string()).min(1) }),
  max_cost_usd: z.object({ max: z.number().positive() }),
  max_duration_sec: z.object({ max: z.number().positive() }),
} as const satisfies Record<DeterministicCheckType, z.ZodType>;

export const DeterministicCheckSchema = z.object({
  id: z.string().min(1),
  type: DeterministicCheckTypeSchema,
  description: z.string().min(1),
  /** Shape depends on `type` — see DETERMINISTIC_CHECK_TYPES comments. Validated by the evaluator. */
  config: z.record(z.string(), z.unknown()),
  weight: z.number().positive(),
});
export type DeterministicCheck = z.infer<typeof DeterministicCheckSchema>;

export const RubricCriterionSchema = z.object({
  id: z.string().min(1),
  criterion: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().positive(),
});
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const EvaluationPlanSchema = z.object({
  deterministicChecks: z.array(DeterministicCheckSchema),
  rubric: z.array(RubricCriterionSchema).min(1),
  /** Relative weights of the three evaluation sources in the worker score. Re-normalized over sources that have data. */
  weights: z
    .object({
      deterministic: z.number().min(0),
      judge: z.number().min(0),
      user: z.number().min(0),
    })
    .refine((w) => w.deterministic + w.judge + w.user > 0, "at least one evaluation weight must be > 0"),
  /** 0..1 — a run's evaluation "passes" at or above this. */
  passThreshold: z.number().min(0).max(1),
});
export type EvaluationPlan = z.infer<typeof EvaluationPlanSchema>;

export const DEFAULT_EVALUATION_WEIGHTS = { deterministic: 0.3, judge: 0.4, user: 0.3 } as const;
export const DEFAULT_PASS_THRESHOLD = 0.7;

export const BlueprintDeliverableSchema = z.object({
  /** Supports {{date}} and {{job_title}} placeholders. */
  titleTemplate: z.string().min(1),
  format: DeliverableFormatSchema,
  /** Context key holding the final content (markdown string / CSV string / JSON-serializable value). */
  contentKey: ContextKeySchema,
  /** Context key holding the records[] behind the deliverable (enables tables + deterministic evaluation). */
  dataKey: ContextKeySchema.optional(),
});
export type BlueprintDeliverable = z.infer<typeof BlueprintDeliverableSchema>;

export const CostBreakdownItemSchema = z.object({
  componentId: z.string(),
  label: z.string(),
  modelTier: ModelTierSchema.optional(),
  estModelCalls: z.number().min(0),
  estInputTokens: z.number().min(0),
  estOutputTokens: z.number().min(0),
  estToolCalls: z.number().min(0),
  costUsd: z.number().min(0),
});
export type CostBreakdownItem = z.infer<typeof CostBreakdownItemSchema>;

export const CostEstimateSchema = z.object({
  perRunUsd: z.number().min(0),
  runsPerMonth: z.number().min(0),
  monthlyUsd: z.number().min(0),
  breakdown: z.array(CostBreakdownItemSchema),
  assumptions: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

export const RunLimitsSchema = z.object({
  maxCostPerRunUsd: z.number().positive(),
  maxToolCallsPerRun: z.number().int().positive(),
  maxRunDurationSec: z.number().int().positive(),
});
export type RunLimits = z.infer<typeof RunLimitsSchema>;

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxCostPerRunUsd: 2,
  maxToolCallsPerRun: 40,
  maxRunDurationSec: 900,
};

export const AVATAR_COLORS = ["violet", "sky", "emerald", "amber", "rose", "indigo", "teal", "orange"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export const PersonaSchema = z.object({
  name: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  /** Contractor-style bio shown on the proposal card + profile. */
  summary: z.string().min(1),
  avatarColor: z.enum(AVATAR_COLORS),
});
export type Persona = z.infer<typeof PersonaSchema>;

// ── The blueprint ───────────────────────────────────────────────────────────

const BlueprintObjectSchema = z.object({
  schemaVersion: z.literal(BLUEPRINT_SCHEMA_VERSION),
  jobFamily: JobFamilySchema,
  persona: PersonaSchema,
  responsibilities: z.array(z.string().min(1)).min(1).max(8),
  components: z.array(ComponentSchema).min(1).max(12),
  tools: z.array(ToolRequirementSchema),
  kpis: z.array(KpiSchema).min(1).max(8),
  evaluation: EvaluationPlanSchema,
  deliverable: BlueprintDeliverableSchema,
  schedule: CadenceSchema,
  limits: RunLimitsSchema,
  costEstimate: CostEstimateSchema,
});

/** Structural + referential validation. Anything that parses here is safe for the executor to run. */
export const WorkerBlueprintSchema = BlueprintObjectSchema.superRefine((bp, ctx) => {
  const ids = new Set<string>();
  const produced = new Set<string>(["job_brief", "instructions"]); // keys seeded by the executor
  const grantedTools = new Set(bp.tools.map((t) => t.toolName));

  bp.components.forEach((c, i) => {
    if (ids.has(c.id)) {
      ctx.addIssue({ code: "custom", path: ["components", i, "id"], message: `duplicate component id "${c.id}"` });
    }
    ids.add(c.id);
    for (const key of c.inputKeys) {
      if (!produced.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["components", i, "inputKeys"],
          message: `input key "${key}" is not produced by an earlier component`,
        });
      }
    }
    if (c.type === "agent") {
      for (const tool of c.tools) {
        if (!grantedTools.has(tool)) {
          ctx.addIssue({
            code: "custom",
            path: ["components", i, "tools"],
            message: `agent uses tool "${tool}" which is not listed in blueprint.tools`,
          });
        }
      }
    }
    if (c.type === "deterministic" && c.operation === "filter" && c.config.op !== "exists" && c.config.value === undefined) {
      ctx.addIssue({ code: "custom", path: ["components", i, "config", "value"], message: `filter op "${c.config.op}" needs a value` });
    }
    if (c.type === "deterministic" && c.operation === "compile_report") {
      for (const s of c.config.sections) {
        if (!produced.has(s.sourceKey)) {
          ctx.addIssue({
            code: "custom",
            path: ["components", i, "config", "sections"],
            message: `report section source "${s.sourceKey}" is not produced by an earlier component`,
          });
        }
      }
    }
    produced.add(c.outputKey);
  });

  bp.evaluation.deterministicChecks.forEach((check, i) => {
    const parsed = DETERMINISTIC_CHECK_CONFIG_SCHEMAS[check.type].safeParse(check.config);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        path: ["evaluation", "deterministicChecks", i, "config"],
        message: `invalid config for check "${check.type}": ${parsed.error.issues.map((x) => x.message).join("; ")}`,
      });
    }
  });

  if (!produced.has(bp.deliverable.contentKey)) {
    ctx.addIssue({
      code: "custom",
      path: ["deliverable", "contentKey"],
      message: `deliverable content key "${bp.deliverable.contentKey}" is never produced`,
    });
  }
  if (bp.deliverable.dataKey && !produced.has(bp.deliverable.dataKey)) {
    ctx.addIssue({
      code: "custom",
      path: ["deliverable", "dataKey"],
      message: `deliverable data key "${bp.deliverable.dataKey}" is never produced`,
    });
  }
});
export type WorkerBlueprint = z.infer<typeof BlueprintObjectSchema>;

/** Context keys the executor seeds before the first component runs. */
export const SEEDED_CONTEXT_KEYS = ["job_brief", "instructions"] as const;

export function parseBlueprint(value: unknown): WorkerBlueprint {
  return WorkerBlueprintSchema.parse(value);
}

export function safeParseBlueprint(value: unknown) {
  return WorkerBlueprintSchema.safeParse(value);
}

/** Stored on Job.pendingProposal between "generate proposal" and "Hire". */
export const WorkerProposalSchema = z.object({
  jobSpecId: z.string(),
  blueprint: WorkerBlueprintSchema,
  /** Why the Staffing Engine designed the worker this way (shown on the proposal card). */
  rationale: z.array(z.string()),
  simulated: z.boolean(),
  generatedAt: z.string(),
});
export type WorkerProposal = z.infer<typeof WorkerProposalSchema>;
