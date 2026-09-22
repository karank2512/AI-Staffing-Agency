import { ExternalLink } from "lucide-react";
import { buildDataTableModel, formatCell } from "@/lib/cell-format";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DataTableProps {
  /** Flat records, e.g. a deliverable's `data` array. Values may be anything JSON can hold. */
  rows: Array<Record<string, unknown>>;
  /** Column keys in display order. Default: every key seen across `rows`, in first-seen order. */
  columns?: string[];
  /** Rows rendered before truncating (the footer always reports the true total). Default 50. */
  maxRows?: number;
  /**
   * Show the leading "#" row-number column. Default true. Pass false when the records carry their own ordering
   * (e.g. a `rank` field) — two competing numbers side by side read as a bug.
   */
  showIndex?: boolean;
  className?: string;
}

/**
 * Read-only table for worker-produced records. Headers are humanized from snake_case with acronyms kept
 * upper-case (`source_url` → "Source URL", `hq` → "HQ"); numbers are grouped and right-aligned, URLs become
 * short external links, empty values show a muted em-dash. Hairline rows on white, no outer border — the
 * surface it sits on is the frame. The header sticks while the body scrolls.
 */
export function DataTable({ rows, columns, maxRows = 50, showIndex = true, className }: DataTableProps) {
  const model = buildDataTableModel({ rows, columns, maxRows, showIndex });

  if (model.totalRows === 0 || model.fieldCount === 0) {
    return (
      <div
        data-slot="data-table"
        className={cn("rounded-lg bg-muted px-4 py-10 text-center text-[15px] text-muted-foreground", className)}
      >
        No records to show.
      </div>
    );
  }

  const { headers, visibleRows, totalRows, fieldCount } = model;

  return (
    <div data-slot="data-table" className={cn("overflow-hidden rounded-xl bg-card", className)}>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-left text-callout">
          <thead>
            <tr>
              {headers.map((header) =>
                header.kind === "index" ? (
                  <th
                    key="index"
                    scope="col"
                    className="sticky top-0 z-10 h-11 w-12 border-b border-border bg-card px-4 text-right text-[13px] font-semibold text-muted-foreground"
                  >
                    {header.label}
                  </th>
                ) : (
                  <th
                    key={`field:${header.key}`}
                    scope="col"
                    title={header.key}
                    className={cn(
                      "sticky top-0 z-10 h-11 border-b border-border bg-card px-4 text-[13px] font-semibold whitespace-nowrap text-muted-foreground",
                      header.numeric && "text-right",
                    )}
                  >
                    {header.label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="group relative transition-colors duration-200 ease-standard after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border hover:bg-[#f9f9fb] last:after:hidden"
              >
                {headers.map((header) =>
                  header.kind === "index" ? (
                    <td
                      key="index"
                      className="px-4 py-3 text-right align-top text-[13px] text-tertiary tabular-nums"
                    >
                      {rowIndex + 1}
                    </td>
                  ) : (
                    <td
                      key={`field:${header.key}`}
                      className={cn("px-4 py-3 align-top", header.numeric && "text-right")}
                    >
                      <Cell value={row[header.key]} column={header.key} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-footnote text-muted-foreground tabular-nums">
        <span>
          Showing {formatNumber(visibleRows.length, 0)} of {formatNumber(totalRows, 0)}{" "}
          {totalRows === 1 ? "record" : "records"}
        </span>
        <span>
          {fieldCount} {fieldCount === 1 ? "field" : "fields"}
        </span>
      </div>
    </div>
  );
}

function Cell({ value, column }: { value: unknown; column: string }) {
  const cell = formatCell(value, column);
  switch (cell.kind) {
    case "empty":
      return <span className="text-tertiary">—</span>;
    case "number":
      return <span className="whitespace-nowrap tabular-nums">{cell.text}</span>;
    case "boolean":
      return <span className={cell.value ? "text-foreground" : "text-muted-foreground"}>{cell.text}</span>;
    case "link":
      return (
        <a
          href={cell.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={cell.href}
          className="inline-flex max-w-72 items-center gap-1 text-link underline-offset-[3px] hover:underline"
        >
          <span className="truncate">{cell.text}</span>
          <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden="true" />
        </a>
      );
    case "text":
      return (
        <span
          className="line-clamp-3 max-w-md min-w-24 break-words"
          title={cell.text.length > 120 ? cell.text : undefined}
        >
          {cell.text}
        </span>
      );
  }
}
