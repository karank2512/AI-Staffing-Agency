import Link from "next/link";
import { cn } from "@/lib/utils";

export interface ViewTab {
  label: string;
  href: string;
  active: boolean;
  /** Shown after the label in tabular numerals, e.g. the count of waiting requests. */
  count?: number;
}

/**
 * Segmented control built from links, so the chosen view lives in the URL and survives a refresh or a share.
 * Same shape as the `TabsList` segmented control, without needing client state.
 */
export function ViewTabs({ label, tabs }: { label: string; tabs: ViewTab[] }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-8 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-secondary p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          scroll={false}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "text-footnote inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3.5 font-medium whitespace-nowrap transition-[background-color,color] duration-200 ease-standard outline-none",
            tab.active ? "bg-background text-foreground shadow-thumb" : "text-foreground/75 hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className={cn("tabular-nums", tab.active ? "text-muted-foreground" : "text-foreground/60")}>
              {tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
