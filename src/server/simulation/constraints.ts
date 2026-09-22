import type { JobSpec } from "@/server/domain/job-spec";

/**
 * The hard constraints a brief puts on WHICH companies count: funding stage ("Series A"), geography ("in
 * Europe") and sector ("fintech companies"). Shared by the mock brain (to pick matching companies), the simulated
 * web (to surface matching hub pages) and the simulated judge (to mark down records that break them). PURE.
 *
 * Geography and sector words only count when they describe the TARGET ("fintech companies in Europe"), never the
 * customer ("a good fit for our developer tools", "our Berlin office") — they must sit near a target noun and not
 * behind a possessive.
 */

export type Sector = "ai_infrastructure" | "fintech";
export type Region = "Europe" | "North America" | "Asia-Pacific" | "Middle East";

export interface JobConstraints {
  /** Canonical stages ("Seed", "Series A" …); empty = any stage. */
  stages: string[];
  /** Empty = anywhere. */
  regions: Region[];
  /** Canonical country names, when the brief is that specific ("UK fintechs"). Narrows `regions`. */
  countries: string[];
  /** The sector the brief targets, when it names one the simulated web models. */
  sector: Sector | null;
  /** Human-readable, for notes and judge reasoning: ["Series A", "Europe", "fintech"]. */
  labels: string[];
}

export const NO_CONSTRAINTS: JobConstraints = { stages: [], regions: [], countries: [], sector: null, labels: [] };

export const STAGE_ORDER = ["Pre-seed", "Seed", "Series A", "Series B", "Series C", "Series D", "Series E"] as const;

const SECTOR_LABEL: Record<Sector, string> = { ai_infrastructure: "AI infrastructure", fintech: "fintech" };

// ── Stages ──────────────────────────────────────────────────────────────────

const STAGE_WORD = String.raw`pre[-\s]?seed|seed(?![-\s](?:data|list|file|keywords?|urls?|round of hiring))|series\s+[a-e]`;

function canonicalStage(raw: string): string | undefined {
  const s = raw.toLowerCase().replace(/[-\s]+/g, " ").trim();
  if (s === "pre seed") return "Pre-seed";
  if (s === "seed") return "Seed";
  const letter = /^(?:series )?([a-e])$/.exec(s)?.[1];
  return letter ? `Series ${letter.toUpperCase()}` : undefined;
}

