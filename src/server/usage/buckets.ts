import { eachDayOfInterval, format } from "date-fns";

/** Pure helpers for day bucketing. Everything here works on SERVER-LOCAL calendar days (date-fns uses local time). */

export const DAY_FORMAT = "yyyy-MM-dd";

export function dayKey(date: Date): string {
  return format(date, DAY_FORMAT);
}

/** Every local calendar day touched by [from, to], in order. */
export function dayKeysBetween(from: Date, to: Date): string[] {
  return eachDayOfInterval({ start: from, end: to }).map(dayKey);
}

/** Money is stored as Decimal(12,6); rounding the JS sums to the same scale removes float dust (0.30000000000000004). */
export function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/** Insert-or-get for the aggregation maps. */
export function bucket<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = init();
    map.set(key, value);
  }
  return value;
}
