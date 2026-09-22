/**
 * Readers over the customer's own words: where they want the worker to look (regions, stages, segments),
 * what they already said about volume, cadence, recipients and scope, and the core "object" of the job
 * ("Series A fintech companies in Europe that are hiring engineers"). The simulated scoper uses these to skip
 * questions the description already answers and to write a spec that echoes the request. PURE and deterministic.
 */

import { detectCadence, detectCount, extractEmails, mentionsSending } from "./cues";

// ── Facets ──────────────────────────────────────────────────────────────────

interface Geo {
  re: RegExp;
  label: string;
  adjective: string;
}

/** Ordered: longer names first so "North America" is not also read as "America". */
const GEOS: readonly Geo[] = [
  { re: /\bnorth americ(?:a|an)\b/i, label: "North America", adjective: "North American" },
  { re: /\blatin americ(?:a|an)\b|\bLATAM\b|\bLatAm\b/i, label: "Latin America", adjective: "Latin American" },
  { re: /\bmiddle east(?:ern)?\b/i, label: "the Middle East", adjective: "Middle Eastern" },
  { re: /\basia[- ]pacific\b|\bAPAC\b/, label: "APAC", adjective: "APAC" },
  { re: /\beurop(?:e|ean)\b|\bEMEA\b|\bEU\b/i, label: "Europe", adjective: "European" },
  { re: /\bUK\b|\bU\.K\.|\bunited kingdom\b|\bbritain\b|\bbritish\b/i, label: "the UK", adjective: "UK" },
  { re: /\bUS\b|\bUSA\b|\bU\.S\.|\bunited states\b/, label: "the US", adjective: "US" },
  { re: /\bnordics?\b|\bscandinavia(?:n)?\b/i, label: "the Nordics", adjective: "Nordic" },
  { re: /\bDACH\b/, label: "DACH", adjective: "DACH" },
  { re: /\bgerman(?:y)?\b/i, label: "Germany", adjective: "German" },
  { re: /\bfrance\b|\bfrench\b/i, label: "France", adjective: "French" },
  { re: /\bspain\b|\bspanish\b/i, label: "Spain", adjective: "Spanish" },
  { re: /\bnetherlands\b|\bdutch\b/i, label: "the Netherlands", adjective: "Dutch" },
  { re: /\bisrael(?:i)?\b/i, label: "Israel", adjective: "Israeli" },
  { re: /\bindia(?:n)?\b/i, label: "India", adjective: "Indian" },
  { re: /\bsingapore(?:an)?\b/i, label: "Singapore", adjective: "Singaporean" },
  { re: /\bjapan(?:ese)?\b/i, label: "Japan", adjective: "Japanese" },
  { re: /\baustralia(?:n)?\b/i, label: "Australia", adjective: "Australian" },
  { re: /\bcanad(?:a|ian)\b/i, label: "Canada", adjective: "Canadian" },
  { re: /\bbrazil(?:ian)?\b/i, label: "Brazil", adjective: "Brazilian" },
  { re: /\bafrica(?:n)?\b/i, label: "Africa", adjective: "African" },
  { re: /\basia(?:n)?\b/i, label: "Asia", adjective: "Asian" },
  { re: /\bglobal(?:ly)?\b|\bworldwide\b|\banywhere\b/i, label: "anywhere", adjective: "Global" },
];

const STAGE_RE = /\b(pre-?seed|seed(?:[- ]stage)?|series\s+[a-e](?:\s*(?:[-–]|to|or|and|\/)\s*(?:series\s+)?[a-e])?|growth[- ]stage|late[- ]stage|early[- ]stage)(?![\w-])/gi;

