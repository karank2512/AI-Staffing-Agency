"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DeliverableStatus } from "@prisma/client";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pluralize } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import type { WorkerDeliverableRow } from "@/server/queries/worker-profile";
import { formatLabel } from "../_components/labels";
import { Row, RowList, RowMeta, RowTitle, Sep } from "../_components/rows";

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
    <div className="space-y-5">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList aria-label="Filter deliverables by status">
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f}>
              {f === "ALL" ? "All" : statusLabel("deliverable", f)}
              <span className="metric ml-1 text-muted-foreground">{counts[f]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <RowList>
        {visible.length === 0 ? (
          <li>
            <EmptyState
              title={filter === "ALL" ? "No deliverables yet" : `Nothing ${statusLabel("deliverable", filter).toLowerCase()}`}
              description={
                filter === "ALL"
                  ? `${workerName}'s finished runs leave their work here for you to read and rate.`
                  : filter === "PENDING_REVIEW"
                    ? "You're all caught up."
                    : `No deliverable has been ${statusLabel("deliverable", filter).toLowerCase()} so far.`
              }
              action={
                filter !== "ALL" ? (
                  <Button variant="secondary" onClick={() => setFilter("ALL")}>
                    Show everything
                  </Button>
                ) : undefined
              }
            />
          </li>
        ) : (
          visible.map((d) => (
            <Row key={d.id} href={`/deliverables/${d.id}`}>
              <div className="min-w-0 flex-1">
                <RowTitle>{d.title}</RowTitle>
                <RowMeta>
                  <StatusBadge kind="deliverable" status={d.status} emphasis="dot" />
                  <Sep />
                  <span>
                    {workerName} delivered <RelativeTime iso={d.createdAt} />
                  </span>
                  <Sep />
                  <span>{formatLabel(d.format)}</span>
                  {d.recordCount !== null ? (
                    <>
                      <Sep />
                      <span>{pluralize(d.recordCount, "record")}</span>
                    </>
                  ) : null}
                </RowMeta>
                {d.status === "REJECTED" && d.feedback ? (
                  <p className="text-footnote mt-1.5 line-clamp-2 border-l-2 border-input pl-3 text-pretty text-muted-foreground">
                    {d.feedback}
                  </p>
                ) : null}
              </div>
              <span className="text-footnote hidden shrink-0 pt-0.5 font-medium text-link sm:block">
                {d.status === "PENDING_REVIEW" ? "Review" : "Read"} ›
              </span>
            </Row>
          ))
        )}
      </RowList>

      {visible.length > 0 ? (
        <p className="text-footnote text-muted-foreground">
          Showing {visible.length} of {pluralize(deliverables.length, "deliverable")}.{" "}
          <Link href="/activity" className="text-link hover:underline">
            See everything across the team ›
          </Link>
        </p>
      ) : null}
    </div>
  );
}