function stageRange(from: string, to: string): string[] {
  const a = STAGE_ORDER.indexOf(from as (typeof STAGE_ORDER)[number]);
  const b = STAGE_ORDER.indexOf(to as (typeof STAGE_ORDER)[number]);
  if (a < 0 || b < 0) return [from, to];
  return STAGE_ORDER.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export function parseStages(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  const add = (...stages: Array<string | undefined>) => stages.forEach((s) => s && found.add(s));

  for (const m of lower.matchAll(new RegExp(String.raw`\b(${STAGE_WORD})\s*(?:to|through|thru|–|—|-|/)\s*(?:series\s+)?(pre[-\s]?seed|seed|[a-e])\b`, "g"))) {
    const from = canonicalStage(m[1]);
    const to = canonicalStage(m[2]);
    if (from && to) stageRange(from, to).forEach((s) => add(s));
  }
  for (const m of lower.matchAll(/\bseries\s+([a-e])((?:\s*(?:,|or|and|&)\s*(?:series\s+)?[a-e]\b)+)/g)) {
    add(canonicalStage(m[1]), ...[...m[2].matchAll(/[a-e]\b/g)].map((x) => canonicalStage(x[0])));
  }
  for (const m of lower.matchAll(new RegExp(String.raw`\b(${STAGE_WORD})\b`, "g"))) add(canonicalStage(m[1]));
  if (/\bearly[-\s]stage\b/.test(lower)) add("Pre-seed", "Seed", "Series A");
  if (/\b(?:growth|late)[-\s]stage\b/.test(lower)) add("Series C", "Series D", "Series E");
  return STAGE_ORDER.filter((s) => found.has(s));
}

// ── Places ──────────────────────────────────────────────────────────────────

const REGION_TERMS: ReadonlyArray<[RegExp, Region]> = [
  [/^(europe|european|eu|emea|nordics?|scandinavian?|dach|benelux|baltics?)$/, "Europe"],
  [/^(america|american|americas|north-america)$/, "North America"],
  [/^(apac|asia|asian|asia-pacific)$/, "Asia-Pacific"],
  [/^(mena|middle-east)$/, "Middle East"],
];

const COUNTRY_TERMS: ReadonlyArray<[RegExp, string, Region]> = [
  [/^(uk|britain|british|united-kingdom|england)$/, "United Kingdom", "Europe"],
  [/^(germany|german)$/, "Germany", "Europe"],
  [/^(france|french)$/, "France", "Europe"],
  [/^(netherlands|dutch)$/, "Netherlands", "Europe"],
  [/^(sweden|swedish)$/, "Sweden", "Europe"],
  [/^(spain|spanish)$/, "Spain", "Europe"],
  [/^(ireland|irish)$/, "Ireland", "Europe"],
  [/^(switzerland|swiss)$/, "Switzerland", "Europe"],
  [/^(italy|italian)$/, "Italy", "Europe"],
  [/^(portugal|portuguese)$/, "Portugal", "Europe"],
  [/^(denmark|danish)$/, "Denmark", "Europe"],
  [/^(poland|polish)$/, "Poland", "Europe"],
  [/^(austria|austrian)$/, "Austria", "Europe"],
  [/^(estonia|estonian)$/, "Estonia", "Europe"],
  [/^(usa|united-states|stateside)$/, "United States", "North America"],
  [/^(canada|canadian)$/, "Canada", "North America"],
  [/^(israel|israeli)$/, "Israel", "Middle East"],
  [/^(india|indian)$/, "India", "Asia-Pacific"],
  [/^(singapore)$/, "Singapore", "Asia-Pacific"],
];

/** Cities that appear in fixture HQs (and a few more), so a location string resolves to a country. */
const CITY_COUNTRY: Record<string, string> = {
  london: "United Kingdom", berlin: "Germany", munich: "Germany", frankfurt: "Germany", hamburg: "Germany", paris: "France",
  amsterdam: "Netherlands", stockholm: "Sweden", madrid: "Spain", barcelona: "Spain", dublin: "Ireland", zurich: "Switzerland",
  milan: "Italy", lisbon: "Portugal", copenhagen: "Denmark", warsaw: "Poland", vienna: "Austria", tallinn: "Estonia",
  helsinki: "Finland", oslo: "Norway", brussels: "Belgium", toronto: "Canada", montreal: "Canada", vancouver: "Canada",
  "tel aviv": "Israel", bengaluru: "India", bangalore: "India", singapore: "Singapore", sydney: "Australia", tokyo: "Japan",
};

const COUNTRY_REGION: Record<string, Region> = {
  "United States": "North America", Canada: "North America", "United Kingdom": "Europe", Germany: "Europe", France: "Europe",
  Netherlands: "Europe", Sweden: "Europe", Spain: "Europe", Ireland: "Europe", Switzerland: "Europe", Italy: "Europe",
  Portugal: "Europe", Denmark: "Europe", Poland: "Europe", Austria: "Europe", Estonia: "Europe", Finland: "Europe",
  Norway: "Europe", Belgium: "Europe", Israel: "Middle East", India: "Asia-Pacific", Singapore: "Asia-Pacific",
  Australia: "Asia-Pacific", Japan: "Asia-Pacific",
};

const US_STATE = /,\s*([A-Z]{2})\s*$/;

/** "Austin, TX" → United States · "Berlin, Germany" → Germany · "London, UK" → United Kingdom. */
export function countryOfLocation(location: string): string | undefined {
  const text = location.trim();
  if (!text) return undefined;
  const tail = text.split(",").pop()?.trim() ?? text;
  if (/^(uk|u\.k\.)$/i.test(tail)) return "United Kingdom";
  if (/^(us|u\.s\.a?\.?|usa|united states)$/i.test(tail)) return "United States";
  if (US_STATE.test(text)) return "United States";
  const known = Object.keys(COUNTRY_REGION).find((c) => c.toLowerCase() === tail.toLowerCase());
  if (known) return known;
  const lower = text.toLowerCase();
  const city = Object.keys(CITY_COUNTRY).find((c) => new RegExp(`\\b${c}\\b`).test(lower));
  return city ? CITY_COUNTRY[city] : undefined;
}

export function regionOfCountry(country: string | undefined): Region | undefined {
  return country ? COUNTRY_REGION[country] : undefined;
}

// ── Target-phrase detection (geography + sector) ────────────────────────────

const TARGET_NOUN = /^(compan(y|ies)|startups?|firms?|businesses|accounts?|leads?|prospects?|rounds?|vendors?|competitors?|players?|fintechs?|scale-?ups?|organi[sz]ations?|banks?|lenders?|insurers?|deals?|raises?|list)$/;
const POSSESSIVE = /^(our|my|your|their|we|us|i)$/;
const WINDOW = 6;

const FINTECH_WORD = /^(fintechs?|payments?|banking|neobanks?|lending|lenders?|insurtech|wealthtech|regtech|bnpl|financial-services|financial-technology|embedded-finance)$/;
const AI_INFRA_WORD = /^(ai-infrastructure|ai-infra|gpu|gpus|llm|llms|mlops|inference|vector-databases?)$/;

/** Lower-cased words with a few multi-word terms joined ("north america" → "north-america"). */
function words(text: string): string[] {
  return text
    // "US" as an upper-case word is the country ("US-based startups"); lower-case "us" stays the pronoun.
    .replace(/\bUS\b/g, " usa ")
    .toLowerCase()
    .replace(/\bu\.s\.a?\.?/g, " usa ")
    .replace(/\bu\.k\.?/g, " uk ")
    .replace(/\b(north|south)\s+america\b/g, "$1-america")
    .replace(/\bunited\s+(states|kingdom)\b/g, "united-$1")
    .replace(/\bmiddle\s+east\b/g, "middle-east")
    .replace(/\basia[\s-]+pacific\b/g, "asia-pacific")
    .replace(/\bfinancial\s+(services|technology)\b/g, "financial-$1")
    .replace(/\bembedded\s+finance\b/g, "embedded-finance")
    .replace(/\bfin[\s-]tech/g, "fintech")
    .replace(/\bai\s+infra(structure)?\b/g, (m) => (m.endsWith("structure") ? "ai-infrastructure" : "ai-infra"))
    .replace(/\bvector\s+databases?\b/g, "vector-databases")
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);
}

