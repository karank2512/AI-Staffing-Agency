import { cn } from "@/lib/utils";

/**
 * Logo glyph: a small "team" mark — one lead node with two reports — on the brand tile.
 * Pure SVG so it renders crisply at any size and needs no asset pipeline.
 */
export function LogoGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs ring-1 ring-primary/20 ring-inset",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-4">
        <path
          d="M12 9.2v3.1m0 0-4.6 3.2m4.6-3.2 4.6 3.2"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="12" cy="6.4" r="2.9" fill="currentColor" />
        <circle cx="6.4" cy="17.2" r="2.5" fill="currentColor" fillOpacity="0.8" />
        <circle cx="17.6" cy="17.2" r="2.5" fill="currentColor" fillOpacity="0.8" />
      </svg>
    </span>
  );
}

/** Glyph + wordmark, used at the top of the sidebar and in the mobile top bar. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoGlyph />
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-tight text-foreground">AI Staffing</span>
        <span className="mt-0.5 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Agency</span>
      </span>
    </span>
  );
}
