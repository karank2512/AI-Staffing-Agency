import { authorize } from "./authorize";
import { describe } from "./describe";
import { invoke } from "./invoke";
import { getTool, hasTool, listTools, specsFor } from "./registry";
import type { Tools } from "./types";

/**
 * Tool layer public surface (contract: tools/types.ts). Permissions live server-side in `invoke` — the runtime
 * never calls a tool's `execute` directly.
 */
export const tools: Tools = {
  list: listTools,
  get: getTool,
  has: hasTool,
  specsFor,
  describe,
  authorize,
  invoke,
};

export { TOOL_INPUT_SCHEMAS, TOOL_NAMES, SAMPLE_DATASETS } from "./schemas";
export type { SampleDataset, SearchResult, ToolInput, ToolName, ToolOutput, ToolOutputs } from "./schemas";
export type * from "./types";
