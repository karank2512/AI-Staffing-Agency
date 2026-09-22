import { EXPENSE_ID_RE, EntityIndex, FEEDBACK_ID_RE, TICKET_ID_RE, mentionedIds, type EntityRef } from "./entities";
import { buildRecord, canonicalField, kindAffinity, type EntityKind } from "./fields";
import { clip, normalizeKey } from "./text";

/**
 * `extractRecords` — the simulated stand-in for "LLM reads text, returns structured rows".
 *
 * It only reports entities that are actually MENTIONED in the text (company names / site hosts, feedback,
 * ticket and ledger ids), in order of first mention, and maps the requested field names through the synonym tables
 * in fields.ts. Requested fields it has no fact for come back as `null`. Text that mentions nothing it knows
 * yields best-effort generic rows built from the text itself.
 */

const DEFAULT_MAX = 50;
const HARD_MAX = 100;
const GENERIC_MAX = 8;

const DEFAULT_FIELDS: Record<EntityKind | "generic", readonly string[]> = {
  company: ["company", "category", "stage", "amount_usd", "lead_investor", "source_url"],
  feedback: ["id", "customer", "text", "category", "sentiment", "severity"],
  ticket: ["id", "subject", "category", "priority", "team"],
  expense: ["id", "date", "vendor", "category", "amount_usd", "status", "flag_reason"],
  generic: ["title", "summary", "url"],
};

/** Which kind of thing is this text about? Most mentions wins; the requested fields break ties. */
function decideKind(counts: Record<EntityKind, number>, fields: readonly string[]): EntityKind | null {
  const kinds = (Object.keys(counts) as EntityKind[]).filter((k) => counts[k] > 0);
  if (kinds.length === 0) return null;
  return kinds.sort((a, b) => counts[b] - counts[a] || kindAffinity(b, fields) - kindAffinity(a, fields))[0];
}

/** Companies (fixture or named-vendor pricing pages) in order of mention; plan rows only for plans the text prices. */
function companyRecords(text: string, companies: EntityRef[], fields: readonly string[], index: EntityIndex): Array<Record<string, unknown>> {
  const wantsPlans = fields.some((f) => canonicalField("company", f) === "plan");
  if (wantsPlans) {
    const lower = text.toLowerCase();
    // Only plans the text actually prices (see pages.planLines) — a roundup mention is not a price list.
    const rows = companies.flatMap((ref) =>
      (index.planFactsFor(ref) ?? []).filter((f) => lower.includes(`${String(f.company)} ${String(f.plan)} plan`.toLowerCase())).map((f) => buildRecord("company", f, fields)),
    );
    if (rows.length > 0) return rows;
  }
  return companies.map((ref) => buildRecord("company", ref.facts, fields));
}

// ── Generic fallback ────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s)"'<>\]]+/i;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
const MONEY_RE = /\$\s?(\d+(?:[.,]\d+)?)\s?(k|m|b|thousand|million|billion)?/i;

function parseMoney(text: string): number | null {
  const m = text.match(MONEY_RE);
  if (!m) return null;
  const n = Number(m[1].replace(",", ""));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const scale = unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit.startsWith("k") || unit.startsWith("t") ? 1e3 : 1;
  return Math.round(n * scale);
}

function genericValue(field: string, paragraph: string, wholeText: string): unknown {
  const key = normalizeKey(field);
  if (/(url|link|source|website|citation|reference)/.test(key)) {
    return (paragraph.match(URL_RE) ?? wholeText.match(URL_RE))?.[0].replace(/[.,;]+$/, "") ?? null;
  }
  if (/(date|_on$|_at$|published)/.test(key)) return paragraph.match(ISO_DATE_RE)?.[0] ?? null;
  if (/(amount|price|usd|cost|value|revenue)/.test(key)) return parseMoney(paragraph);
  if (/(title|name|headline|subject|topic|item)/.test(key)) {
    return clip(paragraph.split(/\s+/).slice(0, 9).join(" ").replace(/[\s.,;:—-]+$/, ""), 90);
  }
  if (/(summary|description|text|content|snippet|note|insight|body|quote|excerpt|finding|point|detail|takeaway)/.test(key)) {
    const sentences = paragraph.match(/[^.!?]+[.!?]+/g) ?? [paragraph];
    return clip(sentences.slice(0, 2).join(" ").trim(), 280);
  }
  return null;
}

function genericRecords(text: string, fields: readonly string[], max: number): Array<Record<string, unknown>> {
  const paragraphs = text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 40);
  const blocks = paragraphs.length > 0 ? paragraphs : [text.replace(/\s+/g, " ").trim()].filter((p) => p.length > 0);
  return blocks.slice(0, Math.min(max, GENERIC_MAX)).map((p) => {
    const record: Record<string, unknown> = {};
    for (const f of fields) record[f] = genericValue(f, p, text);
    return record;
  });
}

// ── Public ──────────────────────────────────────────────────────────────────

export function extractRecords(
  text: string,
  fields: readonly string[],
  opts: { maxRecords?: number } | undefined,
  now: Date,
): Array<Record<string, unknown>> {
  const source = typeof text === "string" ? text : "";
  if (source.trim().length === 0) return [];
  const requestedMax = opts?.maxRecords;
  const max = Math.min(HARD_MAX, Math.max(1, Math.floor(Number.isFinite(requestedMax) ? (requestedMax as number) : DEFAULT_MAX)));
  const requested = fields.filter((f) => typeof f === "string" && f.trim().length > 0);

  const index = new EntityIndex(now);
  const companies = index.mentioned(source, "company");
  const feedbackIds = mentionedIds(source, FEEDBACK_ID_RE);
  const ticketIds = mentionedIds(source, TICKET_ID_RE);
  const expenseIds = mentionedIds(source, EXPENSE_ID_RE);
  const kind = decideKind({ company: companies.length, feedback: feedbackIds.length, ticket: ticketIds.length, expense: expenseIds.length }, requested);

  if (kind === null) return genericRecords(source, requested.length > 0 ? requested : DEFAULT_FIELDS.generic, max);
  const wanted = requested.length > 0 ? requested : DEFAULT_FIELDS[kind];
  if (kind === "company") return companyRecords(source, companies, wanted, index).slice(0, max);

  const ids = kind === "feedback" ? feedbackIds : kind === "expense" ? expenseIds : ticketIds;
  const byKey = new Map<string, EntityRef>(index.refs(kind).map((r) => [r.key, r]));
  return ids
    .map((id) => byKey.get(id))
    .filter((r): r is EntityRef => r !== undefined)
    .slice(0, max)
    .map((r) => buildRecord(kind, r.facts, wanted));
}
