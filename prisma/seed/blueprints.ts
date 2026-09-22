import { parseBlueprint, type WorkerBlueprint } from "@/server/domain";
import { estimateCost } from "@/server/staffing";

/**
 * Blueprint adjustments for the demo. Alex and Maya run exactly what the Staffing Engine designed; Sam's first
 * version is deliberately the kind of "cheap" design that goes wrong — a fast-tier collector with a thin prompt
 * and no cleaning steps — so the Replace flow has something real to fix (and the simulated quality model has
 * something real to degrade).
 */

const SAM_V1_COLLECTOR_INSTRUCTIONS = "Find the competitors' pricing pages and list the prices you see. Keep it quick.";

export function degradeToSamV1(designed: WorkerBlueprint): WorkerBlueprint {
  const components = designed.components
    .filter((c) => !(c.type === "deterministic" && (c.operation === "validate_records" || c.operation === "dedupe")))
    .map((c) => (c.type === "agent" && c.id === "collector" ? { ...c, modelTier: "fast" as const, instructions: SAM_V1_COLLECTOR_INSTRUCTIONS } : c));
  const withoutCost: Omit<WorkerBlueprint, "costEstimate"> = {
    ...designed,
    components,
    limits: { ...designed.limits, maxToolCallsPerRun: 12, maxRunDurationSec: 300 },
  };
  return parseBlueprint({ ...withoutCost, costEstimate: estimateCost(withoutCost) });
}
