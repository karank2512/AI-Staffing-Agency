import Link from "next/link";
import { Activity, Bot, UserRound } from "lucide-react";
import type { ActivityType } from "@prisma/client";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkerAvatar } from "@/components/worker-avatar";
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
  const Icon = item.actorType === "USER" ? UserRound : Bot;
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/5">
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

/** The job's story so far — hires, runs, deliverables, reviews — with each headline linking to what it describes. */
export function JobActivity({ items }: { items: ActivityItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>What has happened on this job, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState icon={Activity} title="Quiet so far" description="Events appear here as the job moves along." className="py-8" />
        ) : (
          <ol className="space-y-4">
            {items.map((item) => {
              const tone = EVENT_TONE[item.type];
              return (
                <li key={item.id} className="flex gap-3">
                  <div className="relative shrink-0">
                    <Actor item={item} />
                    {tone ? (
                      <span
                        aria-hidden="true"
                        className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card", TONE_CLASSES[tone].dot)}
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5 text-pretty">
                      {item.href ? (
                        <Link href={item.href} className="font-medium hover:underline">
                          {item.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{item.title}</span>
                      )}
                    </p>
                    {item.detail ? <p className="mt-0.5 line-clamp-2 text-xs text-pretty text-muted-foreground">{item.detail}</p> : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <RelativeTime iso={item.createdAt} />
                    </p>
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
