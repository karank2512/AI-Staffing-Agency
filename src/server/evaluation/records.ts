/**
 * Pure record helpers shared by the deterministic checks and the simulated judge, so both agree on what
 * "filled" and "duplicate" mean.
 */

export type EvalRecord = Record<string, unknown>;

/** Values workers write when they could not find something — a required cell holding one is NOT filled. */
const PLACEHOLDER_VALUES = new Set(["n/a", "na", "unknown", "tbd", "-", "--", "—", "null", "undefined", "?"]);

function isPlainObject(value: unknown): value is EvalRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deliverable.data → records when it is an array of objects (an empty array counts), else null. */
export function asRecords(data: unknown): EvalRecord[] | null {
  if (!Array.isArray(data)) return null;
  return data.every(isPlainObject) ? (data as EvalRecord[]) : null;
}

export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && !PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true; // booleans — `false` is an answer, not a gap
}

export interface CompletenessStats {
  /** Required cells that hold a real value. */
  filled: number;
  /** records × fields. */
  total: number;
  /** filled / total; 0 when there is nothing to measure. */
  completeness: number;
  /** Records with EVERY listed field filled. */
  completeRecords: number;
  /** Per field: how many records are missing it (only fields with at least one gap). */
  missingByField: Array<{ field: string; missing: number }>;
}

export function completenessStats(records: readonly EvalRecord[], fields: readonly string[]): CompletenessStats {
  const missing = new Map<string, number>();
  let filled = 0;
  let completeRecords = 0;
  for (const record of records) {
    let complete = true;
    for (const field of fields) {
      if (isFilled(record[field])) {
        filled += 1;
      } else {
        complete = false;
        missing.set(field, (missing.get(field) ?? 0) + 1);
      }
    }
    if (complete) completeRecords += 1;
  }
  const total = records.length * fields.length;
  return {
    filled,
    total,
    completeness: total === 0 ? 0 : filled / total,
    completeRecords,
    missingByField: fields
      .filter((field) => missing.has(field))
      .map((field) => ({ field, missing: missing.get(field) ?? 0 }))
      .sort((a, b) => b.missing - a.missing),
  };
}

function normalizeKeyPart(value: unknown): string {
  if (!isFilled(value)) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface DuplicateStats {
  total: number;
  unique: number;
  duplicates: number;
  /** Up to 3 key values that appear more than once (for human-readable evidence). */
  examples: string[];
}

/**
 * Case/whitespace-insensitive duplicate detection on `keyFields`. A record whose key is entirely empty is
 * counted as unique: two rows that both lack a company name are a completeness problem, not a duplicate.
 */
export function duplicateStats(records: readonly EvalRecord[], keyFields: readonly string[]): DuplicateStats {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  let unique = 0;
  for (const record of records) {
    const parts = keyFields.map((field) => normalizeKeyPart(record[field]));
    if (parts.every((part) => part === "")) {
      unique += 1;
      continue;
    }
    const key = parts.join("␟");
    if (seen.has(key)) {
      repeated.add(parts.filter(Boolean).join(" / "));
    } else {
      seen.add(key);
      unique += 1;
    }
  }
  return { total: records.length, unique, duplicates: records.length - unique, examples: [...repeated].slice(0, 3) };
}
