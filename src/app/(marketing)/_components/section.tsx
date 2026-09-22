import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The id of the one dark band on the page. Lives here rather than in `marketing-nav.tsx` because every export
 * of a `"use client"` module becomes a client reference — a server component cannot read its value.
 */
export const INK_BAND_ID = "workforce-band";

/**
 * Attributes that opt an element into the shared scroll reveal (see `reveal.tsx`). `index` staggers siblings
 * by 60ms each. Kept in this server-safe module so server components can spread it without importing the
 * client island.
 */
export function reveal(index = 0): { "data-reveal": string; style: CSSProperties } {
  return { "data-reveal": "", style: { "--i": index } as CSSProperties };
}

export type SectionTone = "white" | "gray" | "ink";

const TONE_CLASSES: Record<SectionTone, string> = {
  white: "bg-background text-foreground",
  gray: "bg-canvas text-foreground",
  ink: "bg-ink text-ink-foreground",
};

export interface MarketingSectionProps {
  id?: string;
  tone?: SectionTone;
  /** Drop the section's own bottom padding — used where a mock bleeds into the band below. */
  flushBottom?: boolean;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}

/**
 * A full-bleed band: alternating white / #f5f5f7 (plus the single ink band), 88–160px of vertical air, and a
 * 1024px content column with 16px gutters on phones.
 */
export function MarketingSection({
  id,
  tone = "white",
  flushBottom = false,
  className,
  innerClassName,
  children,
}: MarketingSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "px-4 pt-(--space-section-marketing) pb-(--space-section-marketing) sm:px-6",
        flushBottom && "pb-0",
        TONE_CLASSES[tone],
        className,
      )}
    >
      <div className={cn("mx-auto w-full max-w-(--container-marketing)", innerClassName)}>{children}</div>
    </section>
  );
}

export interface SectionIntroProps {
  /** Sentence-case marketing eyebrow — at most one per section. */
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  /** `display` for a band headline, `headline` for a sub-section. */
  size?: "display" | "headline";
  className?: string;
}

/** Headline + optional lead, revealed as a pair. The text column never exceeds 692px. */
export function SectionIntro({
  eyebrow,
  title,
  description,
  align = "center",
  size = "display",
  className,
}: SectionIntroProps) {
  return (
    <div className={cn(align === "center" && "mx-auto max-w-(--container-text) text-center", className)}>
      {eyebrow ? (
        <p {...reveal(0)} className="mb-3 text-[17px] leading-6 font-semibold text-warning">
          {eyebrow}
        </p>
      ) : null}
      <h2 {...reveal(eyebrow ? 1 : 0)} className={size === "display" ? "text-display" : "text-headline"}>
        {title}
      </h2>
      {description ? (
        <p
          {...reveal(eyebrow ? 2 : 1)}
          className={cn(
            "text-body-lg mt-5 text-muted-foreground",
            align === "center" ? "mx-auto max-w-[640px]" : "max-w-(--container-text)",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
