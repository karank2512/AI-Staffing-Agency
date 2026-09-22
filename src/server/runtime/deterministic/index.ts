import type { DeterministicComponent } from "@/server/domain/blueprint";
import { compileReport, type ReportMeta } from "./compile-report";
import { computeStats } from "./compute-stats";
import { dedupe } from "./dedupe";
import { filter } from "./filter";
import { rank } from "./rank";
import { toCsv } from "./to-csv";
import { validateRecords } from "./validate-records";
import type { OpResult } from "./result";

/**
 * Deterministic components: plain, pure functions over the run context. The blueprint schema has already
 * validated each config, so the only inputs that can be messy are the records themselves — and every operation
 * is written to tolerate those.
 */
export function runDeterministic(component: DeterministicComponent, context: Record<string, unknown>, meta: ReportMeta): OpResult {
  const primary = context[component.inputKeys[0]];
  switch (component.operation) {
    case "dedupe":
      return dedupe(primary, component.config);
    case "validate_records":
      return validateRecords(primary, component.config);
    case "rank":
      return rank(primary, component.config);
    case "filter":
      return filter(primary, component.config);
    case "compute_stats":
      return computeStats(primary, component.config);
    case "to_csv":
      return toCsv(primary, component.config);
    case "compile_report":
      return compileReport(context, component.config, meta);
  }
}

export { compileReport, renderTable } from "./compile-report";
export type { CompileReportConfig, ReportMeta } from "./compile-report";
export { computeStats } from "./compute-stats";
export type { GroupStat, NumericStat, Stats } from "./compute-stats";
export { dedupe } from "./dedupe";
export { filter, matches } from "./filter";
export type { FilterConfig, FilterOp } from "./filter";
export { rank } from "./rank";
export { toCsv } from "./to-csv";
export { validateRecords } from "./validate-records";
export { asRecords, formatCell, formatNumber, humanizeHeader, isMissing, normalizeKey, toNumber } from "./records";
export type { DataRecord } from "./records";
export type { OpResult } from "./result";
