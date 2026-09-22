/**
 * Pure helpers shared by the deterministic operations. Records coming out of an agent are messy by nature:
 * numbers arrive as "$12.5M" or "12,500,000", keys differ in case and spacing, and "missing" can be null,
 * undefined or an empty string. Everything here is tolerant of that.
 */

export type DataRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An array of records from any context value: arrays are filtered to objects, a lone object is wrapped, else []. */
export function asRecords(value: unknown): DataRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    for (const key of ["records", "data", "items", "rows"]) {
      if (Array.isArray(value[key])) return (value[key] as unknown[]).filter(isRecord);
    }
    return [value];
  }
  return [];
}

/** null / undefined / "" / whitespace-only count as missing; `false` and 0 are real answers. */
export function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}

const SUFFIX: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  tn: 1e12,
  trillion: 1e12,
};

const NUMERIC = /^([-+]?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(k|thousand|mm?|mn|million|bn?|billion|tn?|trillion)?\s*%?$/i;

/** "$12.5M" → 12_500_000 · "12,500,000" → 12_500_000 · "18%" → 18 · "(1,200)" → -1200 · "n/a" → undefined. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return undefined;
  if (typeof value !== "string") return undefined;
  let text = value.trim();
  if (text.length === 0) return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[$€£¥]|\b(usd|eur|gbp|cad|aud)\b/gi, "").trim();
  const m = NUMERIC.exec(text);
  if (!m) return undefined;
  const base = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(base)) return undefined;
  const multiplier = m[3] ? (SUFFIX[m[3].toLowerCase()] ?? 1) : 1;
  const sign = m[1] === "-" || negative ? -1 : 1;
  return sign * base * multiplier;
}

/** Case- and whitespace-insensitive comparison key ("" for missing values). */
export function normalizeKey(value: unknown): string {
  if (isMissing(value)) return "";
  const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

const ACRONYMS: Record<string, string> = { usd: "USD", eur: "EUR", gbp: "GBP", url: "URL", id: "ID", hq: "HQ", arr: "ARR", mrr: "MRR", nps: "NPS", api: "API", ai: "AI" };

/** amount_usd → "Amount USD" · source_url → "Source URL" · leadInvestor → "Lead investor". */
export function humanizeHeader(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return words
    .map((w, i) => {
      if (ACRONYMS[w]) return ACRONYMS[w];
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  const rounded = Number.isInteger(n) ? n : abs >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  const [whole, fraction] = String(rounded).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** A single-line cell for tables and bullets; pipes and newlines are escaped so GFM stays intact. */
export function formatCell(value: unknown): string {
  if (isMissing(value)) return "";
  let text: string;
  if (typeof value === "number") text = formatNumber(value);
  else if (typeof value === "string") text = value;
  else if (typeof value === "boolean") text = value ? "yes" : "no";
  else if (value instanceof Date) text = value.toISOString().slice(0, 10);
  else text = JSON.stringify(value);
  return text.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|").trim();
}

/** Column order = explicit list, else every key in order of first appearance. */
export function resolveColumns(records: readonly DataRecord[], columns?: readonly string[], max?: number): string[] {
  if (columns && columns.length > 0) return [...new Set(columns)];
  const seen: string[] = [];
  for (const record of records) for (const key of Object.keys(record)) if (!seen.includes(key)) seen.push(key);
  return max ? seen.slice(0, max) : seen;
}
