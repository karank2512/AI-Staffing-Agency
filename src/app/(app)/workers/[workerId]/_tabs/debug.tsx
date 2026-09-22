import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Bug } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { JsonView } from "@/components/json-view";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { isAppError } from "@/server/errors";
import { getWorkerDebug, type WorkerDebugView } from "@/server/queries/worker-manage";
import { DebugModelCallList, DebugToolCallList } from "./debug-call-lists";
import type { WorkerTabProps } from "./types";

/**
 * Debug tab — the raw material behind the worker for engineers and demos: the live blueprint, the latest run's
 * checkpoint, recent model and tool calls, and the grant rows as stored. Everything is org-scoped by the query.
 */
export default async function DebugTab({ session, workerId, workerName }: WorkerTabProps) {
  let data: WorkerDebugView;
  try {
    data = await getWorkerDebug(session.organizationId, workerId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Bug className="size-3.5" aria-hidden="true" /> Under the hood
        </span>
        <span className="inline-flex items-center gap-1">
          worker <code className="font-mono text-[11px]">{data.worker.id}</code> <CopyButton value={data.worker.id} />
        </span>
        {data.currentVersion ? (
          <span className="inline-flex items-center gap-1">
            version {data.currentVersion.version} <code className="font-mono text-[11px]">{data.currentVersion.id}</code>
            <CopyButton value={data.currentVersion.id} />
            <StatusBadge kind="version" status={data.currentVersion.status} />
            <span className="text-muted-foreground/80">{data.currentVersion.locked ? "· locked (has run)" : "· unlocked"}</span>
          </span>
        ) : (
          <span>no current version</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Current blueprint" description="The design the runtime executes, exactly as stored.">
          {data.blueprint === null ? (
            <Card>
              <CardContent>
                <EmptyState title="No blueprint" description={`${workerName} has no active version.`} />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {!data.blueprintValid ? (
                <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                  The stored blueprint no longer matches the current schema — showing the raw JSON.
                </p>
              ) : null}
              <JsonView label={`WorkerVersion.blueprint${data.currentVersion ? ` (v${data.currentVersion.version})` : ""}`} value={data.blueprint} defaultOpen />
            </div>
          )}
        </Section>

        <Section title="Latest checkpoint" description="Where the most recent run left off — what a resume starts from.">
          {data.latestRun ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-normal text-muted-foreground">{data.latestRun.id}</span>
                  <StatusBadge kind="run" status={data.latestRun.status} />
                  {data.latestRun.simulated ? <SimulatedBadge /> : null}
                </CardTitle>
                <CardDescription>
                  {data.latestRun.trigger.toLowerCase()} · attempt {data.latestRun.attempt} · created {formatDateTime(data.latestRun.createdAt)}
                  {data.latestRun.finishedAt ? ` · finished ${formatDateTime(data.latestRun.finishedAt)}` : ""}
                  {data.latestRun.error ? <span className="block text-rose-600">{data.latestRun.error}</span> : null}
                </CardDescription>
                <Button variant="outline" size="sm" asChild className="w-fit">
                  <Link href={`/runs/${data.latestRun.id}`}>
                    Open run <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {data.latestRun.checkpoint === null ? (
                  <p className="text-xs text-muted-foreground">No checkpoint saved yet — the run has not reached a component boundary.</p>
                ) : (
                  <JsonView label="Run.checkpoint" value={data.latestRun.checkpoint} defaultOpen />
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState title="No runs yet" description={`${workerName} has not started a run, so there is no checkpoint to show.`} />
              </CardContent>
            </Card>
          )}
        </Section>
      </div>

      <Section title="Model calls" description={`The last ${data.modelCalls.length} LLM calls made on behalf of ${workerName} — newest first. Expand a row for the request and response.`}>
        <Card className="overflow-hidden py-0">
          {data.modelCalls.length === 0 ? (
            <CardContent className="py-6">
              <EmptyState title="No model calls yet" description="Calls appear here as soon as a run, a chat reply or a replacement analysis happens." />
            </CardContent>
          ) : (
            <DebugModelCallList calls={data.modelCalls} />
          )}
        </Card>
      </Section>

      <Section title="Tool calls" description={`The last ${data.toolCalls.length} tool calls across ${workerName}'s runs — newest first.`}>
        <Card className="overflow-hidden py-0">
          {data.toolCalls.length === 0 ? (
            <CardContent className="py-6">
              <EmptyState title="No tool calls yet" description={`${workerName} has not used a tool in a run yet.`} />
            </CardContent>
          ) : (
            <DebugToolCallList calls={data.toolCalls} />
          )}
        </Card>
      </Section>

      <Section title="Raw grants" description="WorkerToolGrant rows as stored — what the permission check reads.">
        <JsonView label={`WorkerToolGrant × ${data.grants.length}`} value={data.grants} />
      </Section>
    </div>
  );
}
