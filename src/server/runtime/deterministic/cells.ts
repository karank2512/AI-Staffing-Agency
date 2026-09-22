import { formatCell, isMissing, toNumber } from "./records";

/**
 * Column-aware cells for the compiled report's markdown tables. Only the RENDERING changes: the records the
 * deliverable stores (Deliverable.data) and the CSV keep their raw values, so "85000000" stays exact data while a
 * reader sees "$85M" and a source link reads "news.example" instead of a 90-character URL.
 */

const tokensOf = (column: string) =>
  column
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const MONEY_TOKENS = new Set(["usd", "amount", "amounts", "price", "prices", "cost", "costs", "fee", "fees", "spend", "budget", "revenue", "valuation"]);
/** A share / change of a price is not a price; a column in another currency is not dollars. */
const NOT_MONEY_TOKENS = new Set(["pct", "percent", "percentage", "share", "ratio", "change", "growth", "eur", "gbp", "cad", "aud", "jpy", "inr", "chf", "currency", "count"]);
const URL_TOKENS = new Set(["url", "urls", "website", "homepage", "link"]);

export function isMoneyColumn(column: string): boolean {
  const tokens = tokensOf(column);
  return tokens.some((t) => MONEY_TOKENS.has(t)) && !tokens.some((t) => NOT_MONEY_TOKENS.has(t));
}

export function isUrlColumn(column: string): boolean {
  return tokensOf(column).some((t) => URL_TOKENS.has(t));
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

/** 85_000_000 → "$85M" · 1_240 → "$1.2K" · 94 → "$94" · 19.5 → "$19.50" · 0.0042 → "$0.0042". */
export function formatUsdCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  // Thresholds sit just under each unit so rounding never shows "$1000K".
  if (abs >= 999_950_000_000) return `${sign}$${trim(Math.round(abs / 1e11) / 10)}T`;
  if (abs >= 999_950_000) return `${sign}$${trim(Math.round(abs / 1e8) / 10)}B`;
  if (abs >= 999_950) return `${sign}$${trim(Math.round(abs / 1e5) / 10)}M`;
  if (abs >= 1_000) return `${sign}$${trim(Math.round(abs / 1e2) / 10)}K`;
  if (abs >= 1 || abs === 0) return `${sign}$${Number.isInteger(abs) ? abs : abs.toFixed(2)}`;
  return `${sign}$${abs >= 0.01 ? abs.toFixed(2) : String(Number(abs.toPrecision(2)))}`;
}

/** Numbers and plain dollar strings only: "18%", "€40", "$10–$20" or "Contact sales" are shown as written. */
function moneyValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || /%|€|£|¥|\b(eur|gbp|cad|aud|jpy|inr|chf)\b/i.test(value)) return undefined;
  return toNumber(value);
}

/** Markdown link targets cannot contain spaces, parentheses or a table pipe. */
const escapeHref = (href: string) => href.replace(/[\s()|<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

/** "https://www.news.example/a?b=1" → [news.example](https://www.news.example/a?b=1); bare domains get https://. */
function linkCell(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const candidate = /^https?:\/\//i.test(text) ? text : /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text) ? `https://${text}` : null;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const host = url.hostname.replace(/^www\./, "");
    if (!host) return undefined;
    return `[${host.replace(/[[\]]/g, "")}](${escapeHref(url.href)})`;
  } catch {
    return undefined;
  }
}

/** One table/bullet cell: compact dollars for money columns, host-labelled links for URL columns, else formatCell. */
export function formatColumnCell(value: unknown, column: string): string {
  if (isMissing(value)) return "";
  if (isMoneyColumn(column)) {
    const amount = moneyValue(value);
    if (amount !== undefined) return formatUsdCompact(amount);
  }
  if (isUrlColumn(column)) {
    const link = linkCell(value);
    if (link) return link;
  }
  return formatCell(value);
}
