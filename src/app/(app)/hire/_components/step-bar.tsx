import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one action row of a step: guidance on the left, at most two pills on the right.
 *
 * Under 640px the wrapper collapses to `display: contents` so its two halves become children of the page
 * column itself. That buys two things the design asks for: the guidance stays in normal flow (a frosted bar
 * holding three lines of prose would eat a quarter of a phone screen), and the actions — now a direct child of
 * a *tall* block — can actually stick to the bottom of the viewport. A sticky box only travels as far as its
 * containing block, so wrapping it in a short div would pin it to the end of the page instead.
 */
export function StepBar({ note, children, className }: { note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("max-sm:contents sm:mt-10 sm:flex sm:items-center sm:justify-between sm:gap-6", className)}>
      {note ? (
        <div className="text-footnote text-pretty text-muted-foreground max-sm:mt-8 max-sm:text-center sm:max-w-[46ch]">{note}</div>
      ) : (
        <span aria-hidden="true" className="max-sm:hidden" />
      )}
      <div
        className={cn(
          "flex gap-3 sm:flex-row sm:items-center",
          "max-sm:sticky max-sm:bottom-0 max-sm:z-30 max-sm:-mx-4 max-sm:mt-6 max-sm:flex-col-reverse",
          "max-sm:material-thick max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:shadow-bar",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** The one inline error look in the flow: a soft danger panel, no left stripe, no icon. */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("rounded-lg bg-danger-soft px-4 py-3 text-callout text-pretty text-danger", className)}>
      {children}
    </p>
  );
}

/**
 * A tertiary action inside a step: blue text, never a pill, so each step keeps exactly one primary. The 44px
 * floor under 640px is invisible (the box is inline-flex around the same text) but makes it thumb-sized.
 */
export const stepLinkClass =
  "inline-flex items-center rounded-sm font-medium text-link outline-none hover:underline hover:underline-offset-4 disabled:opacity-40 max-sm:min-h-11";
