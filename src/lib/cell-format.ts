import { formatDate, formatDateTime, formatNumber, sentenceCase } from "@/lib/format";
import { sanitizeHref } from "@/lib/markdown";

/**
 * Pure presentation rules for `DataTable`: workers produce arbitrary flat records, so cells are formatted by
 * inspecting the value (and, for a few ambiguous cases, the column name).
 */

export type CellDisplay =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "number"; text: string }
  | { kind: "boolean"; text: string; value: boolean }
  | { kind: "link"; href: string; text: string };

const URL_PATTERN = /^https?:\/\/\S+$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
/** Columns whose integers are identifiers, not quantities — grouping separators would be wrong ("2,024"). */
const UNGROUPED_COLUMN = /(^|_)(year|yr|id|zip|postcode|postal_code)(_|$)/i;
const MAX_TEXT = 600;

/** `https://www.example.com/blog/post?x=1` → `example.com/blog/post` (kept short so tables stay scannable). */
export function displayUrl(href: string, maxLength = 48): string {
  try {
    const url = new URL(href);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    const text = `${url.hostname.replace(/^www\./, "")}${path}`;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  } catch {
    return href;
  }
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function primitiveToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatCell(value: unknown, column = ""): CellDisplay {
  if (value === null || value === undefined) return { kind: "empty" };

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { kind: "empty" };
    if (Number.isInteger(value) && UNGROUPED_COLUMN.test(column)) return { kind: "number", text: String(value) };
    return { kind: "number", text: formatNumber(value, 2) };
  }

  if (typeof value === "bigint") return { kind: "number", text: value.toLocaleString("en-US") };
  if (typeof value === "boolean") return { kind: "boolean", text: value ? "Yes" : "No", value };
  if (value instanceof Date) return { kind: "text", text: formatDateTime(value) };

  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return { kind: "empty" };
    if (URL_PATTERN.test(text)) {
      const href = sanitizeHref(text);
      if (href) return { kind: "link", href, text: displayUrl(href) };
    }
    if (ISO_DATE.test(text)) {
      // Date-only strings parse as UTC midnight; pin to local noon so the calendar day never shifts.
      return { kind: "text", text: formatDate(`${text}T12:00:00`) };
    }
    if (ISO_DATE_TIME.test(text)) return { kind: "text", text: formatDateTime(text) };
    return { kind: "text", text: clip(text) };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "empty" };
    return { kind: "text", text: clip(value.map(primitiveToText).filter(Boolean).join(", ")) };
  }

  return { kind: "text", text: clip(JSON.stringify(value)) };
}

/** Column order = first-seen key order across all rows (records from an LLM are not always uniform). */
export function inferColumns(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

/** Right-align a column when every non-empty value in it is numeric. */
export function isNumericColumn(rows: ReadonlyArray<Record<string, unknown>>, column: string): boolean {
  let sawNumber = false;
  for (const row of rows) {
    const value = row?.[column];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "number" && typeof value !== "bigint") return false;
    sawNumber = true;
  }
  return sawNumber;
}

/** Header text for a record key: `source_url` → "Source URL", `hq` → "HQ", `icp_score` → "ICP score". */
export function columnLabel(key: string): string {
  return sentenceCase(key);
}

/**
 * One header cell of a `DataTable`, in display order. The row-number column is a header like any other so the
 * header row and every body row are built from the same list — dropping it can never leave the two misaligned.
 */
export type DataTableHeader =
  | { kind: "index"; label: "#" }
  | { kind: "field"; key: string; label: string; numeric: boolean };

export interface DataTableModel {
  headers: DataTableHeader[];
  /** The rows to render (already truncated to `maxRows`). */
  visibleRows: Array<Record<string, unknown>>;
  /** Every usable row, including the ones cut by `maxRows` — the footer reports this. */
  totalRows: number;
  /** Data fields only (the row-number column is not a field). */
  fieldCount: number;
}

export interface DataTableModelInput {
  rows: unknown;
  columns?: readonly string[] | null;
  maxRows?: number;
  /** Prepend a "#" row-number column. Turn off when the records carry their own ordering (a `rank` field). */
  showIndex?: boolean;
}

/** Everything `DataTable` renders except the cells themselves. Pure, so the table's shape is unit-testable. */
export function buildDataTableModel({ rows, columns, maxRows = 50, showIndex = true }: DataTableModelInput): DataTableModel {
  const safeRows = Array.isArray(rows)
    ? rows.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r))
    : [];
  const keys = columns && columns.length > 0 ? [...columns] : inferColumns(safeRows);
  const limit = Math.max(1, Math.floor(Number.isFinite(maxRows) ? maxRows : 50));
  const fields: DataTableHeader[] = keys.map((key) => ({ kind: "field", key, label: columnLabel(key), numeric: isNumericColumn(safeRows, key) }));
  return {
    headers: showIndex && fields.length > 0 ? [{ kind: "index", label: "#" }, ...fields] : fields,
    visibleRows: safeRows.slice(0, limit),
    totalRows: safeRows.length,
    fieldCount: keys.length,
  };
}
