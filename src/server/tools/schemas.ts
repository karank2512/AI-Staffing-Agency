import { z } from "zod";

/**
 * FROZEN tool I/O shapes. The tools module implements against these; the simulation mock brain emits
 * tool calls against these (it sits BELOW tools in the dependency order, so both import from here —
 * this file must stay dependency-free apart from zod).
 */

export const SearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  source: z.string(),
  publishedAt: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const TOOL_INPUT_SCHEMAS = {
  web_search: z.object({
    query: z.string().min(2).describe("Search query"),
    maxResults: z.number().int().min(1).max(10).optional().describe("Default 6"),
  }),
  fetch_url: z.object({
    url: z.string().url().describe("http(s) URL to read"),
  }),
  extract_data: z.object({
    text: z.string().min(1).describe("Source text to extract structured records from"),
    fields: z.array(z.string().min(1)).min(1).describe("snake_case field names each record should have"),
    maxRecords: z.number().int().min(1).max(100).optional(),
  }),
  read_dataset: z.object({
    dataset: z.string().min(1).describe("Dataset name, e.g. 'customer_feedback'"),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  csv_export: z.object({
    records: z.array(z.record(z.string(), z.unknown())),
    columns: z.array(z.string()).optional(),
  }),
  create_report: z.object({
    title: z.string().min(1),
    sections: z.array(z.object({ heading: z.string().min(1), body: z.string() })).min(1),
  }),
  calculator: z.object({
    expression: z.string().min(1).max(500).describe("Arithmetic expression, e.g. '(1200 * 0.18) / 12'"),
  }),
  send_notification: z.object({
    channel: z.enum(["email", "slack"]),
    recipients: z.array(z.string().min(1)).min(1).max(20),
    subject: z.string().min(1).max(200),
    body: z.string().min(1),
  }),
} as const;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_INPUT_SCHEMAS) as ToolName[];

export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_INPUT_SCHEMAS)[N]>;

export interface ToolOutputs {
  web_search: { results: SearchResult[] };
  fetch_url: { url: string; title: string; text: string };
  extract_data: { records: Array<Record<string, unknown>> };
  read_dataset: { dataset: string; records: Array<Record<string, unknown>>; total: number };
  csv_export: { csv: string; rowCount: number };
  create_report: { markdown: string };
  calculator: { result: number };
  send_notification: { delivered: true; simulated: true; channel: "email" | "slack"; recipients: number };
}
export type ToolOutput<N extends ToolName> = ToolOutputs[N];

/** Built-in sample datasets served by `read_dataset` in Phase 1 (connectors arrive in Phase 2). */
export const SAMPLE_DATASETS = ["customer_feedback", "funding_rounds", "support_tickets"] as const;
export type SampleDataset = (typeof SAMPLE_DATASETS)[number];
