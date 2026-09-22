import { format, formatDistanceStrict } from "date-fns";

/**
 * Display formatting helpers. Pure and safe to import from client components.
 * Every helper accepts `null` / `undefined` (and NaN / invalid dates) and renders the em-dash placeholder.
 */

export const EMPTY = "—";

type Numeric = number | null | undefined;
export type DateInput = Date | string | number | null | undefined;

function isNum(value: Numeric): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd4 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Money for humans: `$1,234.50`, `$0.42`. Non-zero amounts that would round to zero render as `<$0.01`. */
export function formatUsd(value: Numeric): string {
  if (!isNum(value)) return EMPTY;
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.005) return value < 0 ? "-<$0.01" : "<$0.01";
  return usd2.format(value);
}

/**
 * Money where sub-cent precision matters (per-call / per-run model cost): up to 4 decimals below $1
 * (`$0.0031`, `$0.0123`, `$0.42`), 2 decimals from $1 up. Anything smaller than the last digit shows `<$0.0001`.
 */
export function formatUsdPrecise(value: Numeric): string {
  if (!isNum(value)) return EMPTY;
  const abs = Math.abs(value);
  if (abs >= 1 || abs === 0) return usd2.format(value);
  if (abs < 0.00005) return value < 0 ? "-<$0.0001" : "<$0.0001";
  return usd4.format(value);
}

function compact(value: number, divisor: number, suffix: string): string {
  return `${(value / divisor).toFixed(1).replace(/\.0$/, "")}${suffix}`;
}

/** Token counts: `842`, `1.2k`, `3.4M`. Thresholds sit just under the unit so rounding never yields `1000k`. */
export function formatTokens(value: Numeric): string {
  if (!isNum(value)) return EMPTY;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(Math.round(value));
  if (abs < 1_000) return `${sign}${abs}`;
  if (abs < 999_950) return `${sign}${compact(abs, 1_000, "k")}`;
  if (abs < 999_950_000) return `${sign}${compact(abs, 1_000_000, "M")}`;
  return `${sign}${compact(abs, 1_000_000_000, "B")}`;
}

