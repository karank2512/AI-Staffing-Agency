import type { ModelTier } from "@/server/domain/blueprint";
import type { JobFamily } from "@/server/domain/job-family";
import type { JobSpec } from "@/server/domain/job-spec";
import type { MockAgentTurnInput } from "@/server/simulation/types";
import type { SampleDataset } from "@/server/tools/schemas";
import { constraintsForSpec, type JobConstraints } from "../constraints";
import { canonicalField, kindAffinity, type EntityKind } from "../fields";
import { FEEDBACK_CATEGORIES } from "../fixtures/feedback";
import { TICKET_CATEGORIES } from "../fixtures/tickets";
import { hashSeed } from "../rng";
import { joinList, stem, tokenize } from "../text";
import { specVendorNames } from "../vendors";
import { findFirstJson, parseAgentInput } from "./input";
import { DEFAULT_TARGET_COUNT, desiredRecordCount, hasVagueInstructions, parseOneOffInstructions, type OneOffDirectives } from "./quality";

/** Everything the collector needs to know about the job, derived once per turn from the STRUCTURED spec. */
export interface JobContext {
  /** Field names for every output record (spec order). */
  fields: string[];
  requiredFields: string[];
  /** Which fixture universe the job is about; "generic" = none of them. */
  kind: EntityKind | "generic";
  directives: OneOffDirectives;
  /** Feedback/ticket categories the SPEC itself is about ("mobile app feedback digest" → ["mobile"]). */
  specFocus: string[];
  vague: boolean;
  tier: ModelTier;
  /** How many records this run should produce (one-off count → target → vagueness penalty). */
  count: number;
  /** Seed for the quality model: component id + spec title (stable across runs of the same worker). */
  seed: number;
  /** Web queries, in the order they are issued (a named-vendor query leads when the spec names vendors). */
  queries: string[];
  /** The job's topic query — what "relevant to this job" means when ranking fixture companies. */
  relevanceQuery: string;
  /** Vendors a pricing spec names ("Notion, Coda, Airtable …"), in the customer's spelling and order. */
  namedVendors: string[];
  /** The sample dataset that holds this job's records; null when none does (finance ledgers live on the web). */
  dataset: SampleDataset | null;
  /** Stage / place / sector the brief restricts the companies to (see constraints.ts). */
  constraints: JobConstraints;
  /** Finance jobs about SaaS/software review only software lines, invoice jobs only invoices; others all spend. */
  expenseScope: "software" | "invoices" | "all";
}

const DEFAULT_FIELDS: Record<JobContext["kind"], readonly string[]> = {
  company: ["company", "category", "stage", "amount_usd", "lead_investor", "source_url"],
  feedback: ["id", "customer", "text", "category", "sentiment", "severity"],
  ticket: ["id", "subject", "category", "priority", "team"],
  expense: ["id", "date", "vendor", "category", "amount_usd", "status", "flag_reason"],
  generic: ["title", "summary", "source_url"],
};
const LEAD_FIELDS = ["company", "website", "contact_name", "contact_title", "contact_email", "fit_reason"] as const;

const KIND_BY_FAMILY: Partial<Record<JobFamily, EntityKind>> = {
  feedback_analysis: "feedback",
  support_triage: "ticket",
  lead_research: "company",
  market_research: "company",
  market_analysis: "company",
  finance_ops: "expense",
};

/**
 * Feedback as a NOUN. The verb "review" ("review our SaaS spend") is not customer feedback, so a bare "review"
 * never counts; "customer reviews", "app reviews" and the unambiguous words do.
 */
const FEEDBACK_NOUN = /\b(feedback|nps|surveys?|complaints?|testimonials?|(customer|user|app|product|store|online)\s+reviews?|reviews\s+(from|of|by)\s+(customers|users))\b/;
const EXPENSE_WORDS = /\b(expenses?|invoices?|transactions?|subscriptions?|saas spend|spend review|ledger|reconcil(e|iation)|accounts payable|receipts?)\b/;

function specText(spec: JobSpec): string {
  return [spec.title, spec.objective, spec.summary, spec.deliverable.title, spec.deliverable.description, ...spec.responsibilities].join(" ").toLowerCase();
}

