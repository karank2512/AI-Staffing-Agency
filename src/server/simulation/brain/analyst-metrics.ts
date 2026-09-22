import { normalizeKey } from "../text";
import type { InputRecord, StatsInput } from "./input";

/**
 * The numbers behind the analyst's markdown, computed from the records/stats the agent was actually given
 * (never from the fixtures — the analyst only knows what is in its input message).
 */

export interface GroupEntry {
  key: string;
  count: number;
  /** 0..1 */
  share: number;
}

export interface GroupMetric {
  field: string;
  label: string;
  entries: GroupEntry[];
}

export interface NumericMetric {
  field: string;
  label: string;
  money: boolean;
  /**
   * True for SLA / deadline / time-left / priority-rank style numbers, where the SMALLEST value needs attention
   * first. `top` is then ordered ascending (most urgent first) and a sum is meaningless.
   */
  lowerIsUrgent: boolean;
  sum: number;
  mean: number;
  max: number;
  min: number;
  /** How many records sit exactly at `min` (0 when only stats were given). */
  atMin: number;
  top: Array<{ name: string; value: number }>;
}

export interface Metrics {
  total: number;
  nameField: string | null;
  /** The main way to slice the records (category, stage, team …). */
  group: GroupMetric | null;
  /** A sentiment / severity / priority style split, when present and distinct from `group`. */
  secondary: GroupMetric | null;
  numeric: NumericMetric | null;
  recency: { field: string; label: string; last14: number; last30: number } | null;
  /**
   * `missing` counts records lacking a REQUIRED spec field (any blank field when the records do not follow the
   * spec); `duplicates` uses the blueprint's keyFields when known, else an identifier heuristic.
   */
  quality: { missing: number; duplicates: number };
}

const PRIMARY_GROUPS = [
  "category", "theme", "topic", "stage", "round", "funding_stage", "sector", "segment", "industry", "vertical", "team", "owner_team",
  "owner", "plan", "channel", "status", "region", "country", "lead_investor", "investor", "hq", "location", "pricing_model",
];
const SECONDARY_GROUPS = ["sentiment", "severity", "priority", "urgency", "tone", "polarity", "impact"];
const NAME_FIELDS = ["company", "company_name", "name", "title", "subject", "customer", "contact_name", "id"];
/** Duplicate detection keys on an identifier when there is one (many feedback items share a customer). */
const ID_FIELDS = ["id", "ticket_id", "feedback_id", "record_id", "company", "company_name", "name", "title", "subject", "contact_email", "email"];
const MONEY_RE = /(usd|amount|price|revenue|valuation|cost|budget|spend|arr|mrr|raised|funding|deal)/;
const NUMERIC_RE = /(score|employees|headcount|count|size|total|value|number|rating|nps|hours)/;
const DATE_RE = /(date|_on$|_at$|announced|received|created|published|opened|updated)/;
/** A smaller number is more urgent: SLAs, deadlines, time left, priority ranks where 1 = most urgent … */
const LOWER_IS_URGENT_RE = /(^|_)(sla|due|deadline|priority|urgency|rank)(_|$)|_(hours|days)$|^(hours|days)_(to|until|left|remaining)/;
/** … unless it counts time already spent (older / more overdue is the urgent end) or is a score/amount. */
const NOT_LOWER_IS_URGENT_RE = /(overdue|late|age|aged|open|since|elapsed|ago|worked|spent|billable|logged|waiting|score|rating|value|saved)/;
const MAX_GROUP_VALUES = 15;
const TOP_ITEMS = 5;
const DAY_MS = 86_400_000;

const LABELS: Record<string, string> = {
  amount_usd: "round size",
  amount: "round size",
  round_size: "round size",
  round_size_usd: "round size",
  raised: "amount raised",
  employees: "headcount",
  headcount: "headcount",
  fit_score: "fit score",
  lead_investor: "lead investor",
  starting_price_usd: "starting price",
  sla_hours: "SLA hours",
};

export function isLowerUrgent(field: string): boolean {
  const key = normalizeKey(field);
  return LOWER_IS_URGENT_RE.test(key) && !NOT_LOWER_IS_URGENT_RE.test(key) && !MONEY_RE.test(key);
}

export function labelFor(field: string): string {
  const key = normalizeKey(field);
  return LABELS[key] ?? key.replace(/_usd$/, "").replace(/_/g, " ");
}

function keyOf(records: readonly InputRecord[]): (name: string) => string | undefined {
  const keys = new Map<string, string>();
  for (const r of records) for (const k of Object.keys(r)) if (!keys.has(normalizeKey(k))) keys.set(normalizeKey(k), k);
  return (name) => keys.get(name);
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim().length === 0);
}

