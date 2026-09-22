import { unparse } from "papaparse";
import { asRecords, resolveColumns } from "./records";
import type { OpResult } from "./result";

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

/** Records → CSV text. `escapeFormulae` keeps "=HYPERLINK(...)" cells inert when the file is opened in Excel. */
export function toCsv(input: unknown, config: { columns?: string[] }): OpResult<string> {
  const records = asRecords(input);
  const columns = resolveColumns(records, config.columns);
  const csv =
    columns.length === 0
      ? ""
      : unparse({ fields: columns, data: records.map((record) => columns.map((column) => toCell(record[column]))) }, { newline: "\n", escapeFormulae: true }).replace(/\n$/, "");
  return {
    value: csv,
    summary: { rows: records.length, columns, bytes: csv.length },
    detail: `${records.length} row${records.length === 1 ? "" : "s"} × ${columns.length} column${columns.length === 1 ? "" : "s"}`,
  };
}
