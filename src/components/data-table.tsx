import { ExternalLink } from "lucide-react";
import { formatCell, inferColumns, isNumericColumn } from "@/lib/cell-format";
import { formatNumber, sentenceCase } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DataTableProps {
  /** Flat records, e.g. a deliverable's `data` array. Values may be anything JSON can hold. */
  rows: Array<Record<string, unknown>>;
  /** Column keys in display order. Default: every key seen across `rows`, in first-seen order. */
  columns?: string[];
  /** Rows rendered before truncating (the footer always reports the true total). Default 50. */
  maxRows?: number;
  className?: string;
}

/**
 * Read-only table for worker-produced records. Headers are humanized from snake_case (`source_url` →
 * "Source URL"); numbers are grouped and right-aligned, URLs become short external links, empty values show a
 * muted em-dash. The header sticks while the body scrolls (max height ~32rem) and wide tables scroll sideways.
 */
export function DataTable({ rows, columns, maxRows = 50, className }: DataTableProps) {
  const safeRows = Array.isArray(rows) ? rows.filter((r) => r !== null && typeof r === "object") : [];
  const keys = columns && columns.length > 0 ? columns : inferColumns(safeRows);

  if (safeRows.length === 0 || keys.length === 0) {
    return (
      <div
        data-slot="data-table"
        className={cn(
          "rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        No records to show.
      </div>
    );
  }

  const limit = Math.max(1, Math.floor(maxRows));
  const visible = safeRows.slice(0, limit);
  const numeric = new Set(keys.filter((key) => isNumericColumn(safeRows, key)));

  return (
    <div data-slot="data-table" className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-left text-[13px] leading-5">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 z-10 w-10 border-b border-border bg-muted px-3 py-2 text-right text-xs font-medium text-muted-foreground/70"
              >
                #
              </th>
              {keys.map((key) => (
                <th
                  key={key}
                  scope="col"
                  title={key}
                  className={cn(
                    "sticky top-0 z-10 border-b border-border bg-muted px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground",
                    numeric.has(key) && "text-right",
                  )}
                >
                  {sentenceCase(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={rowIndex} className="group transition-colors hover:bg-muted/40">
                <td className="border-b border-border/60 px-3 py-2 text-right align-top text-xs text-muted-foreground/70 tabular-nums group-last:border-b-0">
                  {rowIndex + 1}
                </td>
                {keys.map((key) => (
                  <td
                    key={key}
                    className={cn(
                      "border-b border-border/60 px-3 py-2 align-top group-last:border-b-0",
                      numeric.has(key) && "text-right",
                    )}
                  >
                    <Cell value={row[key]} column={key} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
        <span>
          Showing {formatNumber(visible.length, 0)} of {formatNumber(safeRows.length, 0)}{" "}
          {safeRows.length === 1 ? "record" : "records"}
        </span>
        <span>
          {keys.length} {keys.length === 1 ? "field" : "fields"}
        </span>
      </div>
    </div>
  );
}

function Cell({ value, column }: { value: unknown; column: string }) {
  const cell = formatCell(value, column);
  switch (cell.kind) {
    case "empty":
      return <span className="text-muted-foreground/60">—</span>;
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
          className="inline-flex max-w-72 items-center gap-1 font-medium text-primary underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary"
        >
          <span className="truncate">{cell.text}</span>
          <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden="true" />
        </a>
      );
    case "text":
      return (
        <span className="line-clamp-3 max-w-md min-w-24 break-words" title={cell.text.length > 120 ? cell.text : undefined}>
          {cell.text}
        </span>
      );
  }
}