function inferKind(family: JobFamily, spec: JobSpec): JobContext["kind"] {
  const byFamily = KIND_BY_FAMILY[family];
  if (byFamily) return byFamily;
  const names = spec.deliverable.fields.map((f) => f.name);
  const text = specText(spec);
  // Other families: trust the field names first, then the wording of the job.
  const scored = (["company", "feedback", "ticket", "expense"] as const)
    .map((kind) => ({ kind, affinity: kindAffinity(kind, names) }))
    .sort((a, b) => b.affinity - a.affinity);
  if (/\b(ticket|helpdesk|support request)s?\b/.test(text)) return "ticket";
  if (FEEDBACK_NOUN.test(text)) return "feedback";
  if (EXPENSE_WORDS.test(text)) return "expense";
  if (/\b(startup|funding|investor|competitor|prospect|leads)s?\b/.test(text)) return "company";
  return names.length > 0 && scored[0].affinity >= 0.75 ? scored[0].kind : "generic";
}

const TITLE_NOISE = new Set(
  "tracker weekly daily monthly hourly report digest monitor worker brief briefing newsletter list builder analysis analyst the a an of for and our my".split(" "),
);
const QUERY_STOPWORDS = new Set(
  "a an and are as at be by for from in into is it of on or our that the their this to with we each every per find produce create build track keep identify recently newly".split(" "),
);

/** Words that steer the simulated search router; only added when the job is about that universe. */
function topicHint(text: string, kind: JobContext["kind"], family: JobFamily): string {
  if (kind === "feedback") return "customer feedback reviews";
  if (kind === "ticket") return "support tickets";
  if (kind === "expense") return "spend ledger transactions";
  if (kind !== "company") return "";
  // "lead investor" is a funding field, not a sales lead.
  if (family === "lead_research" || /\b(leads?(?!\s+investors?)|prospects?|outbound|icp)\b/.test(text)) return "companies leadership contacts";
  if (/\b(pricing|prices?|competitors?|packaging)\b/.test(text)) return "pricing comparison";
  if (/\b(fund(ing|ed)?|raised?|rounds?|invest(or|ors|ment)?)\b/.test(text)) return "funding announcements";
  return "startups funding";
}

/** The letter of "Series A" is not the article "a": keep it whenever the previous word is "series". */
function keepWord(words: readonly string[], i: number, noise: ReadonlySet<string>): boolean {
  const w = words[i].toLowerCase().replace(/[^a-z]/g, "");
  if (/^[a-e]$/.test(w) && words[i - 1]?.toLowerCase().replace(/[^a-z]/g, "") === "series") return true;
  return !noise.has(w);
}

/** 1–2 web queries: the job's topic, then either the run's focus or the objective in the customer's words. */
function buildQueries(spec: JobSpec, kind: JobContext["kind"], family: JobFamily, directives: OneOffDirectives): string[] {
  const text = specText(spec);
  const hint = topicHint(text, kind, family);
  const titleWords = spec.title.split(/\s+/);
  const base = titleWords
    .filter((_, i) => keepWord(titleWords, i, TITLE_NOISE))
    .join(" ")
    .trim();
  const hintWords = new Set(tokenize(hint));
  const baseWithoutHint = base
    .split(/\s+/)
    .filter((w) => !hintWords.has(w.toLowerCase()))
    .join(" ");
  const primary = `${baseWithoutHint} ${hint}`.replace(/\s+/g, " ").trim();

  const objectiveTokens = tokenize(spec.objective);
  const objectiveWords = objectiveTokens.filter((_, i) => keepWord(objectiveTokens, i, QUERY_STOPWORDS)).slice(0, 8).join(" ");
  const secondary = directives.focusTerms.length > 0 ? `${directives.focusTerms.join(" ")} ${hint || baseWithoutHint}`.trim() : objectiveWords;

  const normalize = (q: string) => tokenize(q).join(" ");
  const queries = [primary, secondary].map((q) => q.slice(0, 160).trim()).filter((q) => q.length >= 2);
  const unique = queries.filter((q, i) => queries.findIndex((other) => normalize(other) === normalize(q)) === i);
  return unique.length > 0 ? unique : ["AI infrastructure startups funding"];
}

const PRICING_FACTS = new Set(["plan", "starting_price_usd", "monthly_price_usd", "pricing_model", "seat_minimum", "change_since_last"]);
const PRICING_WORDS = /\b(pricing|prices?|competitors?|packaging)\b/;

