import type { SimFeedbackItem } from "@/server/simulation/types";
import { companyEntities, type CompanyEntity } from "./fixtures/companies";
import { FEEDBACK_ACTIONS, feedbackItems, type FeedbackCategory } from "./fixtures/feedback";
import { companyPeople } from "./fixtures/people";
import { pricingFor, type PricingPlan } from "./fixtures/pricing";
import { TICKET_ROUTING, ticketItems, type SimTicket, type TicketCategory } from "./fixtures/tickets";
import type { EntityKind } from "./fields";
import { hashSeed, seededInt } from "./rng";
import { clip, escapeRegExp, formatUsdShort } from "./text";

/**
 * "Facts" = everything the simulation knows about one fixture entity, keyed by the canonical names in
 * fields.ts. Extraction and the mock brain build records by resolving requested field names against these.
 */

export type Facts = Record<string, unknown>;

export interface EntityRef {
  kind: EntityKind;
  /** Stable identity: company name / feedback id / ticket id (lower-cased). */
  key: string;
  facts: Facts;
}

const REGION_BY_COUNTRY: Record<string, string> = {
  "United States": "North America",
  Canada: "North America",
  "United Kingdom": "Europe",
  Germany: "Europe",
  France: "Europe",
  Sweden: "Europe",
  Switzerland: "Europe",
  Netherlands: "Europe",
  Ireland: "Europe",
  Israel: "Middle East",
  India: "Asia-Pacific",
  Singapore: "Asia-Pacific",
};

function countryOf(hq: string): string {
  const tail = hq.split(",").pop()?.trim() ?? hq;
  if (tail === "UK") return "United Kingdom";
  // "Austin, TX" / "Washington, DC" → any other two-letter code is a US state.
  return /^[A-Z]{2}$/.test(tail) ? "United States" : tail;
}

const STAGE_FIT_BONUS: Record<string, number> = { Seed: 0, "Series A": 8, "Series B": 12, "Series C": 6 };

export function companyFacts(c: CompanyEntity): Facts {
  const people = companyPeople(c.slug, c.group);
  const pricing = pricingFor(c);
  const amountLabel = formatUsdShort(c.amount_usd);
  const country = countryOf(c.hq);
  const categoryLower = c.category.toLowerCase();
  // Recently funded, mid-sized teams score highest: they have budget and are still choosing vendors.
  const fitScore = Math.min(98, 58 + seededInt(hashSeed(`${c.slug}|fit`), 0, 22) + (STAGE_FIT_BONUS[c.stage] ?? 0) + (c.daysAgo <= 21 ? 6 : 0));
  return {
    company: c.company,
    website: c.website,
    source_url: c.source_url,
    category: c.category,
    description: c.description,
    stage: c.stage,
    amount_usd: c.amount_usd,
    amount_label: amountLabel,
    announced_on: c.announced_on,
    lead_investor: c.lead_investor,
    hq: c.hq,
    country,
    region: REGION_BY_COUNTRY[country] ?? "Other",
    employees: c.employees,
    founded_year: 2019 + seededInt(hashSeed(`${c.slug}|founded`), 0, 4),
    notes: `${amountLabel} ${c.stage} led by ${c.lead_investor} — a signal of investor appetite for ${categoryLower}; ${c.company} now has about ${c.employees} people.`,
    fit_reason: `Raised a ${amountLabel} ${c.stage} ${c.daysAgo} days ago (led by ${c.lead_investor}) and is scaling a ~${c.employees}-person ${categoryLower} team — likely buying tooling now.`,
    contact_name: people.buyer.name,
    contact_title: people.buyer.title,
    contact_email: people.buyer.email,
    linkedin_url: people.buyer.linkedin_url,
    fit_score: fitScore,
    pricing_model: pricing.pricing_model,
    starting_price_usd: pricing.starting_price_usd,
    free_tier: pricing.free_tier,
    plans: pricing.plans.map((p) => p.name).join(", "),
    pricing_url: pricing.pricing_url,
  };
}

/** Per-plan variant used when a spec asks for plan-level pricing rows (one record per company × plan). */
export function planFacts(c: CompanyEntity, plan: PricingPlan): Facts {
  return {
    ...companyFacts(c),
    source_url: pricingFor(c).pricing_url,
    plan: plan.name,
    starting_price_usd: plan.price_usd,
    price_unit: plan.unit,
    plan_includes: plan.includes,
  };
}

const SENTIMENT_SCORE: Record<SimFeedbackItem["sentiment"], number> = { positive: 0.8, neutral: 0, negative: -0.7 };

function firstSentence(text: string, max = 110): string {
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  return clip((m ? m[0] : text).trim(), max);
}

