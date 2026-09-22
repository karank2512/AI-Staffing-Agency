import type { Cadence, DeliverableFormatSlug, JobFamily } from "@/server/domain";

/**
 * Plain-English cues shared by the simulated scoper (description → JobSpec) and the job-family templates
 * (JobSpec → BlueprintDraft). PURE and deterministic: the same words always produce the same reading.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};
const NUM = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
const COUNTABLE =
  "(?:leads?|compan(?:y|ies)|records?|items?|startups?|results?|rows?|tickets?|entries|accounts?|prospects?|rounds?|deals?|reviews?|contacts?|vendors?|competitors?|invoices?|transactions?|posts?|articles?|drafts?|pieces?|feedback items?|responses?|themes?)";
const NOT_A_DURATION = "(?!\\s*(?:-\\s*)?(?:days?|weeks?|months?|hours?|years?|minutes?|%|percent|k\\b|m\\b|usd|dollars?|am|pm))";
const COUNT_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\btop[-\\s]+${NUM}\\b${NOT_A_DURATION}`, "i"),
  new RegExp(`\\b(?:about|around|roughly|at least|up to|ideally|target(?:ing)?|~)\\s+${NUM}\\b${NOT_A_DURATION}`, "i"),
  new RegExp(`\\b${NUM}\\s+(?:[a-z-]+\\s+){0,2}?${COUNTABLE}\\b`, "i"),
  new RegExp(`^\\s*${NUM}\\s*$`, "i"), // an answer that is just the number
];

/** "top 10", "about 25 leads", "15 companies", "twenty" → 10 / 25 / 15 / 20. Undefined when no count is named. */
export function detectCount(text: string): number | undefined {
  for (const pattern of COUNT_PATTERNS) {
    const m = pattern.exec(text);
    if (!m) continue;
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (Number.isFinite(n) && n >= 1) return Math.min(200, n);
  }
  return undefined;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function detectHour(text: string): number | undefined {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (m) {
    const h = Number(m[1]) % 12;
    return m[3].toLowerCase() === "pm" ? h + 12 : h;
  }
  if (/\b(every|each)\s+morning\b|\bmornings?\b|\bstart of (the )?day\b/i.test(text)) return 8;
  if (/\b(every|each)\s+evening\b|\bend of (the )?day\b|\bevenings?\b/i.test(text)) return 17;
  if (/\b(lunch|midday|noon)\b/i.test(text)) return 12;
  return undefined;
}

/** Cadence words → schedule. Falls back to the family's natural rhythm when nothing is said. */
export function detectCadence(text: string, fallback: Cadence): Cadence {
  const t = text.toLowerCase();
  const hour = detectHour(t);
  if (/\b(hourly|every hour|each hour|continuously|real[- ]?time|as they (come|arrive) in)\b/.test(t)) return { kind: "hourly" };
  const day = DAYS.findIndex((d) => new RegExp(`\\b(every|each|on)\\s+${d}s?\\b|\\b${d}s?\\s+(morning|afternoon|evening)\\b`).test(t));
  if (day >= 0) return { kind: "weekly", hour: hour ?? 9, dayOfWeek: day };
  if (/\b(weekly|every week|each week|once a week|per week|a week)\b/.test(t)) return { kind: "weekly", hour: hour ?? 9, dayOfWeek: 1 };
  if (/\b(daily|every day|each day|every morning|each morning|every evening|every weekday|per day|a day|mornings)\b/.test(t)) {
    return { kind: "daily", hour: hour ?? 8 };
  }
  if (/\b(on demand|manually|when i ask|ad[- ]hoc|one[- ]off|as needed|only when)\b/.test(t)) return { kind: "manual" };
  if (hour !== undefined) return { kind: fallback.kind === "manual" || fallback.kind === "hourly" ? "daily" : fallback.kind, hour, dayOfWeek: fallback.dayOfWeek };
  return fallback;
}

/** Format words → deliverable format; the family default otherwise. */
export function detectFormat(text: string, fallback: DeliverableFormatSlug): DeliverableFormatSlug {
  const t = text.toLowerCase();
  if (/\b(csv|spreadsheet|spread sheet|sheet|excel|xlsx|google sheets?|table i can import|import into (my |our )?crm|crm import)\b/.test(t)) return "csv";
  if (/\b(json|api payload|machine[- ]readable|raw records)\b/.test(t)) return "json";
  // "post" is deliberately absent: "post it in Slack" is a delivery instruction, not a format.
  if (/\b(report|brief|briefing|memo|summary|digest|write[- ]?up|narrative|markdown|newsletter|article|draft)\b/.test(t)) return "markdown";
  return fallback;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

export function extractEmails(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found];
}

/** Does the text ask for the result to be sent somewhere (email, Slack, "share with the team")? */
export function mentionsSending(text: string): boolean {
  if (extractEmails(text).length > 0) return true;
  return /\b(send|sends|sent|email|e-mail|mail (it|them|me)|notify|notification|slack|share (it|this|them|with)|distribute|deliver (it|them) to|post (it|them) (in|to)|circulate|forward)\b/i.test(
    text,
  );
}

const BUDGET_RUN_RE = /\$\s?(\d+(?:\.\d+)?)\s*(?:per|a|each|\/)\s*run\b/i;
const BUDGET_MONTH_RE = /\$\s?(\d+(?:\.\d+)?)\s*(?:per|a|each|\/)\s*month\b|\$\s?(\d+(?:\.\d+)?)\s*monthly\b/i;

export function detectBudget(text: string): { maxCostPerRunUsd?: number; maxMonthlyUsd?: number } {
  const out: { maxCostPerRunUsd?: number; maxMonthlyUsd?: number } = {};
  const run = BUDGET_RUN_RE.exec(text);
  if (run) out.maxCostPerRunUsd = Number(run[1]);
  const month = BUDGET_MONTH_RE.exec(text);
  if (month) out.maxMonthlyUsd = Number(month[1] ?? month[2]);
  return out;
}

export const CADENCE_ADJECTIVE: Record<Cadence["kind"], string> = {
  manual: "On-demand",
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
};

/** Sentence-cased, word-boundary clip with an ellipsis. */
export function clipText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

export function toSnakeCase(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1");
}

/** Everything a spec says, as one lower-cased haystack for cue detection. */
export function specText(spec: {
  title: string;
  summary: string;
  objective: string;
  responsibilities: string[];
  deliverable: { title: string; description: string };
  approvalPolicy: { requireApprovalFor: string[]; notes?: string };
  constraints: string[];
  assumptions: string[];
}): string {
  return [
    spec.title,
    spec.summary,
    spec.objective,
    ...spec.responsibilities,
    spec.deliverable.title,
    spec.deliverable.description,
    ...spec.approvalPolicy.requireApprovalFor,
    spec.approvalPolicy.notes ?? "",
    ...spec.constraints,
    ...spec.assumptions,
  ]
    .join(" ")
    .toLowerCase();
}

/** Field names that hold numbers a ranking or stats step can use. */
export function looksNumeric(fieldName: string): boolean {
  return /(amount|usd|price|cost|score|count|employees|headcount|revenue|total|hours|days|rating|value|spend|size|arr|mrr|quantity|qty|_num$|number)/i.test(
    fieldName,
  );
}

export const FAMILY_DEFAULT_CADENCE: Record<JobFamily, Cadence> = {
  lead_research: { kind: "weekly", hour: 9, dayOfWeek: 1 },
  market_research: { kind: "weekly", hour: 9, dayOfWeek: 1 },
  market_analysis: { kind: "weekly", hour: 9, dayOfWeek: 1 },
  feedback_analysis: { kind: "weekly", hour: 9, dayOfWeek: 1 },
  support_triage: { kind: "daily", hour: 8 },
  finance_ops: { kind: "weekly", hour: 9, dayOfWeek: 1 },
  content: { kind: "weekly", hour: 9, dayOfWeek: 2 },
  general: { kind: "weekly", hour: 9, dayOfWeek: 1 },
};
