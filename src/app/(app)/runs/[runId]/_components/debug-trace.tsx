import { Bug, ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { JsonView } from "@/components/json-view";
import { formatDateTime } from "@/lib/format";
import type { RunDetail } from "@/server/queries/runs";

/** Collapsed by default: the durable checkpoint, the queue lease and the whole read model as raw JSON. */
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
    <details className="group rounded-xl bg-card ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
        <Bug className="size-4 text-muted-foreground" aria-hidden="true" />
        Debug trace
        <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
          <span className="font-mono">{live.run.id}</span>
          <CopyButton value={live.run.id} />
        </span>
      </summary>
      <div className="space-y-4 border-t px-4 py-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-dashed py-1 last:border-0 sm:last:border-b">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
        <JsonView label="Checkpoint" value={checkpoint} />
        <JsonView label="Run input" value={detail.input} />
        <JsonView label="Run output" value={detail.output} />
        <JsonView label="Everything (raw read model)" value={detail} />
      </div>
    </details>
  );
}