function groupBy(records: readonly InputRecord[], field: string): GroupEntry[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const v = r[field];
    if (isBlank(v) || typeof v === "object") continue;
    const key = String(v).trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = records.length;
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function pickGroup(records: readonly InputRecord[], candidates: readonly string[], exclude: string | null, maxValues: number): GroupMetric | null {
  const key = keyOf(records);
  const allKeys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const ordered = [...candidates.map((c) => key(c)).filter((k): k is string => k !== undefined), ...allKeys];
  const tried = new Set<string>();
  for (const field of ordered) {
    if (tried.has(field) || field === exclude) continue;
    tried.add(field);
    const entries = groupBy(records, field);
    const covered = entries.reduce((s, e) => s + e.count, 0);
    const repeated = entries.some((e) => e.count > 1);
    if (entries.length >= 2 && entries.length <= maxValues && covered >= records.length * 0.6 && repeated) {
      return { field, label: labelFor(field), entries };
    }
  }
  return null;
}

function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return v.trim().length > 0 && Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickNumeric(records: readonly InputRecord[], nameField: string | null): NumericMetric | null {
  const allKeys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const usable = (field: string) => {
    if (field === "rank" || field === nameField) return false;
    const key = normalizeKey(field);
    if (DATE_RE.test(key) || /(^|_)id$/.test(key)) return false;
    const values = records.map((r) => numberOf(r[field])).filter((n): n is number => n !== null);
    return values.length >= Math.max(1, records.length * 0.5);
  };
  const field =
    allKeys.find((k) => MONEY_RE.test(normalizeKey(k)) && usable(k)) ??
    allKeys.find((k) => NUMERIC_RE.test(normalizeKey(k)) && usable(k)) ??
    allKeys.find((k) => typeof records[0]?.[k] === "number" && usable(k));
  if (!field) return null;
  const rows = records
    .map((r) => ({ name: nameField ? String(r[nameField] ?? "").trim() : "", value: numberOf(r[field]) }))
    .filter((x): x is { name: string; value: number } => x.value !== null);
  const values = rows.map((x) => x.value);
  const sum = values.reduce((a, b) => a + b, 0);
  const lowerIsUrgent = isLowerUrgent(field);
  return {
    field,
    label: labelFor(field),
    money: MONEY_RE.test(normalizeKey(field)),
    lowerIsUrgent,
    sum,
    mean: values.length > 0 ? sum / values.length : 0,
    max: Math.max(...values),
    min: Math.min(...values),
    atMin: values.filter((v) => v === Math.min(...values)).length,
    top: rows
      .slice()
      .sort((a, b) => (lowerIsUrgent ? a.value - b.value : b.value - a.value) || a.name.localeCompare(b.name))
      .slice(0, TOP_ITEMS)
      .filter((x) => x.name.length > 0),
  };
}

function pickRecency(records: readonly InputRecord[], now: Date): Metrics["recency"] {
  const allKeys = [...new Set(records.flatMap((r) => Object.keys(r)))];
  for (const field of allKeys) {
    if (!DATE_RE.test(normalizeKey(field))) continue;
    const dates = records
      .map((r) => (typeof r[field] === "string" ? Date.parse((r[field] as string).slice(0, 10)) : NaN))
      .filter((t) => Number.isFinite(t));
    if (dates.length < Math.max(1, records.length * 0.5)) continue;
    const ageDays = dates.map((t) => (now.getTime() - t) / DAY_MS);
    return {
      field,
      label: labelFor(field),
      last14: ageDays.filter((d) => d <= 14).length,
      last30: ageDays.filter((d) => d <= 30).length,
    };
  }
  return null;
}

/** compute_stats output does not say which field it grouped by; the spec's own field names are the best guess. */
export function groupLabelHint(fieldNames: readonly string[]): string {
  const normalized = fieldNames.map(normalizeKey);
  const hit = PRIMARY_GROUPS.find((g) => normalized.includes(g)) ?? SECONDARY_GROUPS.find((g) => normalized.includes(g));
  return hit ? labelFor(hit) : "group";
}

function fromStats(stats: StatsInput, groupLabel: string): Pick<Metrics, "group" | "numeric" | "total"> {
  const total = stats.total ?? stats.groups.reduce((s, g) => s + g.count, 0);
  const group: GroupMetric | null =
    stats.groups.length > 0
      ? {
          field: "group",
          label: groupLabel,
          entries: stats.groups
            .map((g) => ({ key: g.key, count: g.count, share: g.share ?? (total > 0 ? g.count / total : 0) }))
            .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
        }
      : null;
  const [field, summary] = Object.entries(stats.numeric)[0] ?? [];
  const numeric: NumericMetric | null =
    field && summary
      ? {
          field,
          label: labelFor(field),
          money: MONEY_RE.test(normalizeKey(field)),
          lowerIsUrgent: isLowerUrgent(field),
          sum: summary.sum ?? summary.total ?? 0,
          mean: summary.mean ?? summary.avg ?? summary.average ?? 0,
          max: summary.max ?? 0,
          min: summary.min ?? 0,
          atMin: 0,
          top: [],
        }
      : null;
  return { total, group, numeric };
}

/** Record keys for the given field names (spec / blueprint spelling → the records' own spelling). */
function resolve(records: readonly InputRecord[], names: readonly string[]): string[] {
  const key = keyOf(records);
  return names.map((n) => key(normalizeKey(n)) ?? n);
}

/**
 * Records missing a REQUIRED spec field. Optional fields left blank are not a data-quality problem. Falls back to
 * "any blank field" when the spec lists no fields or the records do not follow it (none of its fields appear).
 */
function countMissing(records: readonly InputRecord[], spec: ReadonlyArray<{ name: string; required: boolean }> | undefined): number {
  const key = keyOf(records);
  const followsSpec = (spec ?? []).some((f) => key(normalizeKey(f.name)) !== undefined);
  if (!spec || !followsSpec) return records.filter((r) => Object.values(r).some(isBlank)).length;
  const required = resolve(
    records,
    spec.filter((f) => f.required).map((f) => f.name),
  );
  return records.filter((r) => required.some((k) => isBlank(r[k]))).length;
}

const partOf = (v: unknown) => (isBlank(v) ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)).toLowerCase().replace(/\s+/g, " ").trim());