/** Industry and segment words a customer uses to say WHICH companies (lower-case, matched on word boundaries). */
const SEGMENT_WORDS = [
  "ai infrastructure", "ai infra", "generative ai", "machine learning", "vector databases", "vector database", "developer tools", "devtools",
  "data infrastructure", "b2b saas", "fintech", "healthtech", "health tech", "healthcare", "insurtech", "proptech", "edtech", "legaltech",
  "regtech", "climate tech", "climatetech", "cleantech", "biotech", "medtech", "cybersecurity", "security", "saas", "b2b", "b2c", "d2c",
  "e-commerce", "ecommerce", "marketplaces", "marketplace", "logistics", "supply chain", "robotics", "hardware", "semiconductors", "crypto",
  "web3", "gaming", "media", "retail", "real estate", "payments", "banking", "insurance", "hr tech", "martech", "adtech", "analytics",
  "open source", "open-source", "cloud", "gpu", "inference", "mobility", "automotive", "energy", "foodtech", "agtech", "defense", "govtech",
  "enterprise software", "llm", "llms",
] as const;
const SEGMENT_RE = new RegExp(`(?<![\\w-])(${[...SEGMENT_WORDS].sort((a, b) => b.length - a.length).map((w) => w.replace(/[-]/g, "[- ]?")).join("|")})(?![\\w-])`, "gi");
const AI_RE = /\bAI\b/;

