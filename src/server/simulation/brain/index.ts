import type { MockTextResponse } from "@/server/models/types";
import type { MockAgentTurnInput } from "@/server/simulation/types";
import { analystTurn } from "./analyst";
import { collectorTurn } from "./collector";
import { genericTurn } from "./generic";
import { notifierTurn } from "./notifier";

/**
 * The mock brain — `simulation.agentTurn`. A small, stateless state machine over the conversation; the role is
 * decided from the component's shape rather than its id, so blueprints designed by a live model work too:
 *
 *   1. `send_notification` granted        → notifier rule (one call, then a one-line confirmation)
 *   2. json output                         → collector (dataset / search → fetch → extract → JSON array)
 *   3. markdown output with records/stats  → analyst (insights with concrete numbers)
 *   4. anything else                       → generic markdown (optional single search)
 *
 * Every branch respects `component.maxTurns`, only ever calls tools present in `input.tools`, and emits inputs
 * that validate against TOOL_INPUT_SCHEMAS (see conversation.toolTurn).
 */
export function agentTurn(input: MockAgentTurnInput, now: Date): MockTextResponse {
  const offered = new Set(input.tools.map((t) => t.name));
  if (offered.has("send_notification")) return notifierTurn(input);
  if (input.component.outputFormat === "json") return collectorTurn(input, now);
  return analystTurn(input, now) ?? genericTurn(input, now);
}
