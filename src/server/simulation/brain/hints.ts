import type { WorkerBlueprint } from "@/server/domain/blueprint";
import type { MockAgentTurnInput } from "@/server/simulation/types";

/**
 * Optional extras a caller may pass ALONGSIDE `MockAgentTurnInput`. The frozen contract only carries the spec and
 * the component, but a few answers depend on the blueprint around it — most importantly what makes two records
 * "the same" (dedupe keyFields). Callers spread `agentTurnHints(blueprint)` into the input; callers that do not
 * (tests, older seeds) get the heuristic behaviour, so everything here is read defensively.
 */
export interface AgentTurnHints {
  /** The blueprint's record identity: the first dedupe step's keyFields, else the no_duplicates check's. */
  keyFields?: string[];
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return list.length > 0 ? list : undefined;
}

export function agentTurnHints(blueprint: Pick<WorkerBlueprint, "components" | "evaluation">): AgentTurnHints {
  for (const c of blueprint.components) {
    if (c.type === "deterministic" && c.operation === "dedupe") {
      const keyFields = strings(c.config.keyFields);
      if (keyFields) return { keyFields };
    }
  }
  const check = blueprint.evaluation.deterministicChecks.find((c) => c.type === "no_duplicates");
  const keyFields = strings(check?.config.keyFields);
  return keyFields ? { keyFields } : {};
}

export function readHints(input: MockAgentTurnInput): AgentTurnHints {
  const raw = (input as MockAgentTurnInput & { keyFields?: unknown }).keyFields;
  const keyFields = strings(raw);
  return keyFields ? { keyFields } : {};
}
