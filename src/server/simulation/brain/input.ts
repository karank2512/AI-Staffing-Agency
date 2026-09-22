import type { ChatMessage } from "@/server/models/types";

/**
 * How the mock brain reads an agent's inputs.
 *
 * EXPECTED FORMAT (runtime → agent). The runtime sends ONE initial user message containing the job brief,
 * any one-off instructions, and each `inputKeys` value under a level-2 heading that is EXACTLY the context
 * key. Non-string values go in a fenced ```json block; strings are inserted raw:
 *
 *     Here is everything you need for this run.
 *
 *     ## job_brief
 *     # Job: AI Infrastructure Funding Tracker
 *     ...raw text...
 *
 *     ## instructions
 *     ```json
 *     ["Focus on vector databases", "top 5"]
 *     ```
 *
 *     ## records
 *     ```json
 *     [{ "company": "Vectorloom", "stage": "Series B" }]
 *     ```
 *
 * Parsing is defensive on purpose. Only headings that name one of the component's OWN `inputKeys` open a
 * section (raw strings such as a markdown report contain their own `##` headings, e.g. "## Records"); the
 * exact `## key` form is preferred, then heading level / case / a trailing colon are tolerated; and when no
 * heading is found at all, the first JSON array in the message is treated as the records.
 */

export interface AgentInput {
  /** Full text of the first user message ("" when there is none). */
  raw: string;
  /** Raw text of each recognised section, keyed by context key. */
  sections: Record<string, string>;
}

function findHeading(raw: string, key: string): RegExpExecArray | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(`^## ${escaped}[ \\t]*$`, "m").exec(raw);
  if (exact) return exact;
  const flexible = escaped.replace(/_/g, "[_ ]");
  return new RegExp(`^[ \\t]*#{1,6}[ \\t]*\`?${flexible}\`?[ \\t]*:?[ \\t]*$`, "im").exec(raw);
}

export function firstUserMessage(messages: readonly ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  return first && typeof first.content === "string" ? first.content : "";
}

export function parseAgentInput(messages: readonly ChatMessage[], inputKeys: readonly string[]): AgentInput {
  const raw = firstUserMessage(messages);
  const found: Array<{ key: string; start: number; bodyStart: number }> = [];
  for (const key of new Set(inputKeys)) {
    const m = findHeading(raw, key);
    if (m) found.push({ key, start: m.index, bodyStart: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  const sections: Record<string, string> = {};
  found.forEach((h, i) => {
    const end = i + 1 < found.length ? found[i + 1].start : raw.length;
    sections[h.key] = raw.slice(h.bodyStart, end).trim();
  });
  return { raw, sections };
}

// ── JSON recovery ───────────────────────────────────────────────────────────

/** End index (exclusive) of the balanced JSON value starting at `start`, or -1 when it never closes. */
function balancedEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") stack.push(ch === "[" ? "]" : "}");
    else if (ch === "]" || ch === "}") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/** Truncated array (e.g. clipped by a context limit): keep every COMPLETE top-level object. */
function salvageArray(text: string, start: number): unknown[] | undefined {
  const items: unknown[] = [];
  let i = start + 1;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const end = balancedEnd(text, open);
    if (end < 0) break;
    try {
      items.push(JSON.parse(text.slice(open, end)));
    } catch {
      break;
    }
    i = end;
  }
  return items.length > 0 ? items : undefined;
}

/** First parseable JSON array/object in `text` (fences and surrounding prose are ignored). */
export function findFirstJson(text: string, want: "array" | "object" | "any" = "any"): unknown {
  const opener = want === "array" ? /\[/g : want === "object" ? /\{/g : /[[{]/g;
  for (const m of text.matchAll(opener)) {
    const start = m.index ?? 0;
    const end = balancedEnd(text, start);
    if (end > 0) {
      try {
        return JSON.parse(text.slice(start, end));
      } catch {
        continue; // e.g. "[1]" inside prose like "see [note]" — keep scanning
      }
    }
    if (text[start] === "[") {
      const salvaged = salvageArray(text, start);
      if (salvaged) return salvaged;
    }
  }
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type InputRecord = Record<string, unknown>;

export interface StatsInput {
  total?: number;
  groups: Array<{ key: string; count: number; share?: number }>;
  numeric: Record<string, Record<string, number>>;
}

/** Accepts `[...]` and, defensively, `{ records: [...] }`. */
function asRecords(value: unknown): InputRecord[] | undefined {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.records) ? value.records : undefined;
  return list?.filter(isRecord);
}

/** compute_stats output: `{ total, groups: [{ key, count, share }], numeric: { field: { sum, mean, … } } }`. */
function asStats(value: unknown): StatsInput | undefined {
  if (!isRecord(value)) return undefined;
  const groups = Array.isArray(value.groups)
    ? value.groups.filter(isRecord).flatMap((g) => {
        const count = Number(g.count);
        return Number.isFinite(count) ? [{ key: String(g.key ?? "unknown"), count, share: typeof g.share === "number" ? g.share : undefined }] : [];
      })
    : [];
  const numeric: StatsInput["numeric"] = {};
  if (isRecord(value.numeric)) {
    for (const [field, summary] of Object.entries(value.numeric)) {
      if (!isRecord(summary)) continue;
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(summary)) if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
      numeric[field] = clean;
    }
  }
  const total = typeof value.total === "number" ? value.total : undefined;
  if (total === undefined && groups.length === 0 && Object.keys(numeric).length === 0) return undefined;
  return { total, groups, numeric };
}

/**
 * The structured values an analyst-style agent was handed. Sections are inspected by SHAPE rather than by
 * name (an array of objects is "records", a `{ total | groups | numeric }` object is "stats"), so blueprints
 * that use other context keys still work. With no recognisable sections, falls back to the first JSON array.
 */
export function readStructuredInputs(input: AgentInput): { records?: InputRecord[]; stats?: StatsInput } {
  let records: InputRecord[] | undefined;
  let stats: StatsInput | undefined;
  const ordered = Object.keys(input.sections).sort((a, b) => Number(b === "records" || b === "stats") - Number(a === "records" || a === "stats"));
  for (const key of ordered) {
    if (key === "job_brief" || key === "instructions") continue;
    const value = findFirstJson(input.sections[key]);
    if (value === undefined) continue;
    const asStatsValue = Array.isArray(value) ? undefined : asStats(value);
    if (asStatsValue) stats ??= asStatsValue;
    else records ??= asRecords(value);
  }
  if (!records && Object.keys(input.sections).length === 0) records = asRecords(findFirstJson(input.raw, "array"));
  return { records, stats };
}
