import { Cog, DatabaseZap } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatNumber } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { SettingsExecutor } from "@/server/queries/settings";

function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
}

/** The background loop that picks up queued runs. Read-only: it is configured through env vars. */
export function ExecutorCard({ executor }: { executor: SettingsExecutor }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Cog className="size-4 text-muted-foreground" aria-hidden="true" />
          Executor
          {executor.enabled ? (
            <Badge variant="outline" className={cn("gap-1", TONE_CLASSES.success.badge)}>
              <span className={cn("size-1.5 rounded-full", TONE_CLASSES.success.dot)} aria-hidden="true" />
              Running
            </Badge>
          ) : (
            <Badge variant="outline" className={cn("gap-1", TONE_CLASSES.attention.badge)}>
              <span className={cn("size-1.5 rounded-full", TONE_CLASSES.attention.dot)} aria-hidden="true" />
              Disabled
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {executor.enabled
            ? "The in-process worker loop picks up queued runs and fires scheduled ones."
            : "EXECUTOR_DISABLED is set: runs queue up but nothing picks them up until it is unset and the server restarts."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Poll interval</dt>
            <dd className="metric mt-0.5 font-medium">{formatDuration(executor.pollMs)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Concurrency</dt>
            <dd className="metric mt-0.5 font-medium">{formatNumber(executor.concurrency, 0)} runs at once</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Scheduler tick</dt>
            <dd className="metric mt-0.5 font-medium">{formatDuration(executor.schedulerTickMs)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Stale run recovery</dt>
            <dd className="metric mt-0.5 font-medium">after {formatDuration(executor.staleLockMs)} without a heartbeat</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-pretty text-muted-foreground">
          Tune with <Code>EXECUTOR_POLL_MS</Code>, <Code>EXECUTOR_CONCURRENCY</Code>, <Code>SCHEDULER_TICK_MS</Code> and{" "}
          <Code>EXECUTOR_STALE_LOCK_MS</Code>; set <Code>EXECUTOR_DISABLED=true</Code> to pause it.
        </p>
      </CardContent>
    </Card>
  );
}

const SEED_COMMAND = "npm run db:seed";

/** How to get the demo workspace back to its starting point. */
export function DemoDataCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZap className="size-4 text-muted-foreground" aria-hidden="true" />
          Demo data
        </CardTitle>
        <CardDescription>Three workers with three weeks of history, ready to explore, hire, review and replace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-pretty text-muted-foreground">
          Made a mess? Re-seed from a terminal in the project folder. It wipes and recreates the demo workspace with the same ids, so
          you stay signed in.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
          <code className="font-mono text-xs">{SEED_COMMAND}</code>
          <CopyButton value={SEED_COMMAND} />
        </div>
        <p className="text-xs text-pretty text-muted-foreground">
          Runs, deliverables, evaluations and usage you created since are removed; tool credentials set here are too.
        </p>
      </CardContent>
    </Card>
  );
}
