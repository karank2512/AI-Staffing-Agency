import type { SearchResult } from "@/server/tools/schemas";
import { extractRecords } from "../extract";
import { canonicalField, type EntityKind } from "../fields";
import { seededInt, seededPick } from "../rng";
import { search } from "../search";
import { clip, normalizeKey, titleCase } from "../text";
import type { Conversation } from "./conversation";
import { fetchedPages, searchResults, structuredRows } from "./candidates";
import type { JobContext } from "./job";

/**
 * Records for jobs the fixture universe does not model (finance ops, content, "general"). The brain works with
 * whatever its tools returned — extracted rows, dataset rows, pages, search results — re-keyed to the spec's
 * field names; with nothing to go on it reports the generic search results the simulated web would give.
 */

type Row = Record<string, unknown>;

const KINDS: readonly EntityKind[] = ["company", "feedback", "ticket", "expense"];

/** Re-key a row onto the requested fields: exact key → normalized key → shared synonym → null. */
export function remapRow(row: Row, fields: readonly string[]): Row {
  const byNormalized = new Map(Object.keys(row).map((k) => [normalizeKey(k), k]));
  const out: Row = {};
  for (const field of fields) {
    if (field in row) {
      out[field] = row[field] ?? null;
      continue;
    }
    const direct = byNormalized.get(normalizeKey(field));
    if (direct !== undefined) {
      out[field] = row[direct] ?? null;
      continue;
    }
    let value: unknown = null;
    for (const kind of KINDS) {
      const wanted = canonicalField(kind, field);
      if (!wanted) continue;
      const sourceKey = Object.keys(row).find((k) => canonicalField(kind, k) === wanted);
      if (sourceKey !== undefined) {
        value = row[sourceKey] ?? null;
        break;
      }
    }
    out[field] = value;
  }
  return out;
}

function resultValue(r: SearchResult, field: string): unknown {
  const key = normalizeKey(field);
  if (/(url|link|href|source_url|citation|reference)/.test(key)) return r.url;
  if (/(^|_)(source|publisher|site|domain|host)($|_)/.test(key)) return r.source;
  if (/(date|published|_on$|_at$|when)/.test(key)) return r.publishedAt.slice(0, 10);
  if (/(title|name|headline|subject|item|topic)/.test(key)) return r.title;
  if (/(summary|description|snippet|text|content|body|note|insight|excerpt|takeaway|finding|detail|why|reason)/.test(key)) return r.snippet;
  return null;
}

export function recordsFromResults(results: readonly SearchResult[], fields: readonly string[]): Row[] {
  return results.map((r) => Object.fromEntries(fields.map((f) => [f, resultValue(r, f)])));
}

const CATEGORY_POOL = ["software", "services", "hardware", "travel", "marketing", "facilities"] as const;
const STATUS_POOL = ["open", "pending", "closed"] as const;
const PRIORITY_POOL = ["low", "medium", "high"] as const;

/**
 * Last resort for a generic job whose sources answered none of its fields (the simulated web has no invoices):
 * fill each field from its NAME so the deliverable still has a believable shape. Ids, amounts and categories
 * are seeded from the job, so the same run always produces the same rows.
 */
function synthesizeValue(field: string, r: SearchResult, i: number, seed: number): unknown {
  const key = normalizeKey(field);
  const known = resultValue(r, field);
  if (known !== null) return known;
  // Order matters: "spend_category" is a category, not an amount; "priority_score" is a score, not a priority.
  if (/(^|_)(id|ref|number|no|code)$/.test(key)) return `${(key.split("_")[0] ?? "rec").slice(0, 3).toUpperCase()}-${1001 + i}`;
  if (/(count|quantity|qty|score|rating|hours|days)/.test(key)) return seededInt(seed + i * 11, 1, 40);
  if (/(status|state)/.test(key)) return seededPick(STATUS_POOL, seed + i);
  if (/(priority|severity|urgency)/.test(key)) return seededPick(PRIORITY_POOL, seed + i);
  if (/(category|type|segment|bucket|class)/.test(key)) return seededPick(CATEGORY_POOL, seed + i);
  if (/(amount|price|cost|total|value|usd|spend|revenue)/.test(key)) return seededInt(seed + i * 7, 120, 9_800);
  if (/(vendor|supplier|company|customer|account|name|owner|payee|merchant|partner)/.test(key)) return titleCase(r.source.split(".")[0] ?? "vendor");
  return null;
}

function synthesize(results: readonly SearchResult[], ctx: JobContext): Row[] {
  return results.map((r, i) => Object.fromEntries(ctx.fields.map((f) => [f, synthesizeValue(f, r, i, ctx.seed)])));
}

function isEmpty(row: Row): boolean {
  return Object.values(row).every((v) => v === null || v === undefined || v === "");
}

function seen(rows: Row[]): Row[] {
  const keys = new Set<string>();
  return rows.filter((row) => {
    if (isEmpty(row)) return false;
    const key = JSON.stringify(Object.values(row).map((v) => (typeof v === "string" ? clip(v.toLowerCase(), 80) : v)));
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

/** A row that answers none of the spec's required fields is not a record of this job (e.g. a feedback row remapped onto finance fields). */
function answersBrief(row: Row, required: readonly string[]): boolean {
  return required.length === 0 || required.some((f) => row[f] !== null && row[f] !== undefined && row[f] !== "");
}

export function genericRecords(convo: Conversation, ctx: JobContext, now: Date): Row[] {
  const rows = seen(structuredRows(convo).map((r) => remapRow(r, ctx.fields))).filter((r) => answersBrief(r, ctx.requiredFields));
  if (rows.length > 0) return rows;

  const pages = fetchedPages(convo);
  if (pages.length > 0) {
    const text = pages.map((p) => `${p.title}\n\n${p.text}`).join("\n\n");
    const extracted = seen(extractRecords(text, ctx.fields, { maxRecords: Math.max(ctx.count, 8) }, now)).filter((r) => answersBrief(r, ctx.requiredFields));
    if (extracted.length > 0) return extracted;
  }

  // Nothing usable came back (no tools, every call failed, or the pages did not answer the fields): work from
  // the search results — the ones actually seen, or what the simulated web would have shown.
  const results = searchResults(convo);
  const basis = results.length > 0 ? results : search(ctx.queries[0] ?? "", { maxResults: Math.min(10, ctx.count) }, now);
  return seen(synthesize(basis, ctx));
}
