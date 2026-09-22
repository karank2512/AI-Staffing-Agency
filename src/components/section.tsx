import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionProps {
  /** Section heading (rendered as `<h2>`). */
  title: string;
  description?: ReactNode;
  /**
   * Trailing action for this section. A blue text link with a chevron, not an outline button:
   * `<Button variant="link" asChild><Link href="…">View all <ChevronRight data-icon="inline-end" /></Link></Button>`.
   */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A titled block of a page: heading row + content. Stack sections inside `<div className="space-y-14">` (the
 * 56px app section rhythm). The content is NOT wrapped in a Card — put a `<Card>`, a grid or a table inside.
 */
export function Section({ title, description, actions, children, className }: SectionProps) {
  return (
    <section data-slot="section" className={cn("space-y-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-title-2 text-balance text-foreground">{title}</h2>
          {description ? <p className="text-[15px] text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-4">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
