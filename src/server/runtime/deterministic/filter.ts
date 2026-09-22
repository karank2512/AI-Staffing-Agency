import { asRecords, isMissing, normalizeKey, toNumber, type DataRecord } from "./records";
import type { OpResult } from "./result";

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "exists";

export interface FilterConfig {
  field: string;
  op: FilterOp;
  value?: string | number | boolean;
}

function equalsLoose(actual: unknown, expected: string | number | boolean): boolean {
  const a = toNumber(actual);
  const e = toNumber(expected);
  if (a !== undefined && e !== undefined) return a === e;
  if (typeof expected === "boolean") return typeof actual === "boolean" ? actual === expected : normalizeKey(actual) === String(expected);
  return normalizeKey(actual) === normalizeKey(expected);
}

function contains(actual: unknown, expected: string | number | boolean): boolean {
  const needle = normalizeKey(expected);
  if (needle === "") return false;
  if (Array.isArray(actual)) return actual.some((item) => normalizeKey(item).includes(needle));
  return normalizeKey(actual).includes(needle);
}

export function matches(record: DataRecord, config: FilterConfig): boolean {
  const actual = record[config.field];
  if (config.op === "exists") return !isMissing(actual);
  if (config.value === undefined) return false;
  switch (config.op) {
    case "eq":
      return equalsLoose(actual, config.value);
    case "neq":
      return !equalsLoose(actual, config.value);
    case "contains":
      return contains(actual, config.value);
    default: {
      const a = toNumber(actual);
      const e = toNumber(config.value);
      if (a === undefined || e === undefined) return false;
      if (config.op === "gt") return a > e;
      if (config.op === "gte") return a >= e;
      if (config.op === "lt") return a < e;
      return a <= e;
    }
  }
}

/** Keep the records matching one condition. Numeric comparisons coerce "$12.5M"-style strings. */
export function filter(input: unknown, config: FilterConfig): OpResult<DataRecord[]> {
  const records = asRecords(input);
  const kept = records.filter((record) => matches(record, config));
  const condition = config.op === "exists" ? `${config.field} exists` : `${config.field} ${config.op} ${JSON.stringify(config.value)}`;
  return {
    value: kept,
    summary: { before: records.length, after: kept.length, removed: records.length - kept.length, condition },
    detail: `${kept.length} of ${records.length} records match ${condition}`,
  };
}
