import type { z } from "zod";
import { calculatorTool } from "./impl/calculator";
import { createReportTool } from "./impl/create-report";
import { csvExportTool } from "./impl/csv-export";
import { extractDataTool } from "./impl/extract-data";
import { fetchUrlTool } from "./impl/fetch-url";
import { readDatasetTool } from "./impl/read-dataset";
import { sendNotificationTool } from "./impl/send-notification";
import { webSearchTool } from "./impl/web-search";
import { TOOL_INPUT_SCHEMAS, TOOL_NAMES, type ToolName } from "./schemas";
import type { ToolDefinition } from "./types";

/**
 * The MVP tool catalog. Keyed by the frozen ToolName union so adding a tool to schemas.ts without an
 * implementation (or vice versa) is a compile error.
 */
const DEFINITIONS: Record<ToolName, ToolDefinition> = {
  web_search: webSearchTool,
  fetch_url: fetchUrlTool,
  extract_data: extractDataTool,
  read_dataset: readDatasetTool,
  csv_export: csvExportTool,
  create_report: createReportTool,
  calculator: calculatorTool,
  send_notification: sendNotificationTool,
};

/** Own-property check so model-supplied names like "constructor" never hit Object.prototype. */
export function isToolName(name: string): name is ToolName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(TOOL_INPUT_SCHEMAS, name);
}

export function listTools(): ToolDefinition[] {
  return TOOL_NAMES.map((name) => DEFINITIONS[name]);
}

export function getTool(name: string): ToolDefinition | undefined {
  return isToolName(name) ? DEFINITIONS[name] : undefined;
}

export function hasTool(name: string): boolean {
  return isToolName(name);
}

/** Model-facing specs in the order given; unknown names are skipped, duplicates collapsed. */
export function specsFor(names: string[]): Array<{ name: string; description: string; inputSchema: z.ZodType }> {
  const seen = new Set<string>();
  const specs: Array<{ name: string; description: string; inputSchema: z.ZodType }> = [];
  for (const name of names) {
    const tool = getTool(name);
    if (!tool || seen.has(tool.name)) continue;
    seen.add(tool.name);
    specs.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
  }
  return specs;
}
