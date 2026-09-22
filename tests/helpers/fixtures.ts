import { db, toJson } from "@/server/db";
import {
  DEFAULT_EVALUATION_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
  DEFAULT_RUN_LIMITS,
  WorkerBlueprintSchema,
  type BlueprintComponent,
  type WorkerBlueprint,
} from "@/server/domain/blueprint";
import { JobSpecSchema, type JobSpec } from "@/server/domain/job-spec";
import { cadenceToWorkerFields } from "@/server/domain/schedule";

/**
 * Canonical, schema-valid fixtures shared by every suite. They depend only on `db` + `domain`
 * (never on staffing/runtime) so module tests stay independent of each other.
 */

export function makeJobSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return JobSpecSchema.parse({
    schemaVersion: 1,
    title: "AI Infrastructure Funding Tracker",
    jobFamily: "market_research",
    summary: "Tracks newly funded AI infrastructure startups and summarizes what matters each week.",
    objective: "Find recently funded AI infrastructure startups and produce a ranked weekly market report.",
    responsibilities: [
      "Search for funding announcements from the last 30 days",
      "Capture company, stage, amount, investors and category for each round",
      "Rank rounds by amount and summarize the key trends",
    ],
    inputs: [{ name: "Public web", description: "News and company sites", source: "web", required: true }],
    deliverable: {
      title: "Weekly AI Infra Funding Report",
      description: "Ranked list of funded startups with a short trends summary.",
      format: "markdown",
      fields: [
        { name: "company", description: "Company name", required: true },
        { name: "stage", description: "Funding stage", required: true },
        { name: "amount_usd", description: "Round size in USD", required: true },
        { name: "lead_investor", description: "Lead investor", required: false },
        { name: "category", description: "Sub-category of AI infrastructure", required: false },
        { name: "source_url", description: "Where the round was reported", required: true },
      ],
      sections: ["Summary", "Top rounds", "Trends"],
      targetCount: 10,
    },
    cadence: { kind: "weekly", hour: 9, dayOfWeek: 1 },
    successCriteria: [
      { id: "coverage", description: "At least 10 relevant funded startups per report", metric: "Records per run", target: ">= 10" },
      { id: "accuracy", description: "Every round cites a source", metric: "Field completeness", target: "100%" },
    ],
    constraints: ["Only rounds announced in the last 30 days"],
    outOfScope: ["Contacting companies"],
    toolsLikelyNeeded: ["web_search", "fetch_url", "extract_data"],
    approvalPolicy: { requireApprovalFor: [] },
    budget: { maxCostPerRunUsd: 1 },
    assumptions: ["English-language sources are sufficient"],
    ...overrides,
  });
}

export interface MakeBlueprintOptions {
  /** Append an approval-gated `notifier` agent using send_notification. */
  withNotifier?: boolean;
  /** Collector tier (the simulated quality model keys off this). Default "standard". */
  collectorTier?: "fast" | "standard" | "reasoning";
  /** Include validate_records + dedupe steps. Default true. */
  withCleaning?: boolean;
  overrides?: Partial<WorkerBlueprint>;
}

