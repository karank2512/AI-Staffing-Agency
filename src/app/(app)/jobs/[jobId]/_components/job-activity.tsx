import Link from "next/link";
import type { ActivityType } from "@prisma/client";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { initialsOf } from "@/lib/initials";
import { TONE_CLASSES, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ActivityItem } from "@/server/activity";

/** Which events deserve a coloured dot: outcomes and things waiting on a human. Everything else stays neutral. */
const EVENT_TONE: Partial<Record<ActivityType, StatusTone>> = {
  RUN_SUCCEEDED: "success",
  DELIVERABLE_ACCEPTED: "success",
  WORKER_HIRED: "success",
  RUN_FAILED: "failure",
  DELIVERABLE_REJECTED: "failure",
  APPROVAL_REJECTED: "failure",
  APPROVAL_REQUESTED: "attention",
  VERSION_PROPOSED: "attention",
  WORKER_PAUSED: "attention",
  RUN_STARTED: "running",
  RUN_QUEUED: "running",
};

function Actor({ item }: { item: ActivityItem }) {
  if (item.worker) return <WorkerAvatar name={item.worker.name} color={item.worker.avatarColor} size="sm" />;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-caption font-semibold text-muted-foreground"
    >
      {item.actorName ? initialsOf(item.actorName) : "·"}
    </span>
  );
}

/** The job's story so far — hires, runs, deliverables, reviews — as sentences with the time on the right. */
export function JobActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>What has happened on this job, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title="Quiet so far" description="Events appear here as the job moves along." className="py-10" />
        ) : (
          <ol>
            {items.map((item) => {
              const tone = EVENT_TONE[item.type];
              return (
                <li key={item.id} className="flex gap-3 border-b border-border py-3.5 first:pt-0 last:border-0 last:pb-0">
                  <span className="relative shrink-0">
                    <Actor item={item} />
                    {tone ? (
                      <span
                        aria-hidden="true"
                        className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", TONE_CLASSES[tone].dot)}
                      />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[15px] text-pretty">
                        {item.href ? (
                          <Link href={item.href} className="hover:text-link hover:underline">
                            {item.title}
                          </Link>
                        ) : (
                          item.title
                        )}
                      </span>
                      <span className="shrink-0 text-footnote text-muted-foreground">
                        <RelativeTime iso={item.createdAt} />
                      </span>
                    </p>
                    {item.detail ? (
                      <p className="mt-0.5 line-clamp-2 text-footnote text-pretty text-muted-foreground">{item.detail}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
