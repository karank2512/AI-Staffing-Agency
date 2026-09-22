import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, FileX2, HeartPulse, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/server/queries/workforce";
import { ApprovalDecision } from "@/app/(app)/approvals/_components/approval-decision";

const ICON_TONE = {
  attention: "bg-amber-50 text-amber-700 ring-amber-200",
  failure: "bg-rose-50 text-rose-700 ring-rose-200",
} as const;

function Row({
  icon: Icon,
  tone,
  worker,
  title,
  detail,
  meta,
  actions,
}: {
  icon: LucideIcon;
  tone: keyof typeof ICON_TONE;
  worker: { workerId: string; workerName: string; avatarColor: string };
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset", ICON_TONE[tone])}>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-medium text-pretty text-foreground">{title}</p>
          {detail ? <p className="line-clamp-2 text-xs text-pretty text-muted-foreground">{detail}</p> : null}
          <p className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
            <Link href={`/workers/${worker.workerId}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <WorkerAvatar name={worker.workerName} color={worker.avatarColor} size="sm" className="size-4 text-[8px]" />
              {worker.workerName}
            </Link>
            {meta ? (
              <>
                <span aria-hidden="true">·</span>
                {meta}
              </>
            ) : null}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-10 sm:pl-0">{actions}</div>
    </li>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  switch (item.kind) {
    case "approval":
      return (
        <Row
          icon={ShieldAlert}
          tone="attention"
          worker={item}
          title={item.title}
          detail={item.description ?? `${item.workerName} is paused until you decide.`}
          meta={
            <>
              {item.toolLabel} · asked <RelativeTime iso={item.requestedAt} />
              {" · "}
              <Link href={`/runs/${item.runId}`} className="hover:text-foreground hover:underline">
                view run
              </Link>
            </>
          }
          actions={
            // The row only has room for a summary, so the Approve confirmation carries the full payload.
            <ApprovalDecision approvalId={item.approvalId} workerName={item.workerName} toolLabel={item.toolLabel} payload={item.payload} size="sm" />
          }
        />
      );
    case "health":
      return (
        <Row
          icon={HeartPulse}
          tone="attention"
          worker={item}
          title={`${item.workerName}'s recent work needs a look`}
          detail={item.reason ?? `${item.workerName}'s score has dropped below the healthy range.`}
          meta={item.score !== null ? <span>score {Math.round(item.score)} / 100</span> : <span>{item.workerTitle}</span>}
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/workers/${item.workerId}?tab=performance`}>
                Review performance <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      );
    case "run_failed":
      return (
        <Row
          icon={TriangleAlert}
          tone="failure"
          worker={item}
          title={`${item.workerName}'s run failed`}
          detail={item.error ?? "The run stopped before producing a deliverable."}
          meta={<RelativeTime iso={item.at} />}
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/runs/${item.runId}`}>
                See what happened <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      );
    case "deliverable_rejected":
      return (
        <Row
          icon={FileX2}
          tone="failure"
          worker={item}
          title={`"${item.title}" was sent back`}
          detail={item.feedback ? `Feedback: ${item.feedback}` : "Rejected without feedback."}
          meta={<RelativeTime iso={item.at} />}
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/deliverables/${item.deliverableId}`}>
                Open deliverable <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      );
  }
}

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

/** "Needs your attention": the short list of things only a human can unblock, most urgent first. */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  return (
    <Card className="border-l-2 border-l-amber-400">
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => (
            <AttentionRow key={keyOf(item)} item={item} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