const SIGNAL_RE = /\b(hiring(?:\s+(?:for\s+)?(?:an?\s+)?[a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)?|recently (?:funded|raised)|newly funded|just raised|raised (?:a|their|new)|launch(?:ed|ing)|expanding|opening (?:an )?office|job posts?)/gi;
const ROLE_RE = /\b(?:VP|Vice President|Head|Director|Chief [A-Z]\w+ Officer|CTO|CEO|CFO|COO|CMO|CIO|CRO|[Ff]ounders?|[Cc]o-?founders?|[Dd]ecision[- ]makers?)\b(?: of [A-Z][\w&]*(?: [A-Z][\w&]*)?)?/g;
const SIZE_RE = /\b\d{1,5}\s*(?:[-–]|to)\s*\d{1,5}\s*(?:employees|people|staff)\b|\b\d{1,5}\+?\s*(?:employees|people)\b|\b(?:smb|smbs|mid[- ]market|enterprise(?:s)?|small businesses)\b/gi;

export const KEEP_IN_WORKSPACE = /\b(just me|only me|in the workspace|workspace only|no(?:body| one) else|keep it here|i'?ll (?:import|download|pick it up))\b/i;

export interface DescriptionFacets {
  geos: Geo[];
  stages: string[];
  segments: string[];
  signals: string[];
  roles: string[];
  sizes: string[];
  count?: number;
  cadenceMentioned: boolean;
  emails: string[];
  sending: boolean;
  keepInWorkspace: boolean;
  /** Vendors the customer named ("(Notion, Coda, Airtable)", "such as Vectorloom and Latchkey AI"). */
  namedCompanies: string[];
}

function unique(values: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const clean = v.replace(/\s+/g, " ").trim();
    if (clean.length > 0 && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  return [...seen.values()];
}

function stageLabel(raw: string): string {
  const s = raw.toLowerCase().replace(/\s+/g, " ");
  if (/^pre-?seed/.test(s)) return "Pre-seed";
  if (/^seed/.test(s)) return "Seed";
  const series = /^series ([a-e])(?:\s*(?:[-–]|to|or|and|\/)\s*(?:series )?([a-e]))?/.exec(s);
  if (series) return series[2] ? `Series ${series[1].toUpperCase()}–${series[2].toUpperCase()}` : `Series ${series[1].toUpperCase()}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

const NOT_A_NAME = /^(?:and|or|the|our|my|we|i|series\b.*|seed|pre-?seed)$/i;
/** Only an unannounced list can be days of the week ("Monday, Wednesday and Friday"); "(…, Monday)" is a vendor. */
const WEEKDAY = /^(?:every|each|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?$/i;

/**
 * "(Notion, Coda, Airtable, ClickUp, Monday)", "such as Vectorloom and Latchkey AI", or a bare list of three or more
 * capitalised names ("the plans of Vectorloom, Latchkey AI and Kestrelflow") → the names. Regions are not vendors.
 */
export function namedCompanies(text: string): string[] {
  const NAME = "[A-Z][\\w.&-]*(?:\\s[A-Z][\\w.&-]*)?";
  const SEP = "\\s*(?:,|\\band\\b|&|\\bor\\b)\\s*(?:and\\s+)?";
  const cued = new RegExp(`(?:\\(|\\b(?:like|such as|including|namely|incl\\.)\\s+|:\\s*)(${NAME}(?:${SEP}${NAME})+)`, "g");
  const bare = new RegExp(`(?<=\\s)(${NAME}(?:\\s*,\\s*${NAME})+${SEP}${NAME})`, "g");
  const out: string[] = [];
  for (const re of [cued, bare]) {
    for (const m of text.matchAll(re)) {
      const names = m[1]
        .split(/\s*(?:,|\band\b|&|\bor\b)\s*/)
        .map((part) => part.trim())
        .filter((name) => name.length >= 2 && !NOT_A_NAME.test(name) && !GEOS.some((g) => g.re.test(name)) && !(re === bare && WEEKDAY.test(name)));
      if (re === bare && names.length < 3) continue;
      out.push(...names);
    }
  }
  return unique(out);
}

export function readFacets(text: string): DescriptionFacets {
  const geos: Geo[] = [];
  let rest = text;
  for (const geo of GEOS) {
    if (geo.re.test(rest)) {
      geos.push(geo);
      rest = rest.replace(new RegExp(geo.re.source, geo.re.flags.includes("g") ? geo.re.flags : `${geo.re.flags}g`), " ");
    }
  }
  const segments = unique([...(AI_RE.test(text) && !/\bAI infra/i.test(text) ? ["AI"] : []), ...[...text.matchAll(SEGMENT_RE)].map((m) => m[1])]);
  const sentinel = { kind: "manual" as const };
  return {
    geos,
    stages: unique([...text.matchAll(STAGE_RE)].map((m) => stageLabel(m[1]))),
    segments,
    signals: unique([...text.matchAll(SIGNAL_RE)].map((m) => m[1].toLowerCase())),
    roles: unique([...text.matchAll(ROLE_RE)].map((m) => m[0])),
    sizes: unique([...text.matchAll(SIZE_RE)].map((m) => m[0])),
    count: detectCount(text),
    cadenceMentioned: detectCadence(text, sentinel) !== sentinel,
    emails: extractEmails(text),
    sending: mentionsSending(text),
    keepInWorkspace: KEEP_IN_WORKSPACE.test(text),
    namedCompanies: namedCompanies(text),
  };
}

// ── The object of the job ───────────────────────────────────────────────────

/** Verbs that introduce what the worker works on. Multi-word ones first. */
const WORK_VERB =
  "keep an eye on|keep track of|keep tabs on|look for|search for|go through|dig up|put together|research|find|track|identify|monitor|watch|list|collect|gather|compile|source|scout|build|create|make|produce|prepare|analy[sz]e|compare|benchmark|check|review|audit|categori[sz]e|triage|classify|summari[sz]e|read|scan|write|draft|reconcile|process|sort|tag|label|map|pull|evaluate|assess|qualify|enrich";
const VERB_START = new RegExp(`^(?:(?:please|also|just|then)\\s+)?(${WORK_VERB})\\b\\s*(.*)$`, "i");
const VERB_ANYWHERE = new RegExp(`\\b(${WORK_VERB})\\b\\s+(.*)$`, "i");

/** "a weekly lead list of …", "me a report on …": the deliverable wrapper around the real object. */
const WRAPPER = /^(?:(?:me|us)\s+)?(?:(?:an?|the|our|my)\s+)?(?:[\w-]+\s+){0,3}?(?:list|database|tracker|report|map|sheet|spreadsheet|digest|brief|briefing|summary|overview|table|csv|set|roundup|shortlist|landscape)\s+(?:of|on|about|for|covering)\s+/i;

const LEAD_IN = /^(?:(?:every|each|once a|on)\s+[^,]{1,40},\s*|(?:weekly|daily|monthly|hourly|each week|every week)\s*[,:]\s*)/i;

/** Clause boundaries after the object. Relative clauses ("that are hiring") stay in the FULL phrase. */
const HARD_END = /\s*(?:[;:—–([]|\s-\s|,\s*(?:and\s+|then\s+)?(?:rank|write|give|send|email|tell|post|share|summari[sz]e|produce|deliver|put|create|flag|highlight|route|set|score|report|compile|build|drop|note|include|capture|classify|categori[sz]e|reconcile|check)\b)|\s+(?:and then|then|and (?:write|give|send|email|tell|post|share|rank|summari[sz]e|produce|deliver|put|create|flag|highlight|route|set|score|report|compile|build|drop|note|list|include|capture|reconcile|classify|categori[sz]e|check|turn|draft)|so (?:that|we|i)|to help|as an?|in an?|into an?|every|each|weekly|daily|hourly|monthly|per (?:day|week|month|run)|a (?:day|week|month)|this (?:week|month)|delivered|sorted|ranked|using|via|based on)\b/i;
const SOFT_END =
  /\s+(?:that|which|who|where|we|i|you|they|by|for (?:our|my|the|each|every|us|me)|with|including|from (?:the )?(?:last|past))\b|\s+(?:our|my|their)\s+\w+(?:\s+\w+)?\s+(?:cares?|wants?|needs?|likes?|uses?|does|is|are|has|have|gets?|sees?|receives?)\b|,/i;

function cutAt(text: string, re: RegExp): string {
  const m = re.exec(text);
  return (m ? text.slice(0, m.index) : text).trim();
}

export interface JobObject {
  /** The verb as the customer wrote it ("research", "keep an eye on"). */
  verb: string;
  /** Everything up to the clause boundary: "Series A fintech companies in Europe that are hiring engineers". */
  full: string;
  /** Without relative clauses and trailing qualifiers: "Series A fintech companies in Europe". */
  core: string;
}

const COUNT_LEAD =
  /^(?:(?:about|around|roughly|up to|at least|the top|top|a few|several|some|all(?: of)?|any|every|each|the|our|my|their|new|latest)\s+)*(?:(?:\d{1,4}\+?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\b)?\s*/i;

function objectFrom(verb: string, rest: string): JobObject | null {
  const unwrapped = rest.replace(/^(?:me|us)\s+/i, "").replace(WRAPPER, "");
  const full = cutAt(unwrapped, HARD_END).replace(/[.!?]+$/, "").replace(COUNT_LEAD, "").trim();
  const core = cutAt(full, SOFT_END).replace(COUNT_LEAD, "").trim();
  if (core.length < 3 || full.length < 3) return null;
  return { verb: verb.toLowerCase(), full, core };
}

const SENTENCES = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const FILLER =
  /^(?:(?:hi|hello|hey)[,!.\s]+)?(?:please\s+)?(?:(?:can|could|would|will) you\s+(?:please\s+)?)?(?:(?:i|we)\s+(?:need|want|would like|'d like|am looking for|are looking for|require)\s+)?(?:(?:an?|the)\s+)?(?:ai\s+)?(?:worker|agent|assistant|bot|someone|somebody|help)?\s*(?:to|that|who|which|can|will)?\s*(?:help\s+(?:me|us)\s+)?/i;

/** A sentence with the "I need someone to…" preamble and trailing punctuation removed. */
export function stripFiller(sentence: string): string {
  const stripped = sentence.replace(FILLER, "").replace(/[.!?]+$/, "").trim();
  return stripped.length >= 3 ? stripped : sentence.replace(/[.!?]+$/, "").trim();
}

/** The first thing the customer asks the worker to work ON, from the first two sentences. */
export function jobObject(description: string): JobObject | null {
  for (const sentence of SENTENCES(description).slice(0, 2)) {
    const s = stripFiller(sentence).replace(LEAD_IN, "");
    const start = VERB_START.exec(s) ?? VERB_ANYWHERE.exec(s);
    if (start) {
      const found = objectFrom(start[1], start[2]);
      if (found) return found;
    }
  }
  return null;
}

/** First sentence, stripped of preambles — the raw material for a working title. */
export function firstSentence(description: string): string {
  return stripFiller(SENTENCES(description)[0] ?? "");
}

export function startsWithWorkVerb(text: string): boolean {
  return VERB_START.test(text.replace(LEAD_IN, "")) || LEAD_IN.test(text) || /^(?:i|we|my|our|you|they|it|this|there|can|could|would)\b/i.test(text);
}

export { GEOS };
export type { Geo };
