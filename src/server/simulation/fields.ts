import { normalizeKey } from "./text";

/**
 * Field-name resolution. Job specs name their fields however the customer (or the scoping LLM) phrased them —
 * `company`, `company_name`, `startup`, `round_size`, `amount_usd` … — so both `extractRecords` and the mock
 * brain map requested names onto a small set of CANONICAL facts per entity kind. Unknown names resolve to
 * `null` (a real extractor can't invent a field either).
 */

export type EntityKind = "company" | "feedback" | "ticket" | "expense";

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
  starting_price_usd: ["starting_price_usd", "starting_price", "price_usd", "price", "entry_price", "entry_price_usd", "lowest_price_usd"],
  // A MONTHLY figure only: usage-based prices (per GPU-hour, per 1M tokens …) leave it null — see pricing-facts.ts.
  monthly_price_usd: [
    "monthly_price_usd", "monthly_price", "price_per_month", "price_per_month_usd", "monthly_fee", "monthly_fee_usd", "monthly_cost",
    "monthly_cost_usd", "monthly_list_price", "monthly_list_price_usd", "list_price_monthly_usd", "per_month_usd",
  ],
  seat_minimum: ["seat_minimum", "minimum_seats", "min_seats", "seat_min", "seats_minimum", "minimum_seat_count", "min_seat_count"],
  change_since_last: [
    "change_since_last", "change", "changes", "what_changed", "change_since_last_week", "change_since_last_run", "changes_since_last",
    "price_change", "pricing_change", "delta",
  ],
  open_roles: ["open_roles", "open_positions", "job_openings", "openings", "open_jobs", "job_postings", "hiring_roles", "open_role_count", "number_of_open_roles", "roles_open"],
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

/** Spend ledger lines (finance ops): subscriptions, invoices and card charges. */
const EXPENSE: SynonymTable = {
  id: ["id", "transaction_id", "txn_id", "transaction", "line_id", "reference", "ref", "charge_id", "record_id"],
  invoice_number: ["invoice_id", "invoice_number", "invoice_no", "invoice"],
  date: ["date", "transaction_date", "posted_on", "posted_at", "charged_on", "billed_on", "invoice_date", "paid_on", "created_on", "charge_date"],
  vendor: ["vendor", "vendor_name", "supplier", "merchant", "payee", "company", "tool", "tool_name", "app", "application", "service", "provider", "name", "software"],
  product: ["product", "description", "item", "line_item", "plan", "service_description", "what"],
  category: ["category", "spend_category", "expense_category", "type", "gl_account", "account", "subcategory", "spend_type"],
  amount_usd: ["amount_usd", "amount", "total", "total_usd", "cost", "cost_usd", "monthly_cost", "monthly_cost_usd", "spend", "spend_usd", "price", "charge", "value", "monthly_spend"],
  billing_cycle: ["billing_cycle", "billing_period", "frequency", "billing_frequency", "cadence", "term"],
  owner: ["owner", "budget_owner", "requester", "employee", "cardholder", "purchaser", "requested_by", "contact", "owner_name"],
  team: ["team", "department", "cost_center", "business_unit", "owner_team"],
  seats: ["seats", "licenses", "licences", "seat_count", "purchased_seats", "total_seats"],
  active_seats: ["active_seats", "active_users", "seats_used", "used_seats", "users"],
  seat_utilization: ["utilization", "seat_utilization", "usage", "usage_rate", "utilization_pct"],
  renewal_date: ["renewal_date", "renews_on", "renewal", "next_renewal", "contract_end", "renewal_on", "renews"],
  payment_method: ["payment_method", "method", "card", "paid_with", "payment_type"],
  status: ["status", "state", "payment_status"],
  flag_reason: ["flag_reason", "flag", "flags", "exception", "exception_reason", "issue", "anomaly", "reason", "flagged_reason", "red_flag", "finding"],
  notes: ["notes", "note", "comment", "comments", "memo", "recommendation", "action", "next_step", "suggested_action", "recommended_action"],
  source_url: ["source_url", "url", "source", "link", "evidence_url"],
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
  expense: invert(EXPENSE),
};

/** Prefixes spec authors add for clarity ("company_hq", "lead_email") that carry no extra meaning. */
const NOISE_PREFIX = /^(company|startup|customer|ticket|feedback|lead|record|item|round|funding|expense|transaction|invoice|subscription)_/;

/** "monthly_subscription_price", "cost_per_month_usd" … — any monthly money column is the monthly price. */
const MONTHLY_MONEY = /(^|_)(month|monthly|mo)(_|$)/;
const MONEY_WORD = /(^|_)(price|cost|fee|fees|rate|pricing)(_|$)/;

export function canonicalField(kind: EntityKind, field: string): string | null {
  const key = normalizeKey(field);
  const table = LOOKUP[kind];
  const direct = table.get(key);
  if (direct) return direct;
  const stripped = key.replace(NOISE_PREFIX, "");
  const viaPrefix = stripped !== key ? (table.get(stripped) ?? null) : null;
  if (viaPrefix) return viaPrefix;
  return kind === "company" && MONTHLY_MONEY.test(key) && MONEY_WORD.test(key) ? "monthly_price_usd" : null;
}

export function resolveField(kind: EntityKind, facts: Record<string, unknown>, field: string): unknown {
  const canonical = canonicalField(kind, field);
  if (!canonical) return null;
  const value = facts[canonical];
  return value === undefined ? null : value;
}

/**
 * One flat record with EXACTLY the requested keys, in the requested order. When a monthly-price column stays
 * empty because the vendor bills per GPU-hour / per token / by contract, the notes column (if requested) says so.
 */
export function buildRecord(kind: EntityKind, facts: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const f of fields) record[f] = resolveField(kind, facts, f);
  if (kind === "company" && typeof facts.monthly_price_note === "string") {
    const monthly = fields.find((f) => canonicalField(kind, f) === "monthly_price_usd");
    const notes = fields.find((f) => canonicalField(kind, f) === "notes");
    if (monthly && notes && record[monthly] === null) record[notes] = facts.monthly_price_note;
  }
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
