import { z } from "zod";
import { llm } from "@/server/models";
import { simulation } from "@/server/simulation";
import { defineTool, plural } from "../define";

const DEFAULT_MAX_RECORDS = 50;
/** Fast-tier context is small; long pages are cut here (fetch_url already caps at 12k chars). */
const MAX_SOURCE_CHARS = 40_000;

export const ExtractionSchema = z.object({ records: z.array(z.record(z.string(), z.unknown())) });
type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM_PROMPT =
  "You are a precise data-extraction engine. Read the source text and return every distinct record it supports as JSON " +
  "objects with exactly the requested field names. Never invent values: use null for a field the text does not state. " +
  "Return {\"records\": []} when the text contains nothing relevant.";

export function buildExtractionPrompt(text: string, fields: string[], maxRecords: number): string {
  const source = text.length > MAX_SOURCE_CHARS ? `${text.slice(0, MAX_SOURCE_CHARS)}\n[truncated]` : text;
  return [
    `Extract up to ${maxRecords} records. Each record must have these fields: ${fields.join(", ")}.`,
    "Use snake_case field names exactly as given; numbers as numbers (no currency symbols), dates as ISO 8601.",
    "",
    "SOURCE TEXT:",
    "<<<",
    source,
    ">>>",
  ].join("\n");
}

/** Keep only object records, cut to the cap — providers do not enforce array lengths or element shapes. */
export function normalizeExtraction(raw: unknown, maxRecords: number): unknown {
  const obj = raw && typeof raw === "object" ? (raw as { records?: unknown }) : {};
  const list = Array.isArray(obj.records) ? obj.records : [];
  const records = list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r)).slice(0, maxRecords);
  return { records };
}

export const extractDataTool = defineTool("extract_data", {
  displayName: "Data extraction",
  description:
    "Extract structured records from text (a fetched page, search snippets, notes). Give the exact snake_case field names each record should have; unknown values come back as null. Returns { records: [...] }.",
  humanDescription: "Turns page text and notes into clean structured records with the fields the job needs.",
  category: "data",
  sideEffect: "none",
  defaultRequiresApproval: false,
  costPerCallUsd: 0,
  humanize: (input) => `Extracted ${input.fields.slice(0, 4).join(", ")}${input.fields.length > 4 ? ", …" : ""} from the source text`,
  describeForApproval: (input) => ({ title: `Extract ${plural(input.fields.length, "field")} from the source text` }),
  async execute(input, ctx) {
    const maxRecords = input.maxRecords ?? DEFAULT_MAX_RECORDS;
    const mock = (): Extraction => ({ records: simulation.extractRecords(input.text, input.fields, { maxRecords }) });
    if (ctx.simulated) return { output: mock(), simulated: true };

    // The model call meters itself (ModelCall + MODEL UsageRecord on this run), so no costUsd is reported here —
    // reporting it again would double-count the spend on the run.
    const result = await llm.generateObject(
      {
        tier: "fast",
        system: SYSTEM_PROMPT,
        prompt: buildExtractionPrompt(input.text, input.fields, maxRecords),
        schema: ExtractionSchema,
        schemaName: "extracted_records",
        normalize: (raw) => normalizeExtraction(raw, maxRecords),
        mock,
      },
      { organizationId: ctx.organizationId, workerId: ctx.workerId, runId: ctx.runId, purpose: "tool.extract_data" },
    );
    return { output: { records: result.object.records.slice(0, maxRecords) }, simulated: result.simulated };
  },
});