export function makeBlueprint(opts: MakeBlueprintOptions = {}): WorkerBlueprint {
  const { withNotifier = false, collectorTier = "standard", withCleaning = true } = opts;

  const components: BlueprintComponent[] = [
    {
      type: "agent",
      id: "collector",
      name: "Researcher",
      description: "Finds funded AI infrastructure startups.",
      goal: "Collect recent AI infrastructure funding rounds as structured records.",
      instructions:
        "You are a meticulous market researcher. Search for AI infrastructure funding announcements from the last 30 days, open the most relevant sources, and extract one record per round with every required field. Never invent data; cite the source URL.",
      modelTier: collectorTier,
      tools: ["web_search", "fetch_url", "extract_data"],
      maxTurns: 8,
      inputKeys: ["job_brief", "instructions"],
      outputKey: "records",
      outputFormat: "json",
      outputSchemaHint: "array of {company, stage, amount_usd, lead_investor, category, source_url}",
    },
  ];
  if (withCleaning) {
    components.push(
      {
        type: "deterministic",
        id: "validate_records",
        name: "Validate records",
        description: "Drop records missing required fields.",
        operation: "validate_records",
        config: { requiredFields: ["company", "stage", "amount_usd", "source_url"], dropInvalid: true },
        inputKeys: ["records"],
        outputKey: "records",
      },
      {
        type: "deterministic",
        id: "dedupe",
        name: "Remove duplicates",
        description: "One record per company.",
        operation: "dedupe",
        config: { keyFields: ["company"] },
        inputKeys: ["records"],
        outputKey: "records",
      },
    );
  }
  components.push(
    {
      type: "deterministic",
      id: "rank",
      name: "Rank by round size",
      description: "Largest rounds first.",
      operation: "rank",
      config: { by: "amount_usd", direction: "desc", limit: 15 },
      inputKeys: ["records"],
      outputKey: "records",
    },
    {
      type: "agent",
      id: "analyst",
      name: "Analyst",
      description: "Writes the trends summary.",
      goal: "Summarize the key trends across the collected funding rounds.",
      instructions:
        "You are a market analyst. Given the ranked funding records, write a concise summary of notable trends: hot categories, stage mix, active investors. Be specific and reference the data.",
      modelTier: "standard",
      tools: [],
      maxTurns: 2,
      inputKeys: ["job_brief", "records"],
      outputKey: "insights",
      outputFormat: "markdown",
    },
    {
      type: "deterministic",
      id: "compile_report",
      name: "Compile report",
      description: "Assemble the final markdown report.",
      operation: "compile_report",
      config: {
        title: "Weekly AI Infra Funding Report",
        sections: [
          { heading: "Summary", sourceKey: "insights", as: "markdown" },
          { heading: "Top rounds", sourceKey: "records", as: "table", columns: ["rank", "company", "stage", "amount_usd", "lead_investor"] },
        ],
        includeMethodology: true,
      },
      inputKeys: ["insights", "records"],
      outputKey: "report",
    },
  );
  if (withNotifier) {
    components.push({
      type: "agent",
      id: "notifier",
      name: "Notifier",
      description: "Sends the finished report to stakeholders.",
      goal: "Send the report to the stakeholders listed in the job brief.",
      instructions: "Send the finished report using send_notification exactly once, then confirm in one line.",
      modelTier: "fast",
      tools: ["send_notification"],
      maxTurns: 3,
      inputKeys: ["report"],
      outputKey: "notification_status",
      outputFormat: "markdown",
    });
  }

  const tools = [
    { toolName: "web_search", reason: "Find funding announcements", requiresApproval: false },
    { toolName: "fetch_url", reason: "Read the source articles", requiresApproval: false },
    { toolName: "extract_data", reason: "Turn articles into structured records", requiresApproval: false },
  ];
  if (withNotifier) tools.push({ toolName: "send_notification", reason: "Deliver the report to stakeholders", requiresApproval: true });

  return WorkerBlueprintSchema.parse({
    schemaVersion: 1,
    jobFamily: "market_research",
    persona: {
      name: "Alex",
      title: "AI Market Researcher",
      summary: "Alex tracks funding activity and turns it into a crisp weekly briefing.",
      avatarColor: "violet",
    },
    responsibilities: ["Find newly funded startups", "Verify and structure round details", "Summarize weekly trends"],
    components,
    tools,
    kpis: [
      { id: "acceptance", name: "Acceptance rate", description: "Share of reports accepted", metric: "acceptance_rate", target: 0.9, unit: "%", direction: "higher_is_better" },
      { id: "coverage", name: "Records per report", description: "Funded startups per report", metric: "records_per_run", target: 10, unit: "records", direction: "higher_is_better" },
      { id: "cost", name: "Cost per run", description: "Spend per report", metric: "cost_per_run_usd", target: 0.5, unit: "$", direction: "lower_is_better" },
    ],
    evaluation: {
      deterministicChecks: [
        { id: "min_records", type: "min_records", description: "At least 8 records", config: { min: 8 }, weight: 2 },
        { id: "fields", type: "required_fields", description: "Required fields are filled", config: { fields: ["company", "stage", "amount_usd", "source_url"], minCompleteness: 0.9 }, weight: 2 },
        { id: "dupes", type: "no_duplicates", description: "No duplicate companies", config: { keyFields: ["company"] }, weight: 1 },
        { id: "sections", type: "contains_sections", description: "Report has the expected sections", config: { sections: ["Summary", "Top rounds"] }, weight: 1 },
      ],
      rubric: [
        { id: "relevance", criterion: "Relevance", description: "Records are genuinely AI infrastructure funding rounds", weight: 2 },
        { id: "insight", criterion: "Insight", description: "Summary surfaces real, specific trends", weight: 1 },
      ],
      weights: { ...DEFAULT_EVALUATION_WEIGHTS },
      passThreshold: DEFAULT_PASS_THRESHOLD,
    },
    deliverable: { titleTemplate: "Weekly AI Infra Funding Report — {{date}}", format: "markdown", contentKey: "report", dataKey: "records" },
    schedule: { kind: "weekly", hour: 9, dayOfWeek: 1 },
    limits: { ...DEFAULT_RUN_LIMITS },
    costEstimate: {
      perRunUsd: 0.18,
      runsPerMonth: 4.33,
      monthlyUsd: 0.78,
      breakdown: [
        { componentId: "collector", label: "Researcher", modelTier: collectorTier, estModelCalls: 6, estInputTokens: 24000, estOutputTokens: 3000, estToolCalls: 8, costUsd: 0.14 },
        { componentId: "analyst", label: "Analyst", modelTier: "standard", estModelCalls: 1, estInputTokens: 4000, estOutputTokens: 800, estToolCalls: 0, costUsd: 0.04 },
      ],
      assumptions: ["~8 tool calls per run"],
      confidence: "medium",
    },
    ...opts.overrides,
  });
}

