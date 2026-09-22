import { cn } from "@/lib/utils";
import { getStatusMeta, TONE_CLASSES, type StatusKind } from "@/lib/status";

export interface StatusBadgeProps {
  /** Which lifecycle the status belongs to (the same string means different things for a run and a job). */
  kind: StatusKind;
  /** The raw Prisma enum value, e.g. `"WAITING_FOR_APPROVAL"`. Unknown values render as a humanized idle status. */
  status: string;
  /**
   * `auto` (default) draws a dot plus a word, and promotes the states that are waiting on a person — or that
   * failed — to a soft pill. Force one look with `"dot"` or `"pill"`.
   */
  emphasis?: "auto" | "dot" | "pill";
  className?: string;
}

/**
 * The one way to show a lifecycle status: a 7px tone dot and a word, with no box. Show exactly one per object —
 * health and score merge into the score, and "Simulated" is not a status.
 */
export function StatusBadge({ kind, status, emphasis = "auto", className }: StatusBadgeProps) {
  const meta = getStatusMeta(kind, status);
  const tone = TONE_CLASSES[meta.tone];
  const pill = emphasis === "pill" || (emphasis === "auto" && (meta.tone === "attention" || meta.tone === "failure"));

  return (
    <span
      data-slot="status-badge"
      data-status={status}
      data-emphasis={pill ? "pill" : "dot"}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap",
        pill ? cn("h-6 rounded-full px-2.5", tone.soft) : "text-foreground",
        className,
      )}
    >
      <span className="relative flex size-[7px] shrink-0" aria-hidden="true">
        {meta.pulse ? (
          <span
            className={cn("absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping", tone.dot)}
          />
        ) : null}
        <span className={cn("relative inline-flex size-[7px] rounded-full", tone.dot)} />
      </span>
      {meta.label}
    </span>
  );
}