/** Plain integers / decimals with grouping: `12,480`, `3.25`. */
export function formatNumber(value: Numeric, maximumFractionDigits = 2): string {
  if (!isNum(value)) return EMPTY;
  return value.toLocaleString("en-US", { maximumFractionDigits });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Durations from milliseconds: `850 ms`, `12.4 s`, `3m 05s`, `1h 12m`, `2d 04h`. Negative input clamps to 0. */
export function formatDuration(ms: Numeric): string {
  if (!isNum(ms)) return EMPTY;
  const value = Math.max(0, ms);
  if (value < 999.5) return `${Math.round(value)} ms`;
  // 59.95 s would print as "60.0 s" — hand it to the minutes branch instead.
  if (value < 59_950) return `${(value / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 3_600) return `${Math.floor(totalSeconds / 60)}m ${pad2(totalSeconds % 60)}s`;
  const totalMinutes = Math.round(value / 60_000);
  if (totalMinutes < 1_440) return `${Math.floor(totalMinutes / 60)}h ${pad2(totalMinutes % 60)}m`;
  const totalHours = Math.round(value / 3_600_000);
  return `${Math.floor(totalHours / 24)}d ${pad2(totalHours % 24)}h`;
}

/** `x` is a ratio in 0..1: `formatPercent(0.847)` → `85%`, `formatPercent(0.847, 1)` → `84.7%`. */
export function formatPercent(x: Numeric, fractionDigits = 0): string {
  if (!isNum(x)) return EMPTY;
  return `${(x * 100).toFixed(fractionDigits)}%`;
}

/**
 * `5 minutes ago` / `in 3 hours` (date-fns strict distance, so no "about"/"almost"). Within 10 seconds of `now`
 * reads `just now`. `now` is injectable for tests. In client components prefer `<RelativeTime iso>` — it stays
 * fresh and is hydration-safe.
 */
export function formatRelativeTime(input: DateInput, now: Date = new Date()): string {
  const date = toDate(input);
  if (!date) return EMPTY;
  if (Math.abs(now.getTime() - date.getTime()) < 10_000) return "just now";
  return formatDistanceStrict(date, now, { addSuffix: true });
}

/** `Sep 17, 2026, 2:45 PM` in the runtime's local time zone. */
export function formatDateTime(input: DateInput): string {
  const date = toDate(input);
  return date ? format(date, "MMM d, yyyy, h:mm a") : EMPTY;
}

/** `Sep 17, 2026` */
export function formatDate(input: DateInput): string {
  const date = toDate(input);
  return date ? format(date, "MMM d, yyyy") : EMPTY;
}

/**
 * Words that read wrong in Title/Sentence case — mostly acronyms that show up in worker-produced column names
 * (`hq`, `source_url`, `icp_score`, `arr_usd`). Looked up lower-cased. Only add words that are never ordinary
 * English: this map also humanizes status labels and tool names.
 */
const ACRONYMS: Readonly<Record<string, string>> = {
  acv: "ACV",
  ai: "AI",
  api: "API",
  arr: "ARR",
  b2b: "B2B",
  b2c: "B2C",
  cac: "CAC",
  ceo: "CEO",
  cfo: "CFO",
  cio: "CIO",
  cmo: "CMO",
  coo: "COO",
  cro: "CRO",
  crm: "CRM",
  csv: "CSV",
  cto: "CTO",
  eta: "ETA",
  faq: "FAQ",
  gdpr: "GDPR",
  github: "GitHub",
  gl: "GL",
  gtm: "GTM",
  hq: "HQ",
  hr: "HR",
  html: "HTML",
  icp: "ICP",
  id: "ID",
  ip: "IP",
  json: "JSON",
  kpi: "KPI",
  linkedin: "LinkedIn",
  llm: "LLM",
  ltv: "LTV",
  mrr: "MRR",
  nps: "NPS",
  pdf: "PDF",
  qa: "QA",
  roi: "ROI",
  saas: "SaaS",
  sdk: "SDK",
  seo: "SEO",
  sku: "SKU",
  sla: "SLA",
  sms: "SMS",
  soc2: "SOC2",
  sql: "SQL",
  sso: "SSO",
  tam: "TAM",
  ui: "UI",
  url: "URL",
  usd: "USD",
  utc: "UTC",
  vp: "VP",
  yoy: "YoY",
};

/** Look like an acronym's plural but aren't one (`hrs` is hours, not "HRs"). */
const NOT_PLURAL_ACRONYMS: ReadonlySet<string> = new Set(["hrs"]);

/** `hq` → "HQ"; plurals of all-caps acronyms keep a lower-case s (`source_urls` → "URLs", `hqs` → "HQs"). */
function acronym(word: string): string | undefined {
  const lower = word.toLowerCase();
  const exact = ACRONYMS[lower];
  if (exact !== undefined) return exact;
  if (lower.length > 2 && lower.endsWith("s") && !NOT_PLURAL_ACRONYMS.has(lower)) {
    const base = ACRONYMS[lower.slice(0, -1)];
    if (base !== undefined && /^[A-Z0-9]+$/.test(base)) return `${base}s`;
  }
  return undefined;
}

/** snake_case, kebab-case, camelCase (incl. `sourceURL` / `HQCity`), SCREAMING_CASE or spaced text → words. */
function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Inside otherwise lower/mixed-case text an ALL-CAPS word is an acronym the author meant ("SOC2 report"). In
 * SCREAMING_CASE input it is just the casing, so it gets normalized.
 */
function keepsCaps(word: string, inputHasLowercase: boolean): boolean {
  return inputHasLowercase && word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

/** `market_research` → `Market Research`, `NEEDS_ATTENTION` → `Needs Attention`, `source_url` → `Source URL`. */
export function titleCase(input: string | null | undefined): string {
  if (input === null || input === undefined) return EMPTY;
  const words = splitWords(input);
  if (words.length === 0) return "";
  const hasLower = /[a-z]/.test(input);
  return words.map((w) => acronym(w) ?? (keepsCaps(w, hasLower) ? w : capitalize(w))).join(" ");
}

/**
 * Sentence-case variant used for status labels and table headers:
 * `WAITING_FOR_APPROVAL` → `Waiting for approval`, `funding_round` → `Funding round`, `source_url` → `Source URL`.
 */
export function sentenceCase(input: string | null | undefined): string {
  if (input === null || input === undefined) return EMPTY;
  const words = splitWords(input);
  if (words.length === 0) return "";
  const hasLower = /[a-z]/.test(input);
  return words
    .map((w, i) => acronym(w) ?? (keepsCaps(w, hasLower) ? w : i === 0 ? capitalize(w) : w.toLowerCase()))
    .join(" ");
}

/** `pluralize(1, "run")` → `1 run`, `pluralize(3, "run")` → `3 runs`, `pluralize(2, "reply", "replies")`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count, 0)} ${count === 1 ? singular : plural}`;
}
