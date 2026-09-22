"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Inbox, Quote } from "lucide-react";
import type { DeliverableStatus } from "@prisma/client";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pluralize } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { WorkerDeliverableRow } from "@/server/queries/worker-profile";
import { formatLabel } from "../_components/labels";

type Filter = "ALL" | DeliverableStatus;
const FILTERS: Filter[] = ["ALL", "PENDING_REVIEW", "ACCEPTED", "REJECTED"];

export interface DeliverablesListProps {
  deliverables: WorkerDeliverableRow[];
  workerName: string;
}

/** Client leaf: the status filter is UI state only, so the tab stays a plain `?tab=deliverables` URL. */
export function DeliverablesList({ deliverables, workerName }: DeliverablesListProps) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: deliverables.length, PENDING_REVIEW: 0, ACCEPTED: 0, REJECTED: 0 };
    for (const d of deliverables) c[d.status] += 1;
    return c;
  }, [deliverables]);

  const visible = filter === "ALL" ? deliverables : deliverables.filter((d) => d.status === filter);

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList aria-label="Filter deliverables by status">
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f} className="px-2.5">
              {f === "ALL" ? "All" : statusLabel("deliverable", f)}
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", filter === f ? "bg-muted text-foreground" : "text-muted-foreground")}>
                {counts[f]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filter === "ALL" ? "No deliverables yet" : `Nothing ${statusLabel("deliverable", filter).toLowerCase()}`}
          description={
            filter === "ALL"
              ? `${workerName}'s finished runs will drop their reports here for you to review.`
              : filter === "PENDING_REVIEW"
                ? "You're all caught up."
                : `No deliverable has been ${statusLabel("deliverable", filter).toLowerCase()} so far.`
          }
          action={filter !== "ALL" ? <Button variant="outline" size="sm" onClick={() => setFilter("ALL")}>Show all</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {visible.map((d) => (
            <li key={d.id}>
              <DeliverableCard deliverable={d} workerName={workerName} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeliverableCard({ deliverable: d, workerName }: { deliverable: WorkerDeliverableRow; workerName: string }) {
  return (
    <Card className="h-full py-0">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/deliverables/${d.id}`} className="min-w-0 text-sm font-medium text-pretty underline-offset-4 hover:underline">
            {d.title}
          </Link>
          <StatusBadge kind="deliverable" status={d.status} className="shrink-0" />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{formatLabel(d.format)}</Badge>
          {d.recordCount !== null ? <span>{pluralize(d.recordCount, "record")}</span> : null}
          <span>v{d.version}</span>
        </div>

        {d.summary ? <p className="line-clamp-3 text-sm text-pretty text-muted-foreground">{d.summary}</p> : null}

        {d.status === "REJECTED" && d.feedback ? (
          <blockquote className="flex gap-2 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2 text-xs text-rose-800">
            <Quote className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2">{d.feedback}</span>
          </blockquote>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>
            {workerName} delivered <RelativeTime iso={d.createdAt} />
            {d.reviewedAt ? (
              <>
                {" "}
                · reviewed <RelativeTime iso={d.reviewedAt} />
              </>
            ) : null}
          </span>
          <span className="flex items-center gap-3">
            <Link href={`/runs/${d.runId}`} className="text-primary underline-offset-4 hover:underline">
              Run
            </Link>
            <Link href={`/deliverables/${d.id}`} className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline">
              {d.status === "PENDING_REVIEW" ? "Review" : "Open"}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