/** Indexes of words that describe the target: near a target noun and not owned by the customer. */
function targetMentions(tokens: string[], test: (w: string) => boolean): string[] {
  const nouns = tokens.flatMap((w, i) => (TARGET_NOUN.test(w) ? [i] : []));
  const out: string[] = [];
  tokens.forEach((w, i) => {
    if (!test(w)) return;
    if (POSSESSIVE.test(tokens[i - 1] ?? "") || POSSESSIVE.test(tokens[i - 2] ?? "")) return;
    // The word itself can be the target ("fintechs in Europe").
    if (TARGET_NOUN.test(w) || nouns.some((j) => Math.abs(j - i) <= WINDOW)) out.push(w);
  });
  return out;
}

export function parseConstraints(text: string): JobConstraints {
  const tokens = words(text);
  const regions = new Set<Region>();
  const countries = new Set<string>();

  for (const w of targetMentions(tokens, (x) => REGION_TERMS.some(([re]) => re.test(x)) || COUNTRY_TERMS.some(([re]) => re.test(x)))) {
    const region = REGION_TERMS.find(([re]) => re.test(w))?.[1];
    if (region) regions.add(region);
    const country = COUNTRY_TERMS.find(([re]) => re.test(w));
    if (country) {
      countries.add(country[1]);
      regions.add(country[2]);
    }
  }
  // A named country that belongs to a named region adds nothing; a region with no named country stays broad.
  const regionList = [...regions];
  const countryList = [...countries].filter((c) => regionList.includes(COUNTRY_REGION[c] as Region));

  const sector: Sector | null =
    targetMentions(tokens, (x) => FINTECH_WORD.test(x)).length > 0
      ? "fintech"
      : targetMentions(tokens, (x) => AI_INFRA_WORD.test(x)).length > 0
        ? "ai_infrastructure"
        : null;

  const stages = parseStages(text);
  const labels = [
    ...(stages.length > 0 && stages.length < 4 ? [stages.join("/")] : []),
    ...(countryList.length > 0 ? countryList : regionList),
    ...(sector ? [SECTOR_LABEL[sector]] : []),
  ];
  return { stages, regions: regionList, countries: countryList, sector, labels };
}

