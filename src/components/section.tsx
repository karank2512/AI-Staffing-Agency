import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionProps {
  /** Section heading (rendered as `<h2>`). */
  title: string;
  description?: ReactNode;
  /** Right-aligned controls for this section ("View all", filters). Keep them `size="sm"`. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A titled block of a page: heading row + content. Stack sections inside `<div className="space-y-8">`.
 * The content is NOT wrapped in a Card — put a `<Card>`, a grid of cards or a table inside as needed.
 */
export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section data-slot="section" className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-[15px] leading-6 font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
