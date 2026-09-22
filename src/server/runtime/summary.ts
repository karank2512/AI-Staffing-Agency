import type { WorkerBlueprint } from "@/server/domain/blueprint";
import type { JobSpec } from "@/server/domain/job-spec";
import { clipPlain, markdownProse } from "@/server/tools";
import { oneLine } from "./compact";

/**
 * The Deliverable's "In short" line. Only a markdown document has prose to quote; a CSV/JSON deliverable's
 * content is data (its header row is not a summary), so it gets a sentence built from its records instead:
 * "15 funding rounds, ranked by amount — top: Ridgeline GPU ($210M), Parallax Serve ($150M), Halcyon Compute ($85M)."
 */

export const SUMMARY_CHARS = 280;

type Row = Record<string, unknown>;

const NAME_FIELDS = ["company", "company_name", "name", "vendor", "title", "subject", "customer", "contact_name", "id"];
const MONEY_RE = /(usd|amount|price|cost|spend|revenue|arr|mrr|budget|valuation)/;

/** Plain-text opening of a markdown document: no headings, tables, code, list markers or emphasis. "" when none. */
export function narrativeSummary(content: string, max = SUMMARY_CHARS): string {
  return clipPlain(markdownProse(content), max);
}

function pluralNoun(noun: string, n: number): string {
  if (n === 1) return noun;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** What one record is, in the customer's terms (by job family first, then by the spec's field names). */
function recordNoun(spec: JobSpec): string {
  const words = new Set(spec.deliverable.fields.flatMap((f) => f.name.toLowerCase().split(/[^a-z]+/)));
  const has = (...w: string[]) => w.some((x) => words.has(x));
  if (spec.jobFamily === "support_triage" || has("ticket")) return "ticket";
  if (spec.jobFamily === "feedback_analysis" || has("sentiment", "feedback")) return "feedback item";
  if (spec.jobFamily === "lead_research" || has("contact")) return "lead";
  if (has("plan", "pricing")) return "pricing record";
  if (has("stage", "round", "investor")) return "funding round";
  if (has("vendor", "subscription", "transaction", "invoice")) return "line item";
  if (has("company", "competitor")) return "company";
  return "record";
}

function fieldLabel(field: string): string {
  return field.replace(/_usd$/i, "").replace(/[_-]+/g, " ").trim().toLowerCase();
}

function shortUsd(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, unit: string) => `$${Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (abs >= 1e9) return fmt(Math.round((n / 1e9) * 10) / 10, "B");
  if (abs >= 1e6) return fmt(Math.round((n / 1e6) * 10) / 10, "M");
  if (abs >= 1e4) return fmt(Math.round(n / 1e3), "K");
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function numeric(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nameFieldOf(records: Row[], spec: JobSpec): string | undefined {
  const keys = new Set(records.flatMap((r) => Object.keys(r)));
  const filled = (k: string) => records.some((r) => typeof r[k] === "string" && (r[k] as string).trim().length > 0);
  return (
    NAME_FIELDS.find((k) => keys.has(k) && filled(k)) ??
    spec.deliverable.fields.map((f) => f.name).find((k) => keys.has(k) && filled(k)) ??
    [...keys].find((k) => k !== "rank" && filled(k))
  );
}

/** The field the blueprint ranks the deliverable's records by (the rank step on the data key), if any. */
function rankFieldOf(blueprint: WorkerBlueprint): string | undefined {
  const dataKey = blueprint.deliverable.dataKey ?? blueprint.deliverable.contentKey;
  const rank = blueprint.components.find((c) => c.type === "deterministic" && c.operation === "rank" && c.outputKey === dataKey);
  return rank && rank.type === "deterministic" && rank.operation === "rank" ? rank.config.by : undefined;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function recordsSummary(records: Row[], blueprint: WorkerBlueprint, spec: JobSpec): string {
  const noun = recordNoun(spec);
  if (records.length === 0) return `No ${pluralNoun(noun, 0)} made it into this deliverable.`;
  const count = `${records.length} ${pluralNoun(noun, records.length)}`;
  const nameField = nameFieldOf(records, spec);
  if (!nameField) return `${count}.`;

  // "Ranked" only once the rank step has actually run (it stamps a 1-based `rank`): a JSON deliverable is created
  // from the collector's output, before any cleaning or ranking.
  const ranked = records.every((r) => typeof r.rank === "number");
  const rankBy = ranked ? rankFieldOf(blueprint) : undefined;
  const ordered = rankBy ? records.slice().sort((a, b) => Number(a.rank) - Number(b.rank)) : records;
  const top = ordered.filter((r) => typeof r[nameField] === "string" && (r[nameField] as string).trim()).slice(0, 3);
  if (top.length === 0) return `${count}.`;

  const money = rankBy ? MONEY_RE.test(rankBy.toLowerCase()) : false;
  const label = (r: Row) => {
    const name = oneLine(String(r[nameField]), 60);
    const value = rankBy ? numeric(r[rankBy]) : null;
    return value === null ? name : `${name} (${money ? shortUsd(value) : value.toLocaleString("en-US")})`;
  };
  return rankBy
    ? `${count}, ranked by ${fieldLabel(rankBy)} — top: ${top.map(label).join(", ")}.`
    : `${count}, including ${joinNames(top.map(label))}.`;
}

function csvShape(csv: string): string | null {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const columns = lines[0].split(",").length;
  const rows = lines.length - 1;
  return `${rows} row${rows === 1 ? "" : "s"} × ${columns} column${columns === 1 ? "" : "s"}.`;
}

export function deliverableSummary(args: { blueprint: WorkerBlueprint; spec: JobSpec; contentValue: unknown; content: string; records: Row[] | null }): string {
  const { blueprint, spec, contentValue, content, records } = args;
  const format = blueprint.deliverable.format;
  if (format === "markdown" && typeof contentValue === "string") {
    const narrative = narrativeSummary(contentValue);
    if (narrative) return narrative;
  }
  if (records) return clipPlain(recordsSummary(records, blueprint, spec), SUMMARY_CHARS);
  if (format === "csv" && typeof contentValue === "string") {
    const shape = csvShape(contentValue);
    if (shape) return shape;
  }
  return oneLine(content, SUMMARY_CHARS);
}
