/**
 * Final-answer JSON parsing for json-output agents. Live models wrap answers in ```json fences, add a sentence
 * of prose, or return `{ records: [...] }` instead of the bare array — all of that is tolerated here so the
 * repair turn is only needed for genuinely broken output.
 */

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string };

const FENCE = /^\s*```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```\s*$/;
const WRAPPER_KEYS = ["records", "data", "items", "results", "rows"] as const;

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

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** First balanced JSON array/object embedded in prose. */
function embeddedJson(text: string): unknown | undefined {
  for (const m of text.matchAll(/[[{]/g)) {
    const start = m.index ?? 0;
    const end = balancedEnd(text, start);
    if (end < 0) continue;
    const value = tryParse(text.slice(start, end));
    if (value !== undefined) return value;
  }
  return undefined;
}

/** `{ records: [...] }` (or a similar single-list wrapper) → the list itself. */
function unwrap(value: unknown): unknown {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const key of WRAPPER_KEYS) {
    if (Array.isArray(obj[key]) && keys.every((k) => k === key || !Array.isArray(obj[k]))) return obj[key];
  }
  return value;
}

export function parseJsonAnswer(text: string): ParsedJson {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: "the answer was empty" };
  const fenced = FENCE.exec(trimmed);
  const candidates = fenced ? [fenced[1].trim(), trimmed] : [trimmed];
  for (const candidate of candidates) {
    const direct = tryParse(candidate);
    if (direct !== undefined) return { ok: true, value: unwrap(direct) };
  }
  const embedded = embeddedJson(trimmed);
  if (embedded !== undefined) return { ok: true, value: unwrap(embedded) };
  return { ok: false, error: "no valid JSON array or object was found in the answer" };
}
