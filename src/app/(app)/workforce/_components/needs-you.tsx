import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import type { AttentionItem } from "@/server/queries/workforce";
import { ApprovalDecision } from "@/app/(app)/approvals/_components/approval-decision";
import { PayloadPreview } from "@/app/(app)/approvals/_components/payload-preview";
import { requestSentence } from "@/app/(app)/approvals/_components/request";

/** Three is enough to act on; more than that belongs on the page that lists them. */
const MAX_ROWS = 3;

function keyOf(item: AttentionItem): string {
  switch (item.kind) {
    case "approval":
      return `approval:${item.approvalId}`;
    case "health":
      return `health:${item.workerId}`;
    case "run_failed":
      return `run:${item.runId}`;
    case "deliverable_rejected":
      return `deliverable:${item.deliverableId}`;
  }
}

function Row({
  item,
  sentence,
  meta,
  preview,
  action,
}: {
  item: AttentionItem;
  sentence: string;
  meta: ReactNode;
  preview?: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
      <Link href={`/workers/${item.workerId}`} className="shrink-0 rounded-full outline-none max-sm:hidden">
        <WorkerAvatar name={item.workerName} color={item.avatarColor} size="sm" />
      </Link>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-3">
          <Link href={`/workers/${item.workerId}`} className="shrink-0 rounded-full outline-none sm:hidden">
            <WorkerAvatar name={item.workerName} color={item.avatarColor} size="sm" />
          </Link>
          <div className="min-w-0 space-y-0.5">
            <p className="text-body-app text-pretty text-foreground">{sentence}</p>
            <p className="text-footnote flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">{meta}</p>
          </div>
        </div>
        {preview}
      </div>
      <div className="shrink-0 sm:pl-2">{action}</div>
    </li>
  );
}

function AttentionRow({ item, blockedReason }: { item: AttentionItem; blockedReason?: string }) {
  switch (item.kind) {
    case "approval":
      return (
        <Row
          item={item}
          sentence={requestSentence(item.workerName, item.title)}
          meta={
            <>
              <span>
                Asked <RelativeTime iso={item.requestedAt} />
              </span>
              <span aria-hidden="true">·</span>
              <Link href={`/runs/${item.runId}`} className="outline-none hover:text-foreground">
                the run is paused
              </Link>
            </>
          }
          preview={<PayloadPreview payload={item.payload} workerName={item.workerName} compact />}
          action={
            <ApprovalDecision
              approvalId={item.approvalId}
              workerName={item.workerName}
              toolLabel={item.toolLabel}
              payload={item.payload}
              emphasis="quiet"
              disabledReason={blockedReason}
            />
          }
        />
      );
    case "health":
      return (
        <Row
          item={item}
          sentence={`${item.workerName}'s recent work needs a look`}
          meta={
            <>
              <span className="text-pretty text-warning">
                {item.reason ?? "Their score has slipped below the healthy range."}
              </span>
              {item.score !== null ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">score {Math.round(item.score)}</span>
                </>
              ) : null}
            </>
          }
          action={
            <Button variant="secondary" className="max-sm:h-11 max-sm:w-full" asChild>
              <Link href={`/workers/${item.workerId}?tab=performance`}>Review</Link>
            </Button>
          }
        />
      );
    case "run_failed":
      return (
        <Row
          item={item}
          sentence={`${item.workerName}'s run stopped before it produced anything`}
          meta={
            <>
              <RelativeTime iso={item.at} />
              {item.error ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="line-clamp-1 text-pretty">{item.error}</span>
                </>
              ) : null}
            </>
          }
          action={
            <Button variant="secondary" className="max-sm:h-11 max-sm:w-full" asChild>
              <Link href={`/runs/${item.runId}`}>See the run</Link>
            </Button>
          }
        />
      );
    case "deliverable_rejected":
      return (
        <Row
          item={item}
          sentence={`You sent “${item.title}” back to ${item.workerName}`}
          meta={
            <>
              <RelativeTime iso={item.at} />
              {item.feedback ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="line-clamp-1 text-pretty">“{item.feedback}”</span>
                </>
              ) : null}
            </>
          }
          action={
            <Button variant="secondary" className="max-sm:h-11 max-sm:w-full" asChild>
              <Link href={`/deliverables/${item.deliverableId}`}>Open</Link>
            </Button>
          }
        />
      );
  }
}

export interface NeedsYouProps {
  /** Already ordered by urgency, and already stripped of anything that has been dealt with. */
  items: AttentionItem[];
  /** approvalId → why this viewer can't decide it. Absent means they can. */
  blockedReasons?: Record<string, string>;
}

/** The short list of things only a person can unblock. Rendered only when it isn't empty. */
export function NeedsYou({ items, blockedReasons = {} }: NeedsYouProps) {
  const shown = items.slice(0, MAX_ROWS);
  const hidden = items.slice(MAX_ROWS);
  const overflowHref = hidden.some((item) => item.kind === "approval") ? "/approvals" : "/activity";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-title-2">
          {items.length === 1 ? "One thing needs you" : `${items.length} things need you`}
        </CardTitle>
        {hidden.length > 0 ? (
          <CardAction>
            <Button variant="link" asChild>
              <Link href={overflowHref}>
                See all <ChevronRight data-icon="inline-end" />
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {shown.map((item) => (
            <AttentionRow
              key={keyOf(item)}
              item={item}
              blockedReason={item.kind === "approval" ? blockedReasons[item.approvalId] : undefined}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
