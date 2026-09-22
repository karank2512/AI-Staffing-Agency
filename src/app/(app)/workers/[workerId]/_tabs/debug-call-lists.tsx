import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { JsonView } from "@/components/json-view";
import { SimulatedBadge } from "@/components/simulated-badge";
import { formatDateTime, formatDuration, formatTokens, formatUsdPrecise } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { DebugModelCall, DebugToolCall } from "@/server/queries/worker-manage";

/**
 * Engineer-facing call lists for the Debug tab. Native `<details>` rows (no client state) with the raw
 * request/response or input/output as collapsible JSON underneath.
 */

const TOOL_STATUS_TONE: Record<DebugToolCall["status"], keyof typeof TONE_CLASSES> = {
  RUNNING: "running",
  SUCCEEDED: "success",
  FAILED: "failure",
  DENIED: "failure",
  PENDING_APPROVAL: "attention",
  APPROVED: "success",
};

function Cell({ children, className, mono = false }: { children: React.ReactNode; className?: string; mono?: boolean }) {
  return <span className={cn("truncate text-xs text-muted-foreground", mono && "font-mono text-[11px]", className)}>{children}</span>;
}

function RunLink({ runId }: { runId: string | null }) {
  if (!runId) return <Cell mono>no run</Cell>;
  return (
    <Link href={`/runs/${runId}`} className="truncate font-mono text-[11px] text-primary underline-offset-4 hover:underline">
      run {runId.slice(-8)}
    </Link>
  );
}

export function DebugModelCallList({ calls }: { calls: DebugModelCall[] }) {
  return (
    <ul className="divide-y">
      {calls.map((c) => (
        <li key={c.id}>
          <details className="group/call">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/call:rotate-90" aria-hidden="true" />
              <div className="grid min-w-0 flex-1 grid-cols-2 items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_repeat(4,minmax(0,0.8fr))]">
                <span className="truncate text-sm font-medium">{c.purpose}</span>
                <Cell mono>
                  {c.provider}:{c.model} <span className="text-muted-foreground/60">· {c.tier}</span>
                </Cell>
                <Cell className="tabular-nums">
                  {formatTokens(c.inputTokens)} in · {formatTokens(c.outputTokens)} out
                </Cell>
                <Cell className="tabular-nums">{formatUsdPrecise(c.costUsd)}</Cell>
                <Cell className="tabular-nums">{formatDuration(c.latencyMs)}</Cell>
                <span className="flex items-center gap-2">
                  {c.simulated ? <SimulatedBadge className="h-4.5 px-1.5 text-[10px]" /> : null}
                  {c.error ? <span className={cn("truncate text-[11px] font-medium", TONE_CLASSES.failure.text)}>error</span> : null}
                </span>
              </div>
            </summary>
            <div className="space-y-2 border-t bg-muted/20 px-4 py-3 pl-11">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-mono">{c.id}</span>
                <RunLink runId={c.runId} />
                <span>{formatDateTime(c.createdAt)}</span>
                {c.error ? <span className={TONE_CLASSES.failure.text}>{c.error}</span> : null}
              </div>
              <JsonView label="Request" value={c.request} />
              <JsonView label="Response" value={c.response} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function DebugToolCallList({ calls }: { calls: DebugToolCall[] }) {
  return (
    <ul className="divide-y">
      {calls.map((t) => (
        <li key={t.id}>
          <details className="group/call">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/call:rotate-90" aria-hidden="true" />
              <div className="grid min-w-0 flex-1 grid-cols-2 items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_repeat(3,minmax(0,0.8fr))_minmax(0,1fr)]">
                <span className="truncate font-mono text-sm font-medium">{t.toolName}</span>
                <span className={cn("inline-flex h-5 w-fit items-center rounded-full border px-2 text-[11px] font-medium", TONE_CLASSES[TOOL_STATUS_TONE[t.status]].badge)}>
                  {t.status.toLowerCase().replace(/_/g, " ")}
                </span>
                <Cell className="tabular-nums">attempt {t.attempt}</Cell>
                <Cell className="tabular-nums">{formatUsdPrecise(t.costUsd)}</Cell>
                <Cell className="tabular-nums">{t.latencyMs === null ? "—" : formatDuration(t.latencyMs)}</Cell>
                <span className="flex items-center gap-2">
                  {t.simulated ? <SimulatedBadge className="h-4.5 px-1.5 text-[10px]" /> : null}
                  <RunLink runId={t.runId} />
                </span>
              </div>
            </summary>
            <div className="space-y-2 border-t bg-muted/20 px-4 py-3 pl-11">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-mono">{t.id}</span>
                <span>{formatDateTime(t.createdAt)}</span>
                {t.error ? <span className={TONE_CLASSES.failure.text}>{t.error}</span> : null}
              </div>
              <JsonView label="Input" value={t.input} />
              <JsonView label="Output" value={t.output} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
