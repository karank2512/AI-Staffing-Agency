import { ChevronDown } from "lucide-react";
import { JsonView } from "@/components/json-view";
import { formatDateTime } from "@/lib/format";
import type { RunDetail } from "@/server/queries/runs";

/**
 * Troubleshooting, deliberately demoted: one collapsed row that opens onto the durable checkpoint, the queue
 * lease and the raw read model. Native `<details>` keeps it a server component; the styling matches the
 * accordion rows used elsewhere.
 */
export function DebugTrace({ detail }: { detail: RunDetail }) {
  const { live, queue, checkpoint } = detail;
  const rows: Array<[string, string]> = [
    ["Run id", live.run.id],
    ["Attempt", `${live.run.attempt} of ${live.run.maxAttempts}`],
    ["Available at", formatDateTime(queue.availableAt)],
    ["Locked by", queue.lockedBy ?? "—"],
    ["Locked at", queue.lockedAt ? formatDateTime(queue.lockedAt) : "—"],
    ["Last heartbeat", queue.heartbeatAt ? formatDateTime(queue.heartbeatAt) : "—"],
    ["Updated", formatDateTime(queue.updatedAt)],
  ];

  return (
    <details className="group/debug border-t border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-semibold tracking-[-0.012em] select-none [&::-webkit-details-marker]:hidden">
        Raw model calls and tool traces
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-[240ms] ease-standard group-open/debug:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="space-y-5 pb-6">
        <p className="text-[15px] text-muted-foreground">For troubleshooting — nothing here changes what the worker did.</p>
        <dl className="grid gap-x-10 gap-y-0 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-border py-2 text-footnote">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono text-caption text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-1">
          <JsonView label="Checkpoint" value={checkpoint} />
          <JsonView label="Run input" value={detail.input} />
          <JsonView label="Run output" value={detail.output} />
          <JsonView label="Everything (raw read model)" value={detail} />
        </div>
      </div>
    </details>
  );
}
