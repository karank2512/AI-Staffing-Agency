import { normalizeKey } from "./text";

/**
 * Field-name resolution. Job specs name their fields however the customer (or the scoping LLM) phrased them —
 * `company`, `company_name`, `startup`, `round_size`, `amount_usd` … — so both `extractRecords` and the mock
 * brain map requested names onto a small set of CANONICAL facts per entity kind. Unknown names resolve to
 * `null` (a real extractor can't invent a field either).
 */

export type EntityKind = "company" | "feedback" | "ticket";

type SynonymTable = Record<string, readonly string[]>;

const COMPANY: SynonymTable = {
  company: ["company", "name", "company_name", "startup", "startup_name", "organization", "organisation", "org", "account", "account_name", "vendor", "competitor", "competitor_name", "business", "provider"],
  website: ["website", "domain", "homepage", "company_url", "company_website", "site", "web", "website_url"],
  source_url: ["source_url", "url", "source", "link", "article_url", "reference", "citation", "source_link", "news_url", "evidence_url"],
  category: ["category", "sector", "segment", "vertical", "subcategory", "sub_category", "industry", "space", "market", "focus_area", "type"],
  description: ["description", "summary", "what_they_do", "about", "overview", "product", "one_liner", "tagline", "blurb", "product_description", "positioning"],
  stage: ["stage", "round", "funding_stage", "round_type", "funding_round", "series", "last_round"],
  amount_usd: ["amount_usd", "amount", "round_size", "round_size_usd", "funding_amount", "funding_amount_usd", "raised", "raised_usd", "amount_raised", "amount_raised_usd", "funding", "funding_usd", "deal_size", "deal_size_usd", "last_round_amount_usd"],
  amount_label: ["amount_label", "amount_display", "amount_formatted", "round_size_label"],
  announced_on: ["announced_on", "date", "announced", "announcement_date", "announced_at", "funding_date", "round_date", "published_at", "published_on", "date_announced"],
  lead_investor: ["lead_investor", "investor", "investors", "lead", "led_by", "backers", "lead_investors"],
  hq: ["hq", "location", "headquarters", "city", "based_in", "hq_location", "hq_city"],
  country: ["country", "hq_country"],
  region: ["region", "geo", "geography"],
  employees: ["employees", "headcount", "team_size", "employee_count", "company_size", "size", "num_employees", "number_of_employees"],
  founded_year: ["founded", "founded_year", "year_founded"],
  notes: ["why_it_matters", "notes", "note", "insight", "highlights", "highlight", "comment", "comments", "rationale", "relevance", "takeaway", "key_insight", "analysis", "significance"],
  fit_reason: ["fit_reason", "why_now", "signal", "trigger", "trigger_event", "reason", "why", "buying_signal", "outreach_angle", "personalization"],
  contact_name: ["contact_name", "contact", "decision_maker", "person", "full_name", "lead_name", "buyer", "champion", "contact_person"],
  contact_title: ["contact_title", "title", "job_title", "role", "position", "contact_role"],
  contact_email: ["contact_email", "email", "work_email", "email_address"],
  linkedin_url: ["linkedin", "linkedin_url", "contact_linkedin", "profile_url"],
  fit_score: ["fit_score", "score", "icp_score", "lead_score", "priority_score", "relevance_score"],
  pricing_model: ["pricing_model", "pricing", "pricing_type", "billing_model", "price_model"],
  starting_price_usd: ["starting_price_usd", "starting_price", "price_usd", "price", "entry_price", "entry_price_usd", "monthly_price_usd", "lowest_price_usd"],
  free_tier: ["free_tier", "has_free_tier", "free_plan"],
  plans: ["plans", "plan_names", "tiers"],
  pricing_url: ["pricing_url", "pricing_page"],
  // Plan-level facts exist only on per-plan records (see entities.planFacts).
  plan: ["plan", "plan_name", "tier", "tier_name"],
  price_unit: ["price_unit", "unit", "billing_unit", "billing_period"],
  plan_includes: ["includes", "features", "included", "plan_features"],
};

