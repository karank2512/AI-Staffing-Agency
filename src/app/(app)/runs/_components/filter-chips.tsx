import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A row of link-chips for list filters driven by search params (server-safe: no client state, the URL is
 * the state). Used by the runs and deliverables indexes.
 */

export interface FilterChip {
  label: string;
  href: string;
  active: boolean;
  /** Optional count shown after the label. */
  count?: number;
}

export function FilterChips({ label, chips }: { label: string; chips: FilterChip[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow mr-1">{label}</span>
      {chips.map((chip) => (
        <Link
          key={chip.href}
          href={chip.href}
          scroll={false}
          aria-current={chip.active ? "page" : undefined}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
            chip.active ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {chip.label}
          {chip.count !== undefined ? <span className="tabular-nums opacity-70">{chip.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}

/** Build a query string from the given params, dropping empty values. */
export function withParams(base: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}
