import { unparse } from "papaparse";
import { defineTool, plural } from "../define";

/** Cells hold scalars; nested values are serialized so no information is silently dropped. */
function toCell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Column order = explicit `columns`, else every key in order of first appearance across the records. */
function resolveColumns(records: Array<Record<string, unknown>>, columns: string[] | undefined): string[] {
  if (columns && columns.length > 0) return Array.from(new Set(columns));
  const seen = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) seen.add(key);
  return Array.from(seen);
}

export function recordsToCsv(records: Array<Record<string, unknown>>, columns?: string[]): { csv: string; columns: string[] } {
  const fields = resolveColumns(records, columns);
  if (fields.length === 0) return { csv: "", columns: fields };
  const data = records.map((record) => fields.map((field) => toCell(record[field])));
  // escapeFormulae: a cell like "=HYPERLINK(...)" must not execute when the CSV is opened in a spreadsheet.
  // papaparse leaves a dangling newline after a header-only document; keep the output free of trailing newlines.
  const csv = unparse({ fields, data }, { newline: "\n", escapeFormulae: true }).replace(/\n$/, "");
  return { csv, columns: fields };
}

export const csvExportTool = defineTool("csv_export", {
  displayName: "CSV export",
  description:
    "Turn an array of flat records into CSV text. Pass `columns` to control the column order; otherwise every key seen across the records becomes a column. Nested values are JSON-encoded.",
  humanDescription: "Turns structured records into a spreadsheet-ready CSV file.",
  category: "output",
  sideEffect: "none",
  defaultRequiresApproval: false,
  costPerCallUsd: 0,
  humanize: (input) => `Exported ${plural(input.records.length, "record")} to CSV`,
  describeForApproval: (input) => ({ title: `Export ${plural(input.records.length, "record")} to CSV` }),
  async execute(input) {
    const { csv } = recordsToCsv(input.records, input.columns);
    return { output: { csv, rowCount: input.records.length }, simulated: false };
  },
});
