import type { DeterministicComponent, JobSpec } from "@/server/domain";
import { looksNumeric } from "./cues";

/**
 * The records table of a feedback report is a shortlist — the handful of items a product lead should read first —
 * not the whole categorized log, which stays complete in `records` (the deliverable's data view, the stats and
 * every evaluation check read it).
 *
 * The runtime's rank orders numbers or text, and severity is categorical: text order puts "low" between "high" and
 * "medium". So low-severity items are set aside first, and the ascending text order of what is left
 * ("critical" < "high" < "medium") IS the severity order. Both steps write their own context key so nothing
 * upstream is narrowed or reordered.
 */

export const NOTABLE_KEY = "notable_feedback";
export const NOTABLE_ROWS = 10;
const NOTABLE_HEADING = "Notable feedback";
/** Leaves room for a `rank` column inside design.ts's MAX_TABLE_COLUMNS (8). */
const MAX_COLUMNS = 7;

const SEVERITY_FIELDS = ["severity", "severity_level", "severity_score", "impact", "urgency", "priority"];

/** One column per group, first spec field that exists: who, what, how bad, and what to do about it. */
const COLUMN_GROUPS: readonly (readonly string[])[] = [
  ["id", "feedback_id", "item_id", "ref", "reference_id"],
  ["customer", "customer_name", "account", "account_name", "company", "company_name"],
  ["category", "theme", "topic", "product_area", "feature_area"],
  ["sentiment", "tone"],
  SEVERITY_FIELDS,
  ["summary", "short_summary", "one_line_summary", "gist", "headline"],
  ["suggested_action", "recommended_action", "recommendation", "next_step", "action"],
];

/** Verbatim fields. A table cell cannot be shortened in code, so the raw feedback never goes in the table. */
const RAW_TEXT = /^(?:text|feedback|feedback_text|raw_text|original_text|verbatim|quote|comment|message|body|content|excerpt|details)$/;
/** A heading that asks for everything ("All feedback", "Full feedback log") keeps every row, in collector order. */
const FULL_LIST = /\b(all|every|full|complete|entire)\b/i;
/** …unless it also asks for a shortlist ("Top complaints across all channels"). */
const SHORTLIST = /\b(top|notable|key|critical|urgent|highlights?|worst|biggest)\b/i;

export interface FeedbackTablePlan {
  /** Heading used when the customer named no table section. */
  heading: string;
  /** Steps that build the shortlist; they run after the in-place record steps and before the analyst. */
  components: DeterministicComponent[];
  /** Overrides for the report's table section. `maxRows` undefined = the default row cap. */
  table: { sourceKey: string; columns?: string[]; maxRows?: number };
  /** Extra collector output rule the ordering relies on (pins the severity vocabulary); null when none is needed. */
  collectorRule: string | null;
  /** How the analyst's output rules refer to the table appended after its text. */
  analystLabel: string;
}

type SpecField = JobSpec["deliverable"]["fields"][number];

/** Readable feedback columns: never the verbatim text; spec order when too few of the preferred fields exist. */
export function feedbackTableColumns(fields: readonly SpecField[]): string[] | undefined {
  const names = new Set(fields.map((f) => f.name));
  const picked = COLUMN_GROUPS.map((group) => group.find((name) => names.has(name))).filter((name): name is string => name !== undefined);
  if (picked.length >= 3) return picked;
  const readable = fields.map((f) => f.name).filter((name) => !RAW_TEXT.test(name)).slice(0, MAX_COLUMNS);
  return readable.length > 0 ? readable : undefined;
}

function severityField(fields: readonly SpecField[]): SpecField | undefined {
  for (const name of SEVERITY_FIELDS) {
    const field = fields.find((f) => f.name === name);
    if (field) return field;
  }
  return undefined;
}

/**
 * The table plan for a feedback_analysis markdown report; undefined for every other job (their tables are unchanged).
 * `rankedBy` is the in-place rank on `records`, when the design has one.
 */
export function feedbackTablePlan(
  spec: JobSpec,
  args: { tableHeading?: string; ranked: boolean; rankedBy?: { by: string; direction: "asc" | "desc" } },
): FeedbackTablePlan | undefined {
  if (spec.jobFamily !== "feedback_analysis" || spec.deliverable.format !== "markdown") return undefined;
  const heading = args.tableHeading ?? NOTABLE_HEADING;
  const columns = feedbackTableColumns(spec.deliverable.fields);
  const base = { heading, components: [], collectorRule: null };

  if (args.tableHeading && FULL_LIST.test(args.tableHeading) && !SHORTLIST.test(args.tableHeading)) {
    const full = columns && args.ranked ? ["rank", ...columns] : columns;
    return { ...base, table: { sourceKey: "records", ...(full ? { columns: full } : {}) }, analystLabel: "The full records table" };
  }

  const shortlist = { ...(columns ? { columns } : {}), maxRows: NOTABLE_ROWS };
  const severity = severityField(spec.deliverable.fields);
  if (!severity) {
    return { ...base, table: { sourceKey: "records", ...shortlist }, analystLabel: `The "${heading}" table (the first ${NOTABLE_ROWS} items)` };
  }

  const label = severity.name.replace(/_/g, " ");
  const analystLabel = `The "${heading}" table (the ${NOTABLE_ROWS} highest-${label} items, most severe first)`;
  const rankStep = (direction: "asc" | "desc", inputKey: string, description: string): DeterministicComponent => ({
    type: "deterministic",
    id: "notable_rank",
    name: `Rank notable feedback by ${label}`,
    description,
    operation: "rank",
    config: { by: severity.name, direction, limit: NOTABLE_ROWS },
    inputKeys: [inputKey],
    outputKey: NOTABLE_KEY,
  });

  if (looksNumeric(severity.name)) {
    // A numeric score ranks directly, highest first — and needs no step at all when `records` is already ranked by it.
    if (args.rankedBy?.by === severity.name && args.rankedBy.direction === "desc") {
      return { ...base, table: { sourceKey: "records", ...shortlist }, analystLabel };
    }
    return {
      ...base,
      components: [rankStep("desc", "records", `Highest ${label} first; the top ${NOTABLE_ROWS} go in the ${heading} table.`)],
      table: { sourceKey: NOTABLE_KEY, ...shortlist },
      analystLabel,
    };
  }

  return {
    heading,
    components: [
      {
        type: "deterministic",
        id: "notable_shortlist",
        name: "Shortlist notable feedback",
        description: `Set low-${label} items aside for the ${heading} table; every item stays in the report data.`,
        operation: "filter",
        config: { field: severity.name, op: "neq", value: "low" },
        inputKeys: ["records"],
        outputKey: NOTABLE_KEY,
      },
      rankStep("asc", NOTABLE_KEY, `High ${label} first, then medium; the top ${NOTABLE_ROWS} go in the ${heading} table.`),
    ],
    table: { sourceKey: NOTABLE_KEY, ...shortlist },
    collectorRule: `- ${severity.name} is exactly one of high / medium / low (lowercase): the ${heading} table is ordered by it.`,
    analystLabel,
  };
}
