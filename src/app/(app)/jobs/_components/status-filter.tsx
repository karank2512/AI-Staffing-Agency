import Link from "next/link";
import type { JobStatus } from "@prisma/client";
import { statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

const ORDER: readonly JobStatus[] = ["DRAFT", "SPEC_APPROVED", "STAFFED", "PAUSED", "CLOSED"];

export interface StatusFilterProps {
  active: JobStatus | null;
  counts: Record<JobStatus | "all", number>;
}

/**
 * Segmented filter driven entirely by `?status=` so the list stays a server component (and the URL is shareable).
 * Statuses with zero jobs are still listed so the filter reads the same on every visit.
 */
export function StatusFilter({ active, counts }: StatusFilterProps) {
  const options: Array<{ key: JobStatus | "all"; label: string; href: string }> = [
    { key: "all", label: "All", href: "/jobs" },
    ...ORDER.map((status) => ({ key: status, label: statusLabel("job", status), href: `/jobs?status=${status.toLowerCase()}` })),
  ];
  const current: JobStatus | "all" = active ?? "all";

  return (
    <nav aria-label="Filter jobs by status" className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => {
        const selected = option.key === current;
        return (
          <Link
            key={option.key}
            href={option.href}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
              selected
                ? "border-foreground/15 bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
            <span className={cn("metric text-[11px]", selected ? "text-background/70" : "text-muted-foreground/70")}>
              {counts[option.key]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
