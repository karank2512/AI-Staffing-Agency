import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Section } from "@/components/section";
import { formatDuration, formatUsd } from "@/lib/format";
import { isAppError } from "@/server/errors";
import { getWorkerPermissions, type WorkerPermissionsView } from "@/server/queries/worker-manage";
import { PermissionsGrantsTable } from "./permissions-grants-table";
import { PermissionsScheduleEditor } from "./permissions-schedule-editor";
import type { WorkerTabProps } from "./types";

/**
 * Permissions tab — what the worker may touch, when it works and how much a run may spend. Grants and schedule
 * change in place; run limits belong to the blueprint and only move through a new version.
 */
export default async function PermissionsTab({ session, workerId, workerName }: WorkerTabProps) {
  let data: WorkerPermissionsView;
  try {
    data = await getWorkerPermissions(session.organizationId, workerId);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const retired = data.worker.status === "RETIRED";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Section
          title="Tool access"
          description={`Every tool ${workerName} can use, and whether it needs your approval before each use.`}
        >
          <Card>
            {data.grants.length === 0 ? (
              <CardContent>
                <EmptyState
                  icon={ShieldCheck}
                  title="No tools yet"
                  description={`${workerName} has not been granted any tools. Tools come from the worker's design and appear here once hired.`}
                />
              </CardContent>
            ) : (
              <PermissionsGrantsTable workerId={data.worker.id} workerName={workerName} grants={data.grants} readOnly={retired} />
            )}
          </Card>
        </Section>

        <div className="flex gap-3 rounded-lg border bg-muted/40 p-4 text-[13px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          <p className="text-pretty">
            <span className="font-medium text-foreground">Enforced on the server, every time.</span> Each tool call is checked against
            these grants before it runs — a revoked tool is refused even if {workerName} asks for it, and an approval-gated tool pauses
            the run until you decide in{" "}
            <Link href="/approvals" className="font-medium text-primary underline-offset-4 hover:underline">
              Approvals
            </Link>
            . Tools that ship approval-gated (like sending notifications) cannot be loosened.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <Section title="Schedule" description="When the next run starts. Times are in the server's local time.">
          <Card>
            <CardContent>
              <PermissionsScheduleEditor
                workerId={data.worker.id}
                workerName={workerName}
                schedule={data.schedule}
                scheduleLabel={data.scheduleLabel}
                nextRunAt={data.worker.nextRunAt}
                status={data.worker.status}
              />
            </CardContent>
          </Card>
        </Section>

        <Section title="Run limits" description="Guardrails every run stays inside.">
          <Card>
            <CardHeader>
              <CardTitle>Per run</CardTitle>
              <CardDescription>
                {data.currentVersion ? `From version ${data.currentVersion.version} of ${workerName}'s design.` : "No active version."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.limits ? (
                <dl className="divide-y text-sm">
                  <LimitRow label="Max spend" value={formatUsd(data.limits.maxCostPerRunUsd)} hint={data.estimatedCostPerRunUsd !== null ? `~${formatUsd(data.estimatedCostPerRunUsd)} expected` : undefined} />
                  <LimitRow label="Max tool calls" value={String(data.limits.maxToolCallsPerRun)} />
                  <LimitRow label="Max duration" value={formatDuration(data.limits.maxRunDurationSec * 1000)} />
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Limits appear once {workerName} has an active version.</p>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                Limits are part of the design, so they change through a new version.{" "}
                <Link href={`/workers/${data.worker.id}?tab=versions#replace`} className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline">
                  Propose a change <ArrowUpRight className="size-3" aria-hidden="true" />
                </Link>
              </p>
            </CardContent>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function LimitRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">
        <span className="font-medium">{value}</span>
        {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}
