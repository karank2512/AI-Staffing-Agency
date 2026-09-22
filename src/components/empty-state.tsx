import type { ReactNode } from "react";
import { IconSlot, type IconProp } from "@/components/icon-slot";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Optional 32px line icon above the title — no tile, no circle, no colour. */
  icon?: IconProp;
  /** What is missing, in plain words: "No deliverables yet". */
  title: string;
  /** Why it is empty and what will fill it: "Alex's first run is still in progress." */
  description?: ReactNode;
  /** One pill CTA (`size="lg"`). Two is already a decision the reader didn't ask for. */
  action?: ReactNode;
  className?: string;
}

/**
 * Placeholder for lists, tabs and cards with nothing to show. No dashed box: inside a card the card is the
 * frame, and on the canvas the whitespace is.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center justify-center px-6 py-20 text-center", className)}
    >
      {icon ? (
        <span className="mb-5 text-tertiary">
          <IconSlot icon={icon} className="size-8" />
        </span>
      ) : null}
      <h3 className="text-title-2 text-balance text-foreground">{title}</h3>
      {description ? (
        <p className="text-body mt-2.5 max-w-[44ch] text-pretty text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{action}</div> : null}
    </div>
  );
}
