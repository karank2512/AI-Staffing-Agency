import { cn } from "@/lib/utils";

export interface LiveDotProps {
  /** Word shown next to the dot. Pass `null` for the dot on its own (give the parent an accessible name). */
  label?: string | null;
  className?: string;
}

/**
 * The single infinite animation in the product: a 7px blue dot with a slow ring pulse, shown only while work is
 * actually in flight (a running run, an active `AutoRefresh`). Never a spinner. Static under reduced motion.
 */
export function LiveDot({ label = "Live", className }: LiveDotProps) {
  return (
    <span
      data-slot="live-dot"
      className={cn("inline-flex items-center gap-1.5 text-footnote text-muted-foreground", className)}
    >
      <span className="live-dot" aria-hidden="true" />
      {label ? label : <span className="sr-only">Live</span>}
    </span>
  );
}
