import {
  DEFAULT_RUN_LIMITS,
  WorkerBlueprintSchema,
  type AgentComponent,
  type BlueprintComponent,
  type BlueprintDraft,
  type JobSpec,
  type ReportSection,
  type ToolRequirement,
  type WorkerBlueprint,
} from "@/server/domain";
import { AppError } from "@/server/errors";
import { tools } from "@/server/tools";
import { estimateCost } from "./cost";
import { extractEmails, looksNumeric, specText } from "./cues";
import { deriveEvaluationPlan, deriveKpis, requiredFieldNames, usableKeyFields } from "./kpis";
import { buildPersona } from "./persona";

/**
 * designBlueprint — turns the flat BlueprintDraft (LLM or template) into a complete, validated WorkerBlueprint.
 * PURE and deterministic: all wiring (context keys, deterministic steps, deliverable, notifier) is decided here,
 * never by the model, so every blueprint the executor receives follows the same pipeline conventions.
 */

const NOTIFY_TOOL = "send_notification";
const COLLECTOR_MAX_TURNS = 8;
const ANALYST_MAX_TURNS = 2;
const NOTIFIER_MAX_TURNS = 3;
const RANK_LIMIT_FACTOR = 1.5;
const MAX_TABLE_COLUMNS = 8;

/** Headings that read like an aggregate ("Category breakdown", "Themes by volume") render the stats block. */
const STATS_HEADING = /\b(breakdown|by (category|theme|team|stage|segment|type|plan|channel|priority|vendor|pricing model|sentiment|severity)|distribution|mix|volume|counts?|stats|statistics|share of|themes by)\b/i;
/** Headings that read like a list ("Top rounds", "Notable feedback", "Sources") render the records table. */
const TABLE_HEADING = /\b(top|list|table|records|rounds|leads|companies|tickets|items|accounts|contacts|transactions|invoices|entries|details|sources|prospects|rows|results|comparison|notable|feedback|vendors|competitors|lines?)\b/i;

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const nonEmpty = (s: string | undefined, fallback: string) => (clean(s).length > 0 ? clean(s) : fallback);

/**
 * The draft's prompt plus the job-specific output rules. A blank draft prompt stays blank so the schema rejects it
 * (AgentComponentSchema.instructions min 1): output rules alone are not a system prompt, and a live model that
 * produced nothing must trigger the template fallback instead of shipping a mute agent.
 */
const withOutputRules = (draftInstructions: string, rules: string) => (draftInstructions.trim().length > 0 ? `${draftInstructions.trim()}${rules}` : "");

function collectorTools(draft: BlueprintDraft): string[] {
  // The notifier is the only component allowed to write to the outside world; a collector that lists
  // send_notification is read as "please notify" (see notifyRequested) rather than granted the tool.
  return [...new Set(draft.collector.tools.map(clean).filter((t) => t !== NOTIFY_TOOL && tools.has(t)))];
}

function notifyRequested(spec: JobSpec, draft: BlueprintDraft): boolean {
  return draft.steps.notify || spec.toolsLikelyNeeded.includes(NOTIFY_TOOL) || draft.collector.tools.includes(NOTIFY_TOOL);
}

function schemaHint(fields: readonly string[]): string {
  return fields.length > 0 ? `array of {${fields.join(", ")}}` : "array of flat records, one object per item found";
}

function collectorOutputRules(spec: JobSpec): string {
  const fields = spec.deliverable.fields;
  const lines = ["", "Output contract for this job:"];
  if (fields.length > 0) {
    lines.push(`- Your final answer is a JSON array of flat objects with exactly these keys: ${fields.map((f) => f.name).join(", ")}.`);
    const required = requiredFieldNames(spec);
    if (required.length > 0) lines.push(`- Required in every record: ${required.join(", ")}. Use null only when a value genuinely cannot be found.`);
  } else {
    lines.push("- Your final answer is a JSON array of flat objects, one per item, with consistent snake_case keys.");
  }
  if (spec.deliverable.targetCount) lines.push(`- Aim for about ${spec.deliverable.targetCount} records; quality and completeness beat volume.`);
  lines.push("- No prose before or after the JSON.");
  return lines.join("\n");
}