/**
 * Duplicates the way the blueprint's dedupe step defines them — ALL keyFields together, case/whitespace-insensitive,
 * a record whose key is entirely blank never counting — so "vendor + plan" workers do not flag every second plan.
 * Without keyFields (or when none of them appear in the records) an identifier heuristic stands in.
 */
function countDuplicates(records: readonly InputRecord[], keyFields: readonly string[] | undefined, fallbackField: string | null): number {
  const key = keyOf(records);
  const known = keyFields && keyFields.some((f) => key(normalizeKey(f)) !== undefined);
  const fields = known ? resolve(records, keyFields) : fallbackField ? [fallbackField] : [];
  if (fields.length === 0) return 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of records) {
    const parts = fields.map((f) => partOf(r[f]));
    if (parts.every((p) => p === "")) continue;
    const id = parts.join("\u241f");
    if (seen.has(id)) duplicates++;
    else seen.add(id);
  }
  return duplicates;
}

export function computeMetrics(args: {
  records?: InputRecord[];
  stats?: StatsInput;
  now: Date;
  groupLabel?: string;
  /** The spec's fields — their `required` flags decide what counts as a missing field. */
  specFields?: ReadonlyArray<{ name: string; required: boolean }>;
  /** The blueprint's dedupe keyFields, when the caller knows them. */
  keyFields?: readonly string[];
}): Metrics {
  const records = args.records ?? [];
  const groupLabel = args.groupLabel ?? "group";
  if (records.length === 0) {
    const base = args.stats ? fromStats(args.stats, groupLabel) : { total: 0, group: null, numeric: null };
    return { ...base, nameField: null, secondary: null, recency: null, quality: { missing: 0, duplicates: 0 } };
  }
  const key = keyOf(records);
  const nameField = NAME_FIELDS.map((n) => key(n)).find((k): k is string => k !== undefined) ?? Object.keys(records[0]).find((k) => typeof records[0][k] === "string") ?? null;
  const group = pickGroup(records, PRIMARY_GROUPS, nameField, MAX_GROUP_VALUES) ?? (args.stats ? fromStats(args.stats, groupLabel).group : null);
  const secondary = pickGroup(records, SECONDARY_GROUPS, group?.field ?? null, 6);
  const secondaryIsListed = secondary !== null && SECONDARY_GROUPS.includes(normalizeKey(secondary.field));

  const idField = ID_FIELDS.map((n) => key(n)).find((k): k is string => k !== undefined) ?? nameField;
  return {
    total: records.length,
    nameField,
    group,
    secondary: secondaryIsListed ? secondary : null,
    numeric: pickNumeric(records, nameField),
    recency: pickRecency(records, args.now),
    quality: { missing: countMissing(records, args.specFields), duplicates: countDuplicates(records, args.keyFields, idField) },
  };
}