/** Named vendors matter for pricing / competitor jobs; a funding tracker naming a company is not a vendor list. */
function namedVendorsFor(kind: JobContext["kind"], spec: JobSpec, fields: readonly string[]): string[] {
  if (kind !== "company") return [];
  const pricingJob = PRICING_WORDS.test(specText(spec)) || fields.some((f) => PRICING_FACTS.has(canonicalField("company", f) ?? ""));
  return pricingJob ? specVendorNames(spec) : [];
}

/** "compare Notion, Coda and Airtable pricing plans" — list form, so the simulated search can read the names back. */
function vendorQuery(names: readonly string[]): string {
  const picked: string[] = [];
  for (const n of names) {
    if (`compare ${joinList([...picked, n])} pricing plans`.length > 160) break;
    picked.push(n);
  }
  return `compare ${joinList(picked.length > 0 ? picked : names.slice(0, 1))} pricing plans`;
}

function pickDataset(kind: JobContext["kind"], spec: JobSpec): SampleDataset | null {
  if (kind === "feedback") return "customer_feedback";
  if (kind === "ticket") return "support_tickets";
  if (kind === "company") return "funding_rounds";
  if (kind === "expense") return null;
  const text = specText(spec);
  if (/\bticket/.test(text)) return "support_tickets";
  if (FEEDBACK_NOUN.test(text)) return "customer_feedback";
  return "funding_rounds";
}

const SOFTWARE_SPEND = /\b(saas|software|subscriptions?|licen[cs]es?|seats?|tools? we (pay|use)|apps? we pay)\b/;

/** Category names (feedback or ticket vocabulary) the spec text mentions — a soft prioritisation signal. */
function specFocusFor(kind: JobContext["kind"], spec: JobSpec): string[] {
  if (kind !== "feedback" && kind !== "ticket") return [];
  const stems = new Set(tokenize(specText(spec)).map(stem));
  const categories: readonly string[] = kind === "feedback" ? FEEDBACK_CATEGORIES : TICKET_CATEGORIES;
  return categories.filter((c) => c.split("_").every((part) => stems.has(stem(part))));
}

/**
 * One-off instructions arrive structurally (`input.instructions`); when that list is empty we also look at the
 * `## instructions` section of the first user message, so the brain still honours "top 5" if a runtime only
 * renders them into the prompt.
 */
export function collectInstructions(input: MockAgentTurnInput): string[] {
  const structured = (input.instructions ?? []).filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  if (structured.length > 0) return structured;
  const section = parseAgentInput(input.messages, ["instructions"]).sections.instructions;
  if (!section) return [];
  const json = findFirstJson(section, "array");
  if (Array.isArray(json)) return json.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  return section
    .split("\n")
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"));
}

export function buildJobContext(input: MockAgentTurnInput): JobContext {
  const { spec, component } = input;
  const family = input.jobFamily ?? spec.jobFamily;
  const kind = inferKind(family, spec);
  const specFields = spec.deliverable.fields.map((f) => f.name).filter((n) => n.trim().length > 0);
  const fields = specFields.length > 0 ? specFields : [...(family === "lead_research" ? LEAD_FIELDS : DEFAULT_FIELDS[kind])];
  const required = spec.deliverable.fields.filter((f) => f.required).map((f) => f.name);
  const instructions = collectInstructions(input);
  const directives = parseOneOffInstructions(instructions);
  const vague = hasVagueInstructions(component.instructions);
  const queries = buildQueries(spec, kind, family, directives);
  const namedVendors = namedVendorsFor(kind, spec, fields);
  return {
    fields,
    requiredFields: required.length > 0 ? required : fields,
    kind,
    directives,
    specFocus: specFocusFor(kind, spec),
    vague,
    tier: component.modelTier,
    count: desiredRecordCount({ explicit: directives.count, target: spec.deliverable.targetCount ?? DEFAULT_TARGET_COUNT, vague }),
    seed: hashSeed(`${component.id}|${spec.title}`),
    // Named vendors get their own first query; the focus query (if any) is kept, the objective query yields.
    queries: namedVendors.length > 0 ? [vendorQuery(namedVendors), ...queries.slice(0, directives.focusTerms.length > 0 ? 2 : 1)] : queries,
    relevanceQuery: queries[0] ?? "",
    namedVendors,
    dataset: pickDataset(kind, spec),
    constraints: constraintsForSpec(spec, instructions),
    expenseScope: kind !== "expense" ? "all" : SOFTWARE_SPEND.test(specText(spec)) ? "software" : /\binvoices?\b/.test(specText(spec)) ? "invoices" : "all",
  };
}
