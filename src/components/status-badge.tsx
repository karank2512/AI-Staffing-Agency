import { cn } from "@/lib/utils";
import { getStatusMeta, TONE_CLASSES, type StatusKind } from "@/lib/status";

export interface StatusBadgeProps {
  /** Which lifecycle the status belongs to (the same string means different things for a run and a job). */
  kind: StatusKind;
  /** The raw Prisma enum value, e.g. `"WAITING_FOR_APPROVAL"`. Unknown values render as a humanized idle badge. */
  status: string;
  className?: string;
}

/**
 * The one way to show a lifecycle status. Labels and colours come from `src/lib/status.ts`
 * (emerald success · amber attention · rose failure · sky running · slate idle); RUNNING pulses.
 */
export function StatusBadge({ kind, status, className }: StatusBadgeProps) {
  const meta = getStatusMeta(kind, status);
  const tone = TONE_CLASSES[meta.tone];
  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        "inline-flex h-5.5 w-fit shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        tone.badge,
        className,
      )}
    >
      <span className="relative flex size-1.5" aria-hidden="true">
        {meta.pulse ? (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", tone.dot)} />
        ) : null}
        <span className={cn("relative inline-flex size-1.5 rounded-full", tone.dot)} />
      </span>
      {meta.label}
    </span>
  );
}
