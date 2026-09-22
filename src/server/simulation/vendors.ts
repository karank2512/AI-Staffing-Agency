import type { JobSpec } from "@/server/domain/job-spec";
import { COMPARE_HOST, DIRECTORY_HOST, FINANCE_HOST, NEWS_HOST, REVIEWS_HOST } from "./catalog";
import { countryOfLocation } from "./constraints";
import { CATEGORY_GROUPS, COMPANY_FIXTURES } from "./fixtures/companies";
import { FINTECH_FIXTURES } from "./fixtures/fintech";
import { pricingFor, SAAS_CATEGORY, type CompanyPricing } from "./fixtures/pricing";
import { escapeRegExp, slugify } from "./text";

/**
 * Vendors a customer NAMES ("our five main competitors (Notion, Coda, Airtable, ClickUp, Monday)").
 *
 * The fixture universe is fictional, so a named vendor is usually not in it. Rather than silently swapping in
 * fixture companies, the simulated web gives every named vendor a deterministic, clearly illustrative pricing
 * page at `<slug>.example/pricing` (per-seat SaaS plans, jittered by slug), and search ranks named vendors first.
 * Everything is a pure function of the name/slug, so search, pages, extraction and the brain agree.
 */

// ── Name extraction ─────────────────────────────────────────────────────────