export interface CreateHiredWorkerOptions extends MakeBlueprintOptions {
  spec?: JobSpec;
  blueprint?: WorkerBlueprint;
  userId?: string;
  name?: string;
}

/** Job (STAFFED) + APPROVED JobSpec + Worker (ACTIVE) + WorkerVersion v1 (ACTIVE) + grants, written directly with `db`. */
export async function createHiredWorker(organizationId: string, opts: CreateHiredWorkerOptions = {}) {
  const spec = opts.spec ?? makeJobSpec();
  const blueprint = opts.blueprint ?? makeBlueprint(opts);
  const schedule = cadenceToWorkerFields(blueprint.schedule);

  const job = await db.job.create({
    data: {
      organizationId,
      title: spec.title,
      description: spec.objective,
      jobFamily: spec.jobFamily,
      status: "STAFFED",
      createdById: opts.userId,
    },
  });
  const jobSpec = await db.jobSpec.create({
    data: { jobId: job.id, version: 1, status: "APPROVED", spec: toJson(spec), approvedAt: new Date() },
  });
  const created = await db.worker.create({
    data: {
      organizationId,
      jobId: job.id,
      name: opts.name ?? blueprint.persona.name,
      title: blueprint.persona.title,
      avatarColor: blueprint.persona.avatarColor,
      status: "ACTIVE",
      ...schedule,
      nextRunAt: null, // tests opt into scheduling explicitly
    },
  });
  const version = await db.workerVersion.create({
    data: {
      workerId: created.id,
      jobSpecId: jobSpec.id,
      version: 1,
      status: "ACTIVE",
      blueprint: toJson(blueprint),
      changeReason: "INITIAL_HIRE",
      activatedAt: new Date(),
      createdById: opts.userId,
    },
  });
  const worker = await db.worker.update({ where: { id: created.id }, data: { currentVersionId: version.id } });
  await db.workerToolGrant.createMany({
    data: blueprint.tools.map((t) => ({
      workerId: worker.id,
      toolName: t.toolName,
      requiresApproval: t.requiresApproval,
      grantedById: opts.userId,
    })),
  });
  return { job, jobSpec, worker, version, spec, blueprint };
}
