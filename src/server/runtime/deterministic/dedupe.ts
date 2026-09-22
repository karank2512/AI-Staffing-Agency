import { asRecords, normalizeKey, type DataRecord } from "./records";
import type { OpResult } from "./result";

/**
 * Keep the first record for each key (case/whitespace-insensitive over `keyFields`). A record whose key is
 * entirely empty is kept: two rows that both lack a company name are a completeness problem, not a duplicate.
 */
export function dedupe(input: unknown, config: { keyFields: string[] }): OpResult<DataRecord[]> {
  const records = asRecords(input);
  const seen = new Set<string>();
  const kept: DataRecord[] = [];
  const examples: string[] = [];
  for (const record of records) {
    const parts = config.keyFields.map((field) => normalizeKey(record[field]));
    if (parts.every((part) => part === "")) {
      kept.push(record);
      continue;
    }
    const key = parts.join("␟");
    if (seen.has(key)) {
      if (examples.length < 3) examples.push(parts.filter(Boolean).join(" / "));
      continue;
    }
    seen.add(key);
    kept.push(record);
  }
  const removed = records.length - kept.length;
  return {
    value: kept,
    summary: { before: records.length, after: kept.length, removed, keyFields: config.keyFields, examples },
    detail: removed === 0 ? `${records.length} records, no duplicates` : `${records.length} → ${kept.length} records (${removed} duplicate${removed === 1 ? "" : "s"} removed)`,
  };
}