/** Capitalised words that are never (part of) a vendor name: verbs, determiners, cadence, pricing and job words. */
const GENERIC = new Set(
  (
    "a an the our we i you my your their its this that these those please every each all any both some other others etc also then " +
    "compare comparing comparison track tracking tracker monitor monitoring check checking find research collect capture summarize summarise " +
    "build review analyze analyse pull gather create produce report reports reporting list identify watch scan include including cover focus " +
    "only use keep flag note rank send email deliver get give look read write share show tell highlight flagging moved anything " +
    "weekly daily monthly quarterly annual annually yearly hourly week month year today tomorrow morning afternoon evening " +
    "pricing price prices priced plan plans tier tiers digest competitor competitors competitive vendor vendors market markets landscape " +
    "analysis brief briefing update updates change changes intelligence overview summary page pages data job worker company companies " +
    "startup startups customer customers seat seats list coverage input inputs objective constraint constraints main key core top best new " +
    "usd eur gbp csv json pdf excel series ai ml llm llms gpu gpus api apis saas crm erp sla sso kpi kpis b2b b2c smb icp nps url urls seo ui ux " +
    "us usa uk eu emea apac north south east west america americas europe european asia africa global worldwide q1 q2 q3 q4 h1 h2 " +
    "note notes source sources link links website websites arr mrr gtm okr okrs roi cac ltv churn ppc p&l"
  ).split(" "),
);
/** Real vendor names only when they sit in a list next to a clearer one ("Notion, Coda … Monday"). */
const SOFT = new Set(
  (
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december " +
    "sales marketing finance engineering support legal operations ops product design security hr leadership executive executives team teams " +
    "slack gmail outlook free pro plus business enterprise starter growth standard premium basic scale"
  ).split(" "),
);
const CATEGORY_NAMES = new Set(Object.values(CATEGORY_GROUPS).flatMap((g) => g.categories.map((c) => c.toLowerCase())));
const WORD = String.raw`[A-Z][A-Za-z0-9]*(?:[.&+'’-][A-Za-z0-9]+)*`;
const RUN_RE = new RegExp(`\\b${WORD}(?:[ \\t]+${WORD})*`, "g");
const LIST_SEPARATOR = /^\s*(?:,|,?\s*(?:and|or|&|\+|\/|vs\.?|versus)|\/)\s*$/i;
/** Text right before a lone name that marks it as a vendor ("competitors like X", "compare X", "X vs Y"). */
const CUE = /(?:\b(?:competitors?|vendors?|rivals?|alternatives?|providers?|players?|coverage|tools?)\b[^.;!?\n]{0,40}?(?:[:(—–]|\blike\b|\bsuch as\b|\bincluding\b|\bnamely\b)|\b(?:compare|comparing|versus|vs\.?|against|between|including|such as)\b)\s*$/i;
const MAX_WORDS = 3;

interface Candidate {
  name: string;
  start: number;
  end: number;
  soft: boolean;
}

function isGeneric(word: string): boolean {
  return GENERIC.has(word.toLowerCase().replace(/[’']s$/, ""));
}

/** Split a capitalised run on generic words: "Compare Notion" → ["Notion"], "Coda Pricing Tracker" → ["Coda"]. */
function candidatesOf(run: string, offset: number): Candidate[] {
  const out: Candidate[] = [];
  const words = [...run.matchAll(new RegExp(WORD, "g"))];
  let current: RegExpMatchArray[] = [];
  const flush = () => {
    if (current.length > 0 && current.length <= MAX_WORDS) {
      const first = current[0];
      const last = current[current.length - 1];
      const name = run.slice(first.index, (last.index ?? 0) + last[0].length);
      const lower = name.toLowerCase();
      const allSoft = current.every((w) => SOFT.has(w[0].toLowerCase()));
      if (!CATEGORY_NAMES.has(lower) && !countryOfLocation(name)) {
        out.push({ name, start: offset + (first.index ?? 0), end: offset + (last.index ?? 0) + last[0].length, soft: allSoft });
      }
    }
    current = [];
  };
  for (const w of words) {
    if (isGeneric(w[0])) flush();
    else current.push(w);
  }
  flush();
  return out;
}

/**
 * Vendor names in free text, in order of first mention. A name counts when it sits in a list of names ("Notion,
 * Coda and Airtable", "Notion vs Coda") or right after a cue ("competitors like Notion", "compare Notion"), so
 * Title-Case job titles and sentence-initial verbs are not mistaken for vendors.
 */
export function extractVendorNames(text: string): string[] {
  const candidates = [...text.matchAll(RUN_RE)].flatMap((m) => candidatesOf(m[0], m.index ?? 0));
  const lists: Candidate[][] = [];
  for (const c of candidates) {
    const list = lists[lists.length - 1];
    const prev = list?.[list.length - 1];
    if (prev && LIST_SEPARATOR.test(text.slice(prev.end, c.start))) list.push(c);
    else lists.push([c]);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list.some((c) => !c.soft)) continue;
    const before = text.slice(Math.max(0, list[0].start - 80), list[0].start);
    if (list.length < 2 && !CUE.test(before)) continue;
    for (const c of list) {
      const key = vendorSlug(c.name);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(c.name);
      }
    }
  }
  return out;
}

/** The spec text a customer names competitors in: title, objective, summary, constraints, inputs, responsibilities. */
export function specVendorNames(spec: JobSpec): string[] {
  const parts = [
    spec.title,
    spec.objective,
    spec.summary,
    ...spec.constraints,
    ...spec.inputs.flatMap((i) => [i.name, i.description]),
    ...spec.responsibilities,
  ];
  // Separate sentences so a list never runs across two fields.
  return extractVendorNames(parts.join(".\n"));
}

// ── Synthetic vendors ───────────────────────────────────────────────────────

const FIXTURE_SLUGS = new Set([...COMPANY_FIXTURES, ...FINTECH_FIXTURES].map((f) => f.slug));
const FIXTURE_NAMES = new Map([...COMPANY_FIXTURES, ...FINTECH_FIXTURES].map((f) => [f.company.toLowerCase(), f.slug]));
/** Hosts of the simulated web that are sites, not vendors. */
const RESERVED_HOSTS = new Set([NEWS_HOST, COMPARE_HOST, DIRECTORY_HOST, REVIEWS_HOST, FINANCE_HOST].map((h) => h.replace(/\.example$/, "")));
RESERVED_HOSTS.add("acme");

export interface SyntheticVendor {
  company: string;
  slug: string;
  category: string;
  website: string;
  pricing: CompanyPricing;
}

/** "ClickUp" → "clickup" · "Monday.com" → "monday" · "Hugging Face" → "hugging-face". */
export function vendorSlug(name: string): string {
  return slugify(name.replace(/\.(com|io|ai|co|app|so|dev|org|net)$/i, ""));
}

/** The fixture slug for a fixture company's name, if the name is one. */
export function fixtureSlugOf(name: string): string | undefined {
  return FIXTURE_NAMES.get(name.trim().toLowerCase());
}

export function isSyntheticVendorSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && !FIXTURE_SLUGS.has(slug) && !RESERVED_HOSTS.has(slug);
}

/** Best display name for a slug: a known spelling, else the text's own casing, else Title Case of the slug. */
export function vendorDisplayName(slug: string, opts: { known?: readonly string[]; text?: string } = {}): string {
  const known = opts.known?.find((n) => vendorSlug(n) === slug);
  if (known) return known;
  const words = slug.split("-").filter(Boolean);
  if (opts.text && words.length > 0) {
    const m = new RegExp(`\\b${words.map(escapeRegExp).join("[\\s-]?")}\\b`, "i").exec(opts.text);
    if (m && /[A-Z]/.test(m[0][0])) return m[0];
  }
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function syntheticVendor(name: string): SyntheticVendor {
  const slug = vendorSlug(name);
  return {
    company: name,
    slug,
    category: SAAS_CATEGORY,
    website: `https://${slug}.example`,
    pricing: pricingFor({ slug, category: SAAS_CATEGORY }),
  };
}

const PRICING_URL_RE = /https?:\/\/(?:www\.)?([a-z0-9-]+)\.example\/pricing(?![\w/-])/gi;

/** Slugs of synthetic vendors whose pricing page URL appears in `text`, in order of first mention. */
export function mentionedVendorSlugs(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(PRICING_URL_RE)) {
    const slug = m[1].toLowerCase();
    if (isSyntheticVendorSlug(slug)) seen.add(slug);
  }
  return [...seen];
}