const FEEDBACK: SynonymTable = {
  id: ["id", "feedback_id", "item_id", "ref", "reference_id"],
  customer: ["customer", "customer_name", "account", "account_name", "company", "company_name", "name", "user", "organization"],
  plan: ["plan", "tier", "customer_plan", "plan_tier", "subscription", "segment"],
  channel: ["channel", "source", "origin", "feedback_channel", "source_channel"],
  text: ["text", "feedback", "feedback_text", "quote", "comment", "verbatim", "message", "content", "body", "excerpt", "raw_text", "original_text"],
  received_on: ["received_on", "date", "received_at", "created_at", "created_on", "submitted_on", "submitted_at", "timestamp"],
  category: ["category", "theme", "topic", "area", "label", "tag", "product_area", "feature_area", "bucket", "type"],
  sentiment: ["sentiment", "tone", "polarity"],
  sentiment_score: ["sentiment_score"],
  severity: ["severity", "priority", "urgency", "impact", "importance"],
  summary: ["summary", "short_summary", "gist", "headline", "description", "title"],
  suggested_action: ["suggested_action", "recommendation", "next_step", "action", "recommended_action", "follow_up"],
  owner_team: ["owner", "owner_team", "team", "route_to", "assignee_team"],
};

const TICKET: SynonymTable = {
  id: ["id", "ticket_id", "ref", "ticket", "ticket_number"],
  subject: ["subject", "title", "summary", "headline", "short_summary"],
  body: ["body", "text", "description", "message", "content", "details", "ticket_text"],
  customer: ["customer", "customer_name", "account", "account_name", "company", "requester", "name", "organization"],
  plan: ["plan", "tier", "customer_plan", "subscription"],
  channel: ["channel", "source", "origin"],
  created_on: ["created_on", "date", "created_at", "opened_on", "opened_at", "received_on", "timestamp"],
  status: ["status", "state"],
  category: ["category", "type", "topic", "issue_type", "label", "tag", "theme", "area", "classification"],
  priority: ["priority", "severity", "urgency", "impact"],
  sentiment: ["sentiment", "tone"],
  team: ["team", "route_to", "assignee_team", "owner", "owner_team", "queue", "routing", "assigned_team", "suggested_team", "department"],
  suggested_action: ["suggested_action", "next_step", "recommendation", "action", "recommended_action", "suggested_response"],
  sla_hours: ["sla_hours", "sla", "response_sla_hours"],
};

function invert(table: SynonymTable): Map<string, string> {
  const out = new Map<string, string>();
  for (const [canonical, names] of Object.entries(table)) {
    for (const n of names) if (!out.has(n)) out.set(n, canonical);
  }
  return out;
}

const LOOKUP: Record<EntityKind, Map<string, string>> = {
  company: invert(COMPANY),
  feedback: invert(FEEDBACK),
  ticket: invert(TICKET),
};

/** Prefixes spec authors add for clarity ("company_hq", "lead_email") that carry no extra meaning. */
const NOISE_PREFIX = /^(company|startup|customer|ticket|feedback|lead|record|item|round|funding)_/;

export function canonicalField(kind: EntityKind, field: string): string | null {
  const key = normalizeKey(field);
  const table = LOOKUP[kind];
  const direct = table.get(key);
  if (direct) return direct;
  const stripped = key.replace(NOISE_PREFIX, "");
  return stripped !== key ? (table.get(stripped) ?? null) : null;
}

export function resolveField(kind: EntityKind, facts: Record<string, unknown>, field: string): unknown {
  const canonical = canonicalField(kind, field);
  if (!canonical) return null;
  const value = facts[canonical];
  return value === undefined ? null : value;
}

/** One flat record with EXACTLY the requested keys, in the requested order. */
export function buildRecord(kind: EntityKind, facts: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const f of fields) record[f] = resolveField(kind, facts, f);
  return record;
}

/** Share of `fields` this entity kind can answer — used to guess what a spec is about. */
export function kindAffinity(kind: EntityKind, fields: readonly string[]): number {
  if (fields.length === 0) return 0;
  return fields.filter((f) => canonicalField(kind, f) !== null).length / fields.length;
}

/** First key of `record` that means `canonical` for this kind (e.g. "round_size" for amount_usd). */
export function findFieldKey(kind: EntityKind, keys: readonly string[], canonical: string): string | undefined {
  return keys.find((k) => canonicalField(kind, k) === canonical);
}
