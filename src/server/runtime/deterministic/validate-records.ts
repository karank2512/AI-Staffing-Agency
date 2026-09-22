import { asRecords, isMissing, type DataRecord } from "./records";
import type { OpResult } from "./result";

/** Check every record has the required fields; drop the incomplete ones when `dropInvalid` is set. */
export function validateRecords(input: unknown, config: { requiredFields: string[]; dropInvalid: boolean }): OpResult<DataRecord[]> {
  const records = asRecords(input);
  const missingByField = new Map<string, number>();
  const valid: DataRecord[] = [];
  let invalid = 0;
  for (const record of records) {
    const missing = config.requiredFields.filter((field) => isMissing(record[field]));
    if (missing.length === 0) {
      valid.push(record);
      continue;
    }
    invalid += 1;
    for (const field of missing) missingByField.set(field, (missingByField.get(field) ?? 0) + 1);
  }
  const kept = config.dropInvalid ? valid : records;
  const dropped = records.length - kept.length;
  const gaps = [...missingByField.entries()].sort((a, b) => b[1] - a[1]).map(([field, count]) => ({ field, missing: count }));
  return {
    value: kept,
    summary: { before: records.length, after: kept.length, invalid, dropped, requiredFields: config.requiredFields, missingByField: gaps },
    detail:
      invalid === 0
        ? `${records.length} records, all complete`
        : config.dropInvalid
          ? `${records.length} → ${kept.length} records (${dropped} dropped: ${gaps.map((g) => `${g.field} ×${g.missing}`).join(", ")})`
          : `${invalid} of ${records.length} records incomplete (kept)`,
  };
}