export function feedbackFacts(f: SimFeedbackItem): Facts {
  const routing = FEEDBACK_ACTIONS[f.category as FeedbackCategory];
  return {
    id: f.id,
    customer: f.customer,
    plan: f.plan,
    channel: f.channel,
    text: f.text,
    received_on: f.received_on,
    category: f.category,
    sentiment: f.sentiment,
    sentiment_score: SENTIMENT_SCORE[f.sentiment],
    severity: f.severity,
    summary: firstSentence(f.text),
    suggested_action: routing?.action ?? null,
    owner_team: routing?.team ?? null,
  };
}

const SLA_HOURS: Record<SimTicket["priority"], number> = { urgent: 1, high: 4, normal: 24, low: 72 };

export function ticketFacts(t: SimTicket): Facts {
  return {
    id: t.id,
    subject: t.subject,
    body: t.body,
    customer: t.customer,
    plan: t.plan,
    channel: t.channel,
    created_on: t.created_on,
    status: t.status,
    category: t.category,
    priority: t.priority,
    sentiment: t.sentiment,
    team: t.team,
    suggested_action: TICKET_ROUTING[t.category as TicketCategory]?.action ?? null,
    sla_hours: SLA_HOURS[t.priority],
  };
}

interface Mention<T> {
  item: T;
  at: number;
}

/** Companies named in `text` (by name or by their `.example` host), in order of first mention. */
export function mentionedCompanies(text: string, companies: readonly CompanyEntity[]): CompanyEntity[] {
  const lower = text.toLowerCase();
  const hits: Array<Mention<CompanyEntity>> = [];
  for (const c of companies) {
    const byName = lower.search(new RegExp(`\\b${escapeRegExp(c.company.toLowerCase())}\\b`));
    const byHost = lower.indexOf(`${c.slug}.example`);
    const positions = [byName, byHost].filter((p) => p >= 0);
    if (positions.length > 0) hits.push({ item: c, at: Math.min(...positions) });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.item);
}

export const FEEDBACK_ID_RE = /\bFB-\d{4}\b/gi;
export const TICKET_ID_RE = /\bTCK-\d{4}\b/gi;

/** Distinct ids matching `pattern`, lower-cased, in order of first mention. */
export function mentionedIds(text: string, pattern: RegExp): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(pattern)) seen.add(m[0].toLowerCase());
  return [...seen];
}

/** Everything the simulation "knows", resolved against one clock reading. Build once per call. */
export class EntityIndex {
  readonly companies: CompanyEntity[];
  readonly feedback: SimFeedbackItem[];
  readonly tickets: SimTicket[];
  private readonly byKey = new Map<string, EntityRef>();

  constructor(now: Date) {
    this.companies = companyEntities(now);
    this.feedback = feedbackItems(now);
    this.tickets = ticketItems(now);
  }

  refs(kind: EntityKind): EntityRef[] {
    if (kind === "company") return this.companies.map((c) => this.companyRef(c));
    if (kind === "feedback") return this.feedback.map((f) => this.memo(`feedback:${f.id}`, () => ({ kind: "feedback", key: f.id.toLowerCase(), facts: feedbackFacts(f) })));
    return this.tickets.map((t) => this.memo(`ticket:${t.id}`, () => ({ kind: "ticket", key: t.id.toLowerCase(), facts: ticketFacts(t) })));
  }

  companyRef(c: CompanyEntity): EntityRef {
    return this.memo(`company:${c.slug}`, () => ({ kind: "company", key: c.company.toLowerCase(), facts: companyFacts(c) }));
  }

  /** Entities of `kind` mentioned in free text (page bodies, search snippets), in order of first mention. */
  mentioned(text: string, kind: EntityKind): EntityRef[] {
    if (kind === "company") return mentionedCompanies(text, this.companies).map((c) => this.companyRef(c));
    const ids = mentionedIds(text, kind === "feedback" ? FEEDBACK_ID_RE : TICKET_ID_RE);
    const byKey = new Map(this.refs(kind).map((r) => [r.key, r]));
    return ids.flatMap((id) => {
      const ref = byKey.get(id);
      return ref ? [ref] : [];
    });
  }

  /** Which fixture entity does this (tool-produced) record describe? Matches ids first, then company names. */
  identify(record: Record<string, unknown>): EntityRef | null {
    const strings = Object.values(record).filter((v): v is string => typeof v === "string");
    for (const s of strings) {
      const id = s.trim().toUpperCase();
      if (/^FB-\d+$/.test(id)) return this.refs("feedback").find((r) => r.key === id.toLowerCase()) ?? null;
      if (/^TCK-\d+$/.test(id)) return this.refs("ticket").find((r) => r.key === id.toLowerCase()) ?? null;
    }
    for (const s of strings) {
      const name = s.trim().toLowerCase();
      const hit = this.companies.find((c) => c.company.toLowerCase() === name);
      if (hit) return this.companyRef(hit);
    }
    return null;
  }

  private memo(key: string, make: () => EntityRef): EntityRef {
    let ref = this.byKey.get(key);
    if (!ref) {
      ref = make();
      this.byKey.set(key, ref);
    }
    return ref;
  }
}
