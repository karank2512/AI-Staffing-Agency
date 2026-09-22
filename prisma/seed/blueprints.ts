import { parseBlueprint, type BlueprintDraft, type JobSpec, type WorkerBlueprint } from "@/server/domain";
import { designBlueprint, draftFromTemplate, estimateCost } from "@/server/staffing";

/**
 * Demo blueprints, designed by the real Staffing Engine (draftFromTemplate → designBlueprint) so they match what
 * a live Simulated-mode hire produces. Alex and Maya run exactly what the engine designed; Sam's first version is
 * deliberately the kind of "cheap" design that goes wrong — a fast-tier collector with a thin prompt and no
 * cleaning steps — so the Replace flow has something real to fix (and the simulated quality model has something
 * real to degrade).
 */

export interface DesignedWorker {
  blueprint: WorkerBlueprint;
  /** The proposal's rationale — becomes WorkerVersion.changeSummary on hire, exactly like hireWorker. */
  rationale: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The template picks a persona name from a pool; the demo cast is fixed, so rename it everywhere it appears. */
function renameDraft(draft: BlueprintDraft, name: string): BlueprintDraft {
  const from = draft.persona.name;
  if (from === name) return draft;
  const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, "g");
  const renamed = JSON.parse(JSON.stringify(draft).replace(pattern, name)) as BlueprintDraft;
  return { ...renamed, persona: { ...renamed.persona, name } };
}

export function designWorker(spec: JobSpec, name: string): DesignedWorker {
  const draft = renameDraft(draftFromTemplate(spec), name);
  return { blueprint: designBlueprint(spec, draft), rationale: draft.rationale };
}

const SAM_V1_COLLECTOR_INSTRUCTIONS = "List AI infrastructure companies with their category, stage, amount raised and a link. Keep it quick.";

const SAM_V1_RATIONALE = [
  "Sam's researcher runs on the fast model tier to keep the daily map cheap — roughly a third of the cost of the standard tier.",
  "A short, direct prompt keeps each run quick; the analyst on the reasoning tier does the thinking.",
  "Results are ranked by amount raised in code, so the biggest companies come first.",
];

/**
 * Sam v1: the engine's design minus validation and de-duplication, with the collector downgraded to the fast
 * tier and a one-line prompt. Every run of this blueprint (live or simulated) under-delivers, repeats companies
 * and leaves required fields empty — which is exactly what the evaluation history and the Replace proposal show.
 */
export function designSamV1(spec: JobSpec): DesignedWorker {
  const designed = designWorker(spec, "Sam").blueprint;
  const components = designed.components
    .filter((c) => !(c.type === "deterministic" && (c.operation === "validate_records" || c.operation === "dedupe")))
    .map((c) => (c.type === "agent" && c.id === "collector" ? { ...c, modelTier: "fast" as const, instructions: SAM_V1_COLLECTOR_INSTRUCTIONS } : c));
  const withoutCost: Omit<WorkerBlueprint, "costEstimate"> = {
    ...designed,
    persona: {
      ...designed.persona,
      summary: "Sam keeps a daily map of the AI infrastructure landscape for the strategy team: who is building what, how much they raised, and which segments are heating up.",
    },
    components,
    limits: { ...designed.limits, maxToolCallsPerRun: 12, maxRunDurationSec: 300 },
  };
  return { blueprint: parseBlueprint({ ...withoutCost, costEstimate: estimateCost(withoutCost) }), rationale: SAM_V1_RATIONALE };
}