/**
 * The brief's own words about the target — title, objective, constraints and customer-provided inputs — plus the
 * run's one-off instructions. Never field descriptions ("Funding stage (Seed, Series A…)") or template prose.
 */
export function constraintsForSpec(spec: Pick<JobSpec, "title" | "objective" | "constraints" | "inputs">, instructions: readonly string[] = []): JobConstraints {
  const userInputs = spec.inputs.filter((i) => i.source === "user_instruction").map((i) => i.description);
  return parseConstraints([spec.title, spec.objective, ...spec.constraints, ...userInputs, ...instructions].join(". "));
}

export function hasConstraints(c: JobConstraints): boolean {
  return c.stages.length > 0 || c.regions.length > 0 || c.sector !== null;
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface ConstraintSubject {
  stage?: string | null;
  /** Free-text location (HQ, city, country, region). */
  location?: string | null;
  sector?: Sector | null;
}

export type ConstraintMiss = "stage" | "region" | "sector";

/**
 * Which constraints a subject breaks. A dimension the subject says nothing about is not a miss — only what can
 * be checked is judged (a record without a location cannot be "outside Europe").
 */
export function constraintMisses(subject: ConstraintSubject, c: JobConstraints): ConstraintMiss[] {
  const misses: ConstraintMiss[] = [];
  if (c.stages.length > 0 && subject.stage) {
    const stage = canonicalStage(String(subject.stage).replace(/\bround\b/i, "").trim()) ?? String(subject.stage).trim();
    if (!c.stages.includes(stage)) misses.push("stage");
  }
  if (c.regions.length > 0 && subject.location) {
    const loc = String(subject.location);
    const country = countryOfLocation(loc);
    const region = regionOfCountry(country) ?? (REGION_TERMS.find(([re]) => words(loc).some((w) => re.test(w)))?.[1] as Region | undefined);
    if (country || region) {
      const okCountry = c.countries.length === 0 || (country !== undefined && c.countries.includes(country));
      const okRegion = region !== undefined && c.regions.includes(region);
      if (!(okRegion && okCountry)) misses.push("region");
    }
  }
  if (c.sector && subject.sector && subject.sector !== c.sector) misses.push("sector");
  return misses;
}

const FINTECH_VOCAB = /^(finance|financial|credit|loans?|treasury|fx|insurance|kyc|kyb|aml|fraud|wealth|card|cards|ledgers?|payouts?|invoices?|invoicing|banks?|iban|remittances?|chargebacks?|pensions?|savings|acquiring|underwriting)$/;
const AI_VOCAB = /^(ai|ml|model|models|gpu|training|labeling|embeddings?|agents?|inference|fine-tuning|evals?|llms?|datasets?|synthetic)$/;

/** Which sector a piece of descriptive text (category, industry, description) belongs to — the stronger signal wins. */
export function sectorOfText(text: string): Sector | null {
  // "Banking-as-a-Service" counts as "banking" too.
  const tokens = words(text).flatMap((w) => (w.includes("-") ? [w, ...w.split("-")] : [w]));
  const fintech = tokens.filter((w) => FINTECH_WORD.test(w) || FINTECH_VOCAB.test(w)).length;
  const ai = tokens.filter((w) => AI_INFRA_WORD.test(w) || AI_VOCAB.test(w)).length;
  if (fintech === ai) return null;
  return fintech > ai ? "fintech" : "ai_infrastructure";
}