function analystOutputRules(narrative: readonly string[], hasStats: boolean): string {
  const [first, ...rest] = narrative;
  const lines = ["", "Output rules for this job:"];
  lines.push(`- Your text is inserted under the heading "${first}". Do not repeat that heading; start directly with the prose.`);
  if (rest.length > 0) lines.push(`- Then add these sections in this order, each under a "### <heading>" heading: ${rest.join(" · ")}.`);
  lines.push(`- The full records table${hasStats ? " and the breakdown" : ""} are appended automatically after your text; cite specific rows, but do not reproduce the whole table.`);
  return lines.join("\n");
}

function notifierInstructions(spec: JobSpec): string {
  const emails = extractEmails(specText(spec));
  const recipients = emails.length > 0 ? emails.join(", ") : "the stakeholders named in the job brief (or the team address if none are named)";
  return [
    `Send the finished "${spec.deliverable.title}" exactly once with send_notification: channel "email", recipients ${recipients}, subject = the deliverable title, body = the content you were given (trimmed to a readable length, never altered in substance).`,
    "Every send is approved by a human before it goes out. If the send is rejected or fails, say so in one line and stop — never retry, never send twice.",
    "After a successful send, confirm in one line who received it.",
  ].join("\n\n");
}

function agent(args: Omit<AgentComponent, "type">): AgentComponent {
  return { type: "agent", ...args };
}

/** Assign the spec's report sections to what the pipeline produces: prose, the records table, the stats block. */
function reportSections(spec: JobSpec, args: { fields: readonly string[]; hasStats: boolean; ranked: boolean }): { sections: ReportSection[]; narrative: string[] } {
  const headings = [...new Set(spec.deliverable.sections.map(clean).filter((h) => h.length > 0))];
  const narrative: string[] = [];
  let tableHeading: string | undefined;
  let statsHeading: string | undefined;
  for (const h of headings) {
    if (!statsHeading && args.hasStats && STATS_HEADING.test(h)) statsHeading = h;
    else if (!tableHeading && TABLE_HEADING.test(h)) tableHeading = h;
    else narrative.push(h);
  }
  if (narrative.length === 0) narrative.push("Summary");

  const columns = args.fields.length > 0 ? [...(args.ranked ? ["rank"] : []), ...args.fields].slice(0, MAX_TABLE_COLUMNS) : undefined;
  const maxRows = spec.deliverable.targetCount ? Math.max(10, Math.round(spec.deliverable.targetCount * RANK_LIMIT_FACTOR)) : 25;
  const table: ReportSection = { heading: tableHeading ?? "Records", sourceKey: "records", as: "table", ...(columns ? { columns } : {}), maxRows };
  const stats: ReportSection | undefined = args.hasStats ? { heading: statsHeading ?? "Breakdown", sourceKey: "stats", as: "stats" } : undefined;
  const prose: ReportSection = { heading: narrative[0], sourceKey: "insights", as: "markdown" };

  // Keep the customer's order for the headings they named; anything unnamed goes after the prose.
  const sections: ReportSection[] = [];
  for (const h of headings) {
    if (h === narrative[0]) sections.push(prose);
    else if (h === tableHeading) sections.push(table);
    else if (h === statsHeading && stats) sections.push(stats);
  }
  if (!sections.includes(prose)) sections.unshift(prose);
  if (!sections.includes(table)) sections.push(table);
  if (stats && !sections.includes(stats)) sections.push(stats);
  return { sections, narrative };
}

