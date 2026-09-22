import { asRecords, isMissing, toNumber } from "./records";
import type { OpResult } from "./result";

export interface GroupStat {
  key: string;
  count: number;
  /** 0..1 */
  share: number;
}

export interface NumericStat {
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  median: number;
}

export interface Stats {
  total: number;
  groups: GroupStat[];
  numeric: Record<string, NumericStat>;
}

const UNKNOWN_GROUP = "unknown";
const round = (n: number) => Math.round(n * 100) / 100;
/** Shares are 0..1 with four decimals so a 1-in-300 group still shows as 0.0033 rather than 0. */
const roundShare = (n: number) => Math.round(n * 10_000) / 10_000;

function groupLabel(value: unknown): string {
  if (isMissing(value)) return UNKNOWN_GROUP;
  return typeof value === "string" ? value.trim() : String(value);
}

/** Counts by group (share of total) and numeric summaries — the `stats` context value analysts and reports read. */
export function computeStats(input: unknown, config: { groupBy?: string; numericFields: string[] }): OpResult<Stats> {
  const records = asRecords(input);
  const total = records.length;

  const groups: GroupStat[] = [];
  if (config.groupBy) {
    const counts = new Map<string, number>();
    for (const record of records) {
      const key = groupLabel(record[config.groupBy]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) groups.push({ key, count, share: total === 0 ? 0 : roundShare(count / total) });
    groups.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  const numeric: Record<string, NumericStat> = {};
  for (const field of config.numericFields) {
    const values = records.map((r) => toNumber(r[field])).filter((n): n is number => n !== undefined);
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((s, n) => s + n, 0);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    numeric[field] = { count: values.length, sum: round(sum), mean: round(sum / values.length), min: sorted[0], max: sorted[sorted.length - 1], median: round(median) };
  }

  const parts = [`${total} records`];
  if (config.groupBy) parts.push(`${groups.length} ${config.groupBy} group${groups.length === 1 ? "" : "s"}`);
  const numericFields = Object.keys(numeric);
  if (numericFields.length > 0) parts.push(`summaries for ${numericFields.join(", ")}`);
  return {
    value: { total, groups, numeric },
    summary: { total, groupBy: config.groupBy, groups: groups.slice(0, 12), numeric },
    detail: parts.join(" · "),
  };
}
