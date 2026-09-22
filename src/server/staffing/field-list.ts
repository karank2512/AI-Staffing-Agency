import type { JobFamily, SpecField } from "@/server/domain";
import { toSnakeCase } from "./cues";

/**
 * Reads the columns a customer asked for ("Give me a CSV with company, website, funding stage, headcount and a
 * one-line reason each is a good fit") and maps each phrase onto the snake_case field name the rest of the
 * platform understands — the same vocabulary the simulated tools resolve (simulation/fields.ts), and what
 * real sources tend to call these things. PURE and deterministic.
 */

type Kind = "company" | "feedback" | "ticket" | "finance" | "content";

interface FieldPhrase {
  re: RegExp;
  /** The spec field name; a function keeps the customer's own word when it is also a known synonym. */
  name: string | ((item: string) => string);
  /** How a responsibility line names it ("a one-line fit reason"). */
  label: string;
  description: string;
  /** Default true: a column the customer asked for must be filled. */
  required?: boolean;
  /** Other names for the same fact, so a template field is recognised as the same column. */
  aliases?: string[];
}

const COMPANY_PHRASES: readonly FieldPhrase[] = [
  { re: /\b(?:reasons?|why)\b.*\bfits?\b|\bfit reasons?\b|\bwhy now\b|\bbuying signals?\b|\btrigger(?: event)?s?\b|\bwhy (?:they|it) (?:matter|qualif)/, name: "fit_reason", label: "a one-line fit reason", description: "One-sentence reason this company is a good fit right now", aliases: ["reason", "why_now", "signal", "why_they_fit"] },
  { re: /\b(?:fit|icp|lead)\s+scores?\b|^scores?$/, name: "fit_score", label: "a fit score", description: "Fit score from 1 to 100", aliases: ["score", "icp_score", "lead_score"] },
  { re: /\blinked ?in\b/, name: "linkedin_url", label: "a LinkedIn profile", description: "Contact's LinkedIn profile, if published", required: false, aliases: ["linkedin"] },
  { re: /\be-?mails?\b/, name: "contact_email", label: "a published work email", description: "Published work email — never guessed", required: false, aliases: ["email", "work_email"] },
  { re: /\bopen (?:roles|positions|jobs)\b|\bjob (?:openings|posts?|postings)\b|\broles? (?:they(?:'re| are) )?hiring\b/, name: "open_roles", label: "the roles they are hiring for", description: "Roles the company is hiring for", required: false },
  { re: /\b(?:job )?titles?\b|\broles?\b|\bpositions?\b/, name: "contact_title", label: "their title", description: "The contact's title", aliases: ["title", "job_title", "role"] },
  { re: /\bdecision[- ]makers?\b|\bcontacts?\b|\bcontact names?\b|\bbuyers?\b|\bchampions?\b|\bpoint of contact\b|\bperson to (?:contact|reach)\b/, name: "contact_name", label: "the decision-maker", description: "Most relevant decision-maker", aliases: ["contact", "decision_maker"] },
  { re: /\bpricing (?:pages?|urls?|links?)\b/, name: "pricing_url", label: "the pricing page", description: "Pricing page URL", aliases: ["pricing_page"] },
  { re: /\bpricing models?\b|\bbilling models?\b|\bhow (?:it|they) (?:is|are) priced\b/, name: "pricing_model", label: "the pricing model", description: "How it is priced (per seat, usage, flat…)" },
  { re: /\bseat minimums?\b|\bminimum (?:number of )?seats\b|\bmin(?:imum)? seats?\b/, name: "seat_minimum", label: "the seat minimum", description: "Minimum number of seats a plan requires", required: false },
  { re: /\bchanges?\b|\bwhat changed\b|\bdiffs?\b|\bsince last\b/, name: "change_since_last", label: "any change since the last run", description: "What changed since the previous run (new plan, price move, none)", required: false },
  { re: /\bplan names?\b|\beach plan\b|^plan$/, name: "plan_name", label: "the plan name", description: "Plan name as the vendor lists it", aliases: ["plan", "tier_name"] },
  { re: /\bfree (?:tiers?|plans?|trials?)\b/, name: "free_tier", label: "whether there is a free tier", description: "Whether a free plan exists", required: false },
  { re: /^(?:plans|tiers|packages)$|\bplans offered\b/, name: "plans", label: "the plans offered", description: "Plan names as the vendor lists them", required: false },
  { re: /\bstarting prices?\b|\bentry prices?\b|\blowest prices?\b/, name: "starting_price_usd", label: "the starting price", description: "Lowest published price per month in USD", required: false },
  { re: /\bprices?\b|\bpricing\b|\bcosts?\b/, name: "monthly_price_usd", label: "the monthly price", description: "Monthly list price in USD (empty when the vendor says “contact sales”)", required: false, aliases: ["price", "price_usd", "monthly_price"] },
  { re: /\b(?:funding\s+)?stages?\b|\bround types?\b|\bseries\b|^rounds?$/, name: (item) => (/\bfunding stage/.test(item) ? "funding_stage" : "stage"), label: "the funding stage", description: "Funding stage (Seed, Series A…)", aliases: ["stage", "funding_stage", "round", "round_type"] },
  { re: /\b(?:dates?|announced|announcement|when)\b/, name: "announced_on", label: "the announcement date", description: "Announcement date (YYYY-MM-DD)", aliases: ["date", "announcement_date"] },
  { re: /\bamounts?\b|\bround sizes?\b|\bhow much\b|\braised\b|\braise\b|\btotal funding\b|\bfunding\b/, name: "amount_usd", label: "the round size", description: "Round size in USD", aliases: ["amount", "round_size", "funding_amount"] },
  { re: /\binvestors?\b|\bwho led\b|\bbackers?\b|\bled by\b/, name: "lead_investor", label: "the lead investor", description: "Lead investor", aliases: ["investor", "investors"] },
  { re: /\bheadcount\b|\bemployees?\b|\bemployee counts?\b|\bteam sizes?\b|\bcompany sizes?\b|^sizes?$|\bstaff\b/, name: "headcount", label: "headcount", description: "Approximate number of employees", aliases: ["employees", "team_size", "employee_count"] },
  { re: /\bwebsites?\b|\bdomains?\b|\bhomepages?\b|\bcompany urls?\b|^sites?$/, name: "website", label: "website", description: "Company website", aliases: ["domain", "homepage"] },
  { re: /\bsources?\b|\blinks?\b|\burls?\b|\bcitations?\b|\breferences?\b|\bevidence\b/, name: "source_url", label: "a source link", description: "Where the facts were found, so every row can be checked", aliases: ["source", "url", "link"] },
  { re: /\bpositioning\b|\bmessaging\b|\btaglines?\b/, name: "positioning", label: "the positioning", description: "How the vendor positions the product" },
  { re: /\bcategor(?:y|ies)\b|\bsectors?\b|\bsegments?\b|\bverticals?\b|\bindustr(?:y|ies)\b|\bspace\b/, name: "category", label: "the category", description: "Sub-category or segment", aliases: ["sector", "segment", "industry", "vertical"] },
  { re: /\bdescriptions?\b|\bwhat (?:they|it) do(?:es)?\b|\bone-liners?\b|\boverview\b|\bsummar(?:y|ies)\b/, name: "description", label: "what they do", description: "One line on what the company does", aliases: ["summary", "about"] },
  { re: /\bhq\b|\bheadquarters\b|\blocations?\b|\bcit(?:y|ies)\b|\bbased\b/, name: "hq", label: "HQ", description: "Headquarters city", aliases: ["location", "headquarters", "city"] },
  { re: /\bcountr(?:y|ies)\b/, name: "country", label: "country", description: "Country" },
  { re: /\bregions?\b|\bgeograph/, name: "region", label: "region", description: "Region" },
  { re: /\bfounded\b|\byear founded\b/, name: "founded_year", label: "the year founded", description: "Year founded", aliases: ["founded"] },
  { re: /\bcompetitors?\b|\brivals?\b/, name: "competitor", label: "the competitor", description: "Competitor name", aliases: ["company", "vendor"] },
  { re: /\bvendors?\b|\bproducts?\b|\btools?\b/, name: "vendor", label: "the vendor", description: "Vendor or product name", aliases: ["company", "product"] },
  { re: /\bcompan(?:y|ies)(?: names?)?\b|\bstartups?\b|\baccounts?\b|\borgani[sz]ations?\b|\bbusiness(?:es)?\b|^names?$/, name: "company", label: "company", description: "Company name", aliases: ["company_name", "name", "account", "startup"] },
  { re: /\bnotes?\b|\bwhy it matters\b|\binsights?\b|\bcomments?\b|\bhighlights?\b|\brelevance\b|\bsignificance\b/, name: "notes", label: "a note on why it matters", description: "Why this record matters", required: false, aliases: ["why_it_matters", "insight"] },
];

const FEEDBACK_PHRASES: readonly FieldPhrase[] = [
  { re: /\bids?\b|\breferences?\b|^refs?$/, name: "id", label: "the item id", description: "Feedback item id", aliases: ["feedback_id", "item_id"] },
  { re: /\bsuggested actions?\b|\bnext steps?\b|\brecommend|\bactions?\b|\bwhat to do\b|\bfix(?:es)?\b/, name: "suggested_action", label: "a suggested action", description: "What the team should do about it", aliases: ["recommendation", "next_step", "action"] },
  { re: /\bthemes?\b/, name: "theme", label: "the theme", description: "Primary theme", aliases: ["category", "topic"] },
  { re: /\bcategor(?:y|ies)\b|\btopics?\b|\bareas?\b|\btags?\b|\blabels?\b/, name: "category", label: "the category", description: "Primary theme", aliases: ["theme", "topic"] },
  { re: /\bsentiment\b|\btone\b/, name: "sentiment", label: "sentiment", description: "positive / neutral / negative" },
  { re: /\bseverity\b|\bpriority\b|\burgency\b|\bimpact\b/, name: "severity", label: "severity", description: "low / medium / high business impact", aliases: ["priority", "urgency"] },
  { re: /\bsummar(?:y|ies)\b|\bgist\b|\bheadlines?\b|\bone[- ]line\b/, name: "summary", label: "a one-line summary", description: "One-line summary", required: false },
  { re: /\bverbatims?\b|\bquotes?\b|\boriginal (?:text|wording)\b|\bfeedback(?: text)?\b|\btext\b|\bcomments?\b/, name: "text", label: "the original wording", description: "The feedback itself, verbatim", aliases: ["feedback", "verbatim", "quote"] },
  { re: /\bcustomers?\b|\baccounts?\b|\bcompan(?:y|ies)\b|\busers?\b/, name: "customer", label: "the customer", description: "Customer or account", aliases: ["account", "company"] },
  { re: /\bplans?\b|\btiers?\b|\bsubscriptions?\b/, name: "plan", label: "their plan", description: "Customer's plan", required: false },
  { re: /\bchannels?\b|\bsources?\b|\bwhere it came from\b/, name: "channel", label: "the channel", description: "Where the feedback came from", required: false, aliases: ["source"] },
  { re: /\bdates?\b|\bwhen\b|\breceived\b/, name: "received_on", label: "the date", description: "Date received (YYYY-MM-DD)", required: false, aliases: ["date"] },
  { re: /\bowners?\b|\bteams?\b/, name: "owner_team", label: "the owning team", description: "Team that should own it", required: false, aliases: ["team", "owner"] },
];

const TICKET_PHRASES: readonly FieldPhrase[] = [
  { re: /\b(?:ticket )?ids?\b|\bticket (?:numbers?|#)\b|\breferences?\b|^refs?$/, name: "id", label: "the ticket id", description: "Ticket id", aliases: ["ticket_id"] },
  { re: /\bsla\b|\bresponse times?\b|\bdue\b|\bdeadlines?\b/, name: "sla_hours", label: "the response SLA", description: "Response SLA in hours (lower is more urgent)", required: false, aliases: ["sla"] },
  { re: /\bsuggested (?:actions?|repl(?:y|ies)|responses?)\b|\bnext steps?\b|\bfirst actions?\b|\bwhat to do\b|\bactions?\b/, name: "suggested_action", label: "a suggested next step", description: "One-sentence next step for the agent", aliases: ["next_step", "action"] },
  { re: /\bsubjects?\b|\btitles?\b|\bheadlines?\b/, name: "subject", label: "the subject", description: "Ticket subject", aliases: ["title"] },
  { re: /\bpriorit(?:y|ies)\b|\bseverity\b|\burgency\b/, name: "priority", label: "a priority", description: "low / normal / high / urgent", aliases: ["severity", "urgency"] },
  { re: /\bteams?\b|\bqueues?\b|\bowners?\b|\broute\b|\brouting\b|\bassignees?\b|\bdepartments?\b/, name: "team", label: "the owning team", description: "Team that should own it", aliases: ["queue", "owner", "route_to"] },
  { re: /\bcategor(?:y|ies)\b|\btypes?\b|\btopics?\b|\bissue types?\b|\blabels?\b/, name: "category", label: "a category", description: "Ticket category", aliases: ["type", "issue_type"] },
  { re: /\bsentiment\b|\btone\b/, name: "sentiment", label: "sentiment", description: "Customer sentiment", required: false },
  { re: /\bstatus\b|\bstates?\b/, name: "status", label: "status", description: "Ticket status", required: false },
  { re: /\bchannels?\b|\bsources?\b/, name: "channel", label: "the channel", description: "Where the ticket came in", required: false },
  { re: /\bplans?\b|\btiers?\b/, name: "plan", label: "the customer's plan", description: "Customer's plan", required: false },
  { re: /\bdates?\b|\bcreated\b|\bopened\b|\bwhen\b/, name: "created_on", label: "the date", description: "Date opened (YYYY-MM-DD)", required: false, aliases: ["date"] },
  { re: /\bcustomers?\b|\baccounts?\b|\brequesters?\b|\bcompan(?:y|ies)\b/, name: "customer", label: "the customer", description: "Customer or account", required: false, aliases: ["account", "requester"] },
  { re: /\bbody\b|\bdescriptions?\b|\bdetails\b|\bmessages?\b|\btext\b/, name: "body", label: "the ticket text", description: "Ticket body", required: false, aliases: ["description", "text"] },
];

const FINANCE_PHRASES: readonly FieldPhrase[] = [
  { re: /\b(?:transaction|invoice) (?:ids?|numbers?|#)\b|\bids?\b|\breferences?\b/, name: "transaction_id", label: "the transaction id", description: "Transaction or invoice id", aliases: ["invoice_id", "id", "reference"] },
  { re: /\bflag reasons?\b|\bwhy (?:it was )?flagged\b|\bexceptions?\b|\breasons?\b/, name: "flag_reason", label: "why it was flagged", description: "Why it was flagged, if it was", required: false },
  { re: /\bvendors?\b|\bsuppliers?\b|\bpayees?\b|\bcounterpart(?:y|ies)\b|\bmerchants?\b/, name: "vendor", label: "the vendor", description: "Vendor or counterparty", aliases: ["supplier", "payee", "merchant"] },
  { re: /\bamounts?\b|\btotals?\b|\bcosts?\b|\bspend\b|\bvalues?\b/, name: "amount_usd", label: "the amount", description: "Amount in USD", aliases: ["amount", "total"] },
  { re: /\bdates?\b|\bwhen\b/, name: "date", label: "the date", description: "Transaction date (YYYY-MM-DD)", required: false, aliases: ["transaction_date"] },
  { re: /\bcategor(?:y|ies)\b|\bgl codes?\b|\baccount codes?\b|\bcost cent(?:er|re)s?\b/, name: "category", label: "a spend category", description: "Spend category", aliases: ["gl_code", "cost_center"] },
  { re: /\bstatus\b|\bflagged\b|\bflags?\b/, name: "status", label: "a status", description: "ok / flagged", aliases: ["flag"] },
  { re: /\bnotes?\b|\bcomments?\b/, name: "notes", label: "notes", description: "Anything the reviewer should know", required: false },
  { re: /\bsources?\b|\blinks?\b|\burls?\b/, name: "source_url", label: "a link to the source document", description: "Link to the source document", required: false },
];

const CONTENT_PHRASES: readonly FieldPhrase[] = [
  { re: /\btakeaways?\b|\bkey points?\b|\binsights?\b|\bquotes?\b/, name: "takeaway", label: "the key takeaway", description: "The specific point worth citing", required: false },
  { re: /\brelevance\b|\bwhy it matters\b/, name: "relevance", label: "why it matters", description: "Why it matters for the objective", required: false },
  { re: /\bsources?\b|\blinks?\b|\burls?\b|\bcitations?\b|\breferences?\b/, name: "source_url", label: "a source link", description: "Source URL", aliases: ["url", "link"] },
  { re: /\btitles?\b|\bheadlines?\b|^names?$/, name: "title", label: "a title", description: "Title", aliases: ["headline", "name"] },
  { re: /\bsummar(?:y|ies)\b|\bgist\b|\bdescriptions?\b|\bone[- ]line\b/, name: "summary", label: "a one-line summary", description: "One-line summary", aliases: ["description"] },
  { re: /\bdates?\b|\bpublished\b|\bwhen\b/, name: "published_on", label: "the date", description: "Publication date (YYYY-MM-DD)", required: false, aliases: ["date"] },
  { re: /\bcategor(?:y|ies)\b|\btopics?\b|\bthemes?\b/, name: "category", label: "a topic", description: "Topic", required: false, aliases: ["topic", "theme"] },
];

const PHRASES: Record<Kind, readonly FieldPhrase[]> = {
  company: COMPANY_PHRASES,
  feedback: FEEDBACK_PHRASES,
  ticket: TICKET_PHRASES,
  finance: FINANCE_PHRASES,
  content: CONTENT_PHRASES,
};

export function kindOf(family: JobFamily): Kind {
  switch (family) {
    case "lead_research":
    case "market_research":
    case "market_analysis":
      return "company";
    case "feedback_analysis":
      return "feedback";
    case "support_triage":
      return "ticket";
    case "finance_ops":
      return "finance";
    default:
      return "content";
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

interface Cue {
  re: RegExp;
  strong: boolean;
}

const CUES: readonly Cue[] = [
  { re: /\b(?:csv|spreadsheet|sheet|table|list|report|file|export|database|tracker|rows?|records?|entry|entries)s?\s+(?:with|including|containing|listing|that (?:has|have|includes?|lists?))\s+(?:(?:the\s+)?(?:following\s+)?(?:columns?|fields?)\s*:?\s*)?/gi, strong: true },
  { re: /\bwith (?:the )?(?:following |these )?(?:columns?|fields?)\s*:?\s*/gi, strong: true },
  { re: /\b(?:columns?|fields?)\s*(?::|—|–|such as|like|including)\s*/gi, strong: true },
  { re: /\bfor (?:each|every) (?:[\w-]+\s+){0,3}?(?:capture|include|list|record|give me|get|note|collect|pull|return|provide|track|grab|add|show)\s+/gi, strong: true },
  { re: /\b(?:capture|collect|extract|grab)\s+(?:the\s+)?(?:(?:following|these)\s*:?\s*)?/gi, strong: true },
  { re: /\b(?:each|every one) with\s+/gi, strong: false },
  { re: /\b(?:including|containing|with)\s+/gi, strong: false },
];

const WEAK_MAX_WORDS = 4;
const ITEM_SPLIT = /\s*[,;]\s*|\s+(?:and|&|plus|as well as)\s+|\s+\/\s+/;
const STOP_ITEM =
  /^(?:and\s+)?(?:then\s+)?(?:rank|write|send|email|deliver(?:ed)?|sort(?:ed)?|ranked|summari[sz]e|highlight|flag|post|share|tell|give|make|put|create|produce|compile|export|track|find|search|build|group|order|drop|remove|mark|prioriti[sz]e|keep|use|so|every|each (?:week|day|morning|month)|which|that|as an?|in an?|into|for (?:our|my) (?:team|crm)|we|i)\b|^(?:weekly|daily|monthly|hourly)$/i;
const LEAD_NOISE =
  /^(?:and|or|plus|also|then|the|a|an|their|its|his|her|each(?: company(?:'s)?)?|every|any|the company(?:'s)?|company's|one[- ]line|short|brief|optional(?:ly)?|likely|main|key|current|latest|a short|a brief)\s+/i;
const TRAIL_NOISE =
  /\s+(?:for (?:each|every)(?:\s+\w+)?|per (?:company|lead|item|record|row|account|round|vendor|competitor|plan|ticket)|of each(?:\s+\w+)?|if (?:any|available|known|published|possible)|where (?:available|possible)|each|too)$/i;

function cleanItem(raw: string): string {
  let item = raw.toLowerCase().replace(/[“”"()]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = item.replace(LEAD_NOISE, "").replace(TRAIL_NOISE, "").trim();
    if (next === item) break;
    item = next;
  }
  return item;
}

function segmentAfter(text: string, from: number): string {
  const rest = text.slice(from);
  const end = rest.search(/[.!?](?:\s|$)|\n|\s[—–]\s/);
  return end === -1 ? rest : rest.slice(0, end);
}

export interface ParsedField {
  field: SpecField;
  label: string;
  known: boolean;
  aliases: string[];
  /** Length of the customer's phrase, after filler words are removed. */
  words: number;
}

export interface ParsedFieldList {
  fields: ParsedField[];
  /** An explicit column list ("a CSV with A, B and C"): it replaces the template's fields. */
  strict: boolean;
}

function mapItem(item: string, kind: Kind): ParsedField | null {
  for (const phrase of PHRASES[kind]) {
    if (!phrase.re.test(item)) continue;
    const name = typeof phrase.name === "function" ? phrase.name(item) : phrase.name;
    return {
      field: { name, description: phrase.description, required: phrase.required ?? true },
      label: phrase.label,
      known: true,
      aliases: [name, ...(phrase.aliases ?? [])],
      words: item.split(" ").length,
    };
  }
  const words = item.split(" ").filter((w) => w.length > 0);
  if (words.length === 0 || words.length > 4 || item.length > 40) return null;
  const name = toSnakeCase(item);
  if (name.length < 2) return null;
  // Nothing this platform can look up by that name: ask for it, but do not drop records that lack it.
  return { field: { name, description: item.charAt(0).toUpperCase() + item.slice(1), required: false }, label: item, known: false, aliases: [name], words: words.length };
}

function itemsAt(text: string, from: number, kind: Kind): ParsedField[] {
  const out: ParsedField[] = [];
  for (const raw of segmentAfter(text, from).split(ITEM_SPLIT)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (STOP_ITEM.test(trimmed) || trimmed.split(/\s+/).length > 12) break;
    const item = cleanItem(trimmed);
    const parsed = mapItem(item, kind);
    if (parsed && !out.some((p) => p.field.name === parsed.field.name)) out.push(parsed);
  }
  return out;
}

/** The column list in a description, if it names one; null when it does not. */
export function parseFieldList(description: string, family: JobFamily): ParsedFieldList | null {
  const kind = kindOf(family);
  let best: ParsedFieldList | null = null;
  let bestScore = 0;
  for (const cue of CUES) {
    for (const m of description.matchAll(cue.re)) {
      const items = itemsAt(description, (m.index ?? 0) + m[0].length, kind);
      const known = items.filter((i) => i.known).length;
      const strict = cue.strong && ((items.length >= 3 && known >= 2) || (items.length >= 2 && known === items.length));
      // In passing ("…with a source for each") only short, recognisable columns count: a long clause that merely
      // contains a field word ("with a clear recommendation for our own pricing") is prose, not a column.
      const incidental = items.filter((i) => i.known && i.words <= WEAK_MAX_WORDS);
      const candidate: ParsedFieldList | null = strict ? { fields: items, strict: true } : incidental.length > 0 ? { fields: incidental, strict: false } : null;
      if (!candidate) continue;
      // An explicit list beats an incidental "with …"; among equals, the one that names more known columns.
      const score = (candidate.strict ? 100 : 0) + candidate.fields.filter((f) => f.known).length;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

/** The alias group a field name belongs to (so "stage" and "funding_stage" are the same column). */
export function aliasesOf(name: string, family: JobFamily): string[] {
  for (const phrase of PHRASES[kindOf(family)]) {
    const own = typeof phrase.name === "function" ? [] : [phrase.name];
    const names = [...own, ...(phrase.aliases ?? [])];
    if (names.includes(name)) return names;
  }
  return [name];
}
