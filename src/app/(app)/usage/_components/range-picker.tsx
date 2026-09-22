import Link from "next/link";
import { cn } from "@/lib/utils";
import { USAGE_RANGES, type UsageRangeDays } from "@/server/queries/usage";

/**
 * A segmented control made of links: the URL is the state, so "look at the last 90 days" is shareable and the
 * page stays a server component. Same look as `TabsList` — gray track, one white thumb.
 */
export function RangePicker({ active }: { active: UsageRangeDays }) {
  return (
    <nav
      aria-label="Usage range"
      className="inline-flex h-8 w-full items-center rounded-full bg-secondary p-0.5 sm:w-auto"
    >
      {USAGE_RANGES.map((days) => {
        const selected = days === active;
        return (
          <Link
            key={days}
            href={`/usage?range=${days}`}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex h-full flex-1 items-center justify-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-200 ease-in-out outline-none sm:flex-none",
              selected ? "bg-background text-foreground shadow-thumb" : "text-foreground/80 hover:text-foreground",
            )}
          >
            {days} days
          </Link>
        );
      })}
    </nav>
  );
}
