/**
 * Final-answer JSON parsing for json-output agents. Live models wrap answers in ```json fences, add a sentence
 * of prose, or return `{ records: [...] }` instead of the bare array — all of that is tolerated here so the
 * repair turn is only needed for genuinely broken output.
 */

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string };

/** A fenced block anywhere in the answer ("Here are the rounds:\n```json\n[...]\n```"). */
const FENCES = /```[ \t]*(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/g;
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

function isStructured(value: unknown): boolean {
  return value !== null && typeof value === "object";
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

interface Candidate {
  value: unknown;
  length: number;
}

/** Records beat a single object, which beats a list of scalars (a citation like "[1]" is never the answer). */
function rank(value: unknown): number {
  if (Array.isArray(value)) return value.length > 0 && value.every((v) => isStructured(v) && !Array.isArray(v)) ? 3 : 1;
  return 2;
}

function best(candidates: Candidate[]): unknown | undefined {
  let pick: (Candidate & { score: number }) | undefined;
  for (const c of candidates) {
    const value = unwrap(c.value);
    const score = rank(value);
    if (!pick || score > pick.score || (score === pick.score && c.length > pick.length)) pick = { value, length: c.length, score };
  }
  return pick?.value;
}

/** Every top-level balanced JSON array/object embedded in prose (non-overlapping, left to right). */
function embeddedCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  let from = 0;
  for (const m of text.matchAll(/[[{]/g)) {
    const start = m.index ?? 0;
    if (start < from) continue;
    const end = balancedEnd(text, start);
    if (end < 0) continue;
    const value = tryParse(text.slice(start, end));
    if (value === undefined || !isStructured(value)) continue;
    out.push({ value, length: end - start });
    from = end;
  }
  return out;
}

export function parseJsonAnswer(text: string): ParsedJson {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, error: "the answer was empty" };

  const direct = tryParse(trimmed);
  if (direct !== undefined) {
    if (isStructured(direct)) return { ok: true, value: unwrap(direct) };
    // "No funding rounds found" as a JSON string is prose, not records: let the repair turn ask again.
    return { ok: false, error: "the answer was a single JSON value, not an array or object" };
  }

  // A fenced block is the model telling us where the answer is; prose around it may contain "[1]"-style noise.
  const fenced = [...trimmed.matchAll(FENCES)].flatMap((m): Candidate[] => {
    const body = m[1].trim();
    const value = tryParse(body);
    if (value !== undefined) return isStructured(value) ? [{ value, length: body.length }] : [];
    return embeddedCandidates(body);
  });
  const chosen = best(fenced) ?? best(embeddedCandidates(trimmed));
  if (chosen !== undefined) return { ok: true, value: chosen };
  return { ok: false, error: "no valid JSON array or object was found in the answer" };
}
