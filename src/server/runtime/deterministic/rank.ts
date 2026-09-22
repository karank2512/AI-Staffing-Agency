import { asRecords, isMissing, toNumber, type DataRecord } from "./records";
import type { OpResult } from "./result";

/**
 * Sort by a field (numeric when the values parse as numbers — "$12.5M" counts — else text), keep the top N and
 * stamp a 1-based `rank`. Missing values always sort last; ties keep their original order.
 */
export function rank(input: unknown, config: { by: string; direction: "asc" | "desc"; limit?: number }): OpResult<DataRecord[]> {
  const records = asRecords(input);
  const sign = config.direction === "asc" ? 1 : -1;
  const keyed = records.map((record, index) => {
    const raw = record[config.by];
    return { record, index, missing: isMissing(raw), num: toNumber(raw), text: isMissing(raw) ? "" : String(raw).trim().toLowerCase() };
  });
  keyed.sort((a, b) => {
    if (a.missing !== b.missing) return a.missing ? 1 : -1;
    if (a.num !== undefined && b.num !== undefined) return sign * (a.num - b.num) || a.index - b.index;
    if (a.num !== undefined) return -1;
    if (b.num !== undefined) return 1;
    return sign * a.text.localeCompare(b.text) || a.index - b.index;
  });
  const limited = config.limit ? keyed.slice(0, config.limit) : keyed;
  const ranked = limited.map((k, i) => ({ ...k.record, rank: i + 1 }));
  const numeric = keyed.filter((k) => k.num !== undefined).length;
  return {
    value: ranked,
    summary: { before: records.length, after: ranked.length, by: config.by, direction: config.direction, limit: config.limit, numericValues: numeric },
    detail: `${ranked.length} of ${records.length} records ranked by ${config.by} (${config.direction === "desc" ? "highest" : "lowest"} first)`,
  };
}