export function designBlueprint(spec: JobSpec, draft: BlueprintDraft, opts: { usedNames?: string[] } = {}): WorkerBlueprint {
  const fields = spec.deliverable.fields.map((f) => f.name);
  const fieldSet = new Set(fields);
  const required = requiredFieldNames(spec);
  const keyFields = usableKeyFields(spec, draft.keyFields);
  const rankBy = fieldSet.has(clean(draft.rankBy)) ? clean(draft.rankBy) : undefined;
  const groupBy = fieldSet.has(clean(draft.groupBy)) ? clean(draft.groupBy) : undefined;
  const target = spec.deliverable.targetCount;
  const format = spec.deliverable.format;
  const components: BlueprintComponent[] = [];

  components.push(
    agent({
      id: "collector",
      name: nonEmpty(draft.collector.name, "Collector"),
      description: nonEmpty(draft.collector.description, `Gathers the records behind the ${spec.deliverable.title}.`),
      goal: nonEmpty(draft.collector.goal, `Collect the records the ${spec.deliverable.title} is built from.`),
      instructions: withOutputRules(draft.collector.instructions, collectorOutputRules(spec)),
      modelTier: draft.collector.modelTier,
      tools: collectorTools(draft),
      maxTurns: COLLECTOR_MAX_TURNS,
      inputKeys: ["job_brief", "instructions"],
      outputKey: "records",
      outputFormat: "json",
      outputSchemaHint: schemaHint(fields),
    }),
  );

  if (draft.steps.validate && required.length > 0) {
    components.push({
      type: "deterministic",
      id: "validate_records",
      name: "Validate records",
      description: `Drop records missing ${required.join(", ")}.`,
      operation: "validate_records",
      config: { requiredFields: required, dropInvalid: true },
      inputKeys: ["records"],
      outputKey: "records",
    });
  }
  if (draft.steps.dedupe && keyFields.length > 0) {
    components.push({
      type: "deterministic",
      id: "dedupe",
      name: "Remove duplicates",
      description: `One record per ${keyFields.join(" + ")}.`,
      operation: "dedupe",
      config: { keyFields },
      inputKeys: ["records"],
      outputKey: "records",
    });
  }
  const ranked = draft.steps.rank && rankBy !== undefined;
  if (ranked && rankBy) {
    components.push({
      type: "deterministic",
      id: "rank",
      name: `Rank by ${rankBy.replace(/_/g, " ")}`,
      description: `${draft.rankDirection === "desc" ? "Highest" : "Lowest"} ${rankBy.replace(/_/g, " ")} first${target ? `, keeping the top ${Math.round(target * RANK_LIMIT_FACTOR)}` : ""}.`,
      operation: "rank",
      config: { by: rankBy, direction: draft.rankDirection, ...(target ? { limit: Math.round(target * RANK_LIMIT_FACTOR) } : {}) },
      inputKeys: ["records"],
      outputKey: "records",
    });
  }
  const hasStats = draft.steps.computeStats && groupBy !== undefined;
  if (hasStats && groupBy) {
    components.push({
      type: "deterministic",
      id: "compute_stats",
      name: `Break down by ${groupBy.replace(/_/g, " ")}`,
      description: `Counts per ${groupBy.replace(/_/g, " ")} plus numeric summaries.`,
      operation: "compute_stats",
      config: { groupBy, numericFields: fields.filter((f) => f !== groupBy && looksNumeric(f)) },
      inputKeys: ["records"],
      outputKey: "stats",
    });
  }

  let contentKey: string;
  if (format === "markdown") {
    const { sections, narrative } = reportSections(spec, { fields, hasStats, ranked });
    components.push(
      agent({
        id: "analyst",
        name: nonEmpty(draft.analyst.name, "Analyst"),
        description: nonEmpty(draft.analyst.description, `Writes the narrative for the ${spec.deliverable.title}.`),
        goal: nonEmpty(draft.analyst.goal, `Turn the collected records into the insights the ${spec.deliverable.title} needs.`),
        instructions: withOutputRules(draft.analyst.instructions, analystOutputRules(narrative, hasStats)),
        modelTier: draft.analyst.modelTier,
        tools: [],
        maxTurns: ANALYST_MAX_TURNS,
        inputKeys: ["job_brief", "records", ...(hasStats ? ["stats"] : [])],
        outputKey: "insights",
        outputFormat: "markdown",
      }),
      {
        type: "deterministic",
        id: "compile_report",
        name: "Compile report",
        description: `Assemble the ${spec.deliverable.title} from the insights, the records table${hasStats ? " and the breakdown" : ""}.`,
        operation: "compile_report",
        config: { title: spec.deliverable.title, sections, includeMethodology: true },
        inputKeys: ["insights", "records", ...(hasStats ? ["stats"] : [])],
        outputKey: "report",
      },
    );
    contentKey = "report";
  } else if (format === "csv") {
    components.push({
      type: "deterministic",
      id: "to_csv",
      name: "Export CSV",
      description: "Serialize the records as a spreadsheet-ready CSV.",
      operation: "to_csv",
      config: fields.length > 0 ? { columns: [...(ranked ? ["rank"] : []), ...fields] } : {},
      inputKeys: ["records"],
      outputKey: "csv",
    });
    contentKey = "csv";
  } else {
    contentKey = "records";
  }

  if (notifyRequested(spec, draft)) {
    components.push(
      agent({
        id: "notifier",
        name: "Notifier",
        description: `Sends the finished ${spec.deliverable.title} to stakeholders, with your approval.`,
        goal: `Deliver the ${spec.deliverable.title} to its recipients once it is ready.`,
        instructions: notifierInstructions(spec),
        modelTier: "fast",
        tools: [NOTIFY_TOOL],
        maxTurns: NOTIFIER_MAX_TURNS,
        inputKeys: [contentKey],
        outputKey: "notification_status",
        outputFormat: "markdown",
      }),
    );
  }

  const reasons = new Map(draft.toolReasons.map((r) => [clean(r.toolName), clean(r.reason)] as const));
  const toolRequirements: ToolRequirement[] = [];
  for (const component of components) {
    if (component.type !== "agent") continue;
    for (const toolName of component.tools) {
      if (toolRequirements.some((t) => t.toolName === toolName)) continue;
      const definition = tools.get(toolName);
      if (!definition) continue;
      toolRequirements.push({
        toolName,
        reason: reasons.get(toolName) || definition.humanDescription,
        requiresApproval: toolName === NOTIFY_TOOL ? true : definition.defaultRequiresApproval,
      });
    }
  }

  const responsibilities = [...new Set(draft.responsibilities.map(clean).filter((r) => r.length > 0))].slice(0, 8);
  const persona = buildPersona({
    family: spec.jobFamily,
    seedText: `${spec.title}|${spec.jobFamily}`,
    proposed: draft.persona,
    usedNames: opts.usedNames,
    deliverableTitle: spec.deliverable.title,
  });

  const withoutCost: Omit<WorkerBlueprint, "costEstimate"> = {
    schemaVersion: 1,
    jobFamily: spec.jobFamily,
    persona,
    responsibilities: responsibilities.length > 0 ? responsibilities : spec.responsibilities.slice(0, 8),
    components,
    tools: toolRequirements,
    kpis: deriveKpis(spec),
    evaluation: deriveEvaluationPlan(spec, { keyFields }),
    deliverable: { titleTemplate: `${spec.deliverable.title} — {{date}}`, format, contentKey, dataKey: "records" },
    schedule: spec.cadence,
    limits: { ...DEFAULT_RUN_LIMITS, ...(spec.budget.maxCostPerRunUsd ? { maxCostPerRunUsd: spec.budget.maxCostPerRunUsd } : {}) },
  };
  const candidate: WorkerBlueprint = { ...withoutCost, costEstimate: estimateCost(withoutCost) };

  const parsed = WorkerBlueprintSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
    throw new AppError("VALIDATION", `The designed worker is not valid: ${issues.slice(0, 5).join("; ")}`, { issues });
  }
  return parsed.data;
}
