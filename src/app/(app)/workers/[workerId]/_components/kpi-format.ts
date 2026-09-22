import { EMPTY, formatDuration, formatNumber, formatPercent, formatUsd } from "@/lib/format";

/**
 * KPI values are stored in their natural unit (rates 0..1, seconds, USD, counts) — see `KPI_METRICS` in the
 * domain. Pure, so both server tabs and client leaves can format the same way.
 */
export function formatKpiValue(metric: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  switch (metric) {
    case "success_rate":
    case "acceptance_rate":
    case "quality_score":
      return formatPercent(value);
    case "cost_per_run_usd":
      return formatUsd(value);
    case "duration_sec":
      return formatDuration(value * 1000);
    case "records_per_run":
      return formatNumber(value, 1);
    default:
      return formatNumber(value);
  }
}

/** `null` = no data yet (never "missed"). */
export type KpiVerdict = "met" | "missed" | "pending";

export function kpiVerdict(kpi: { met: boolean | null; actual: number | null }): KpiVerdict {
  if (kpi.actual === null || kpi.met === null) return "pending";
  return kpi.met ? "met" : "missed";
}

/** Score on 0..100 → the same three bands the ScoreRing uses, phrased for a sentence. */
export function describeScore(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return "not rated yet";
  const rounded = Math.round(score);
  if (rounded >= 80) return "performing strongly";
  if (rounded >= 65) return "doing okay, with room to improve";
  return "underperforming";
}
