import Link from "next/link";
import { cn } from "@/lib/utils";
import { USAGE_RANGES, type UsageRangeDays } from "@/server/queries/usage";

/**
 * Segmented range picker driven entirely by `?range=` so the page stays a server component and the URL is
 * shareable ("look at the last 90 days"). Server-safe: no state, the URL is the state.
 */
export function RangePicker({ active }: { active: UsageRangeDays }) {
  return (
    <nav aria-label="Usage range" className="inline-flex items-center rounded-lg border bg-card p-0.5">
      {USAGE_RANGES.map((days) => {
        const selected = days === active;
        return (
          <Link
            key={days}
            href={`/usage?range=${days}`}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors",
              selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {days} days
          </Link>
        );
      })}
    </nav>
  );
}
