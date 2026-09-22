import type { ReactNode } from "react";
import { IconSlot, type IconProp } from "@/components/icon-slot";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Lucide icon component or element, shown in a soft tile above the title. */
  icon?: IconProp;
  /** What is missing, in plain words: "No deliverables yet". */
  title: string;
  /** Why it is empty and what will fill it: "Alex's first run is still in progress." */
  description?: ReactNode;
  /** Usually one `<Button>` (or a `<Button asChild><Link/></Button>`). */
  action?: ReactNode;
  className?: string;
}

/** Placeholder for lists, tabs and cards with nothing to show. Dashed border keeps it visibly "not content". */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/5">
          <IconSlot icon={icon} className="size-5" />
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-balance text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
