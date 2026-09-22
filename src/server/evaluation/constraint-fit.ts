import type { JobSpec } from "@/server/domain/job-spec";
import { constraintMisses, constraintsForSpec, hasConstraints, sectorOfText, type ConstraintMiss } from "@/server/simulation";
import type { EvalRecord } from "./records";

/**
 * Does each record respect the brief's hard constraints — "15 Series A fintech companies in Europe"? A list of
 * well-formed, fully sourced Series C GPU clouds in Denver is still the wrong list, and must not score "Strong".
 * PURE. Only what a record states can be checked: a record with no location cannot be "outside Europe".
 */

export interface ConstraintFit {
  /** Records that state at least one constrained dimension. */
  checked: number;
  /** Of those, records that break none of the constraints. */
  fitting: number;
  /** "Series A", "Europe", "fintech". */
  labels: string[];
  /** A couple of offenders, human-readable: "Ridgeline GPU (Series C · Denver, CO · GPU Cloud)". */
  examples: string[];
}

const STAGE_KEY = /(^|_)(stage|round|series|round_type|funding_round|last_round)($|_)/;
const LOCATION_KEY = /(^|_)(hq|headquarters|location|city|country|region|based_in|geo|geography)($|_)/;
/** What the company IS (category, industry …) decides its sector; descriptive prose only when those say nothing. */
const SECTOR_KEY = /(^|_)(category|industry|sector|vertical|segment|space|market|subcategory)($|_)/;
const PROSE_KEY = /(^|_)(description|what_they_do|about|positioning|product|fit_reason|summary)($|_)/;
const NAME_KEY = /^(company|company_name|name|startup|account|organization|vendor|title)$/;

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, "_");

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function measureConstraintFit(spec: Pick<JobSpec, "title" | "objective" | "constraints" | "inputs">, records: readonly EvalRecord[] | null): ConstraintFit | null {
  if (!records || records.length === 0) return null;
  const constraints = constraintsForSpec(spec);
  if (!hasConstraints(constraints)) return null;

  let checked = 0;
  let fitting = 0;
  const examples: string[] = [];
  for (const record of records) {
    const keys = Object.keys(record);
    const stage = keys.filter((k) => STAGE_KEY.test(norm(k)) && !/amount|usd|size/.test(norm(k))).map((k) => text(record[k])).find(Boolean) ?? null;
    const location = keys.filter((k) => LOCATION_KEY.test(norm(k))).map((k) => text(record[k])).filter(Boolean).join(", ") || null;
    const sectorText = keys.filter((k) => SECTOR_KEY.test(norm(k))).map((k) => text(record[k])).filter(Boolean).join(" · ");
    const proseText = keys.filter((k) => PROSE_KEY.test(norm(k))).map((k) => text(record[k])).filter(Boolean).join(" · ");
    const sector = (sectorText ? sectorOfText(sectorText) : null) ?? (proseText ? sectorOfText(proseText) : null);

    const measurable =
      (constraints.stages.length > 0 && stage !== null) ||
      (constraints.regions.length > 0 && location !== null) ||
      (constraints.sector !== null && sector !== null);
    if (!measurable) continue;
    checked++;
    const misses: ConstraintMiss[] = constraintMisses({ stage, location, sector }, constraints);
    if (misses.length === 0) {
      fitting++;
      continue;
    }
    if (examples.length < 2) {
      const name = keys.filter((k) => NAME_KEY.test(norm(k))).map((k) => text(record[k])).find(Boolean) ?? "A record";
      const facts = [stage, location, sectorText.split(" · ")[0] || null].filter((x): x is string => !!x);
      examples.push(`${name}${facts.length > 0 ? ` (${facts.join(" · ")})` : ""}`);
    }
  }
  return checked === 0 ? null : { checked, fitting, labels: constraints.labels, examples };
}
