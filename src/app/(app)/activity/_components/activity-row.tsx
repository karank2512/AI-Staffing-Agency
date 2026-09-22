import Link from "next/link";
import { Bot, ChevronRight, UserRound, type LucideIcon } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { WorkerAvatar } from "@/components/worker-avatar";
import { cn } from "@/lib/utils";
import type { ActivityItem } from "@/server/activity";

const ACTOR_ICON: Record<ActivityItem["actorType"], LucideIcon> = { USER: UserRound, SYSTEM: Bot, WORKER: Bot };

/** Failures and rejections get a rose dot so a bad day is visible at a glance; approvals waiting get amber. */
function toneDot(type: ActivityItem["type"]): string | null {
  switch (type) {
    case "RUN_FAILED":
    case "DELIVERABLE_REJECTED":
    case "APPROVAL_REJECTED":
      return "bg-rose-500";
    case "APPROVAL_REQUESTED":
      return "bg-amber-500";
    case "RUN_SUCCEEDED":
    case "DELIVERABLE_ACCEPTED":
    case "WORKER_HIRED":
      return "bg-emerald-500";
    default:
      return null;
  }
}

export interface ActivityRowProps {
  item: ActivityItem;
  /** Dense = the Workforce "Recent activity" list. */
  dense?: boolean;
}

/**
 * One feed entry: who did it (worker avatar, or a person/system icon), what happened, and when. The whole row
 * links to the most specific page the event knows about (deliverable → approval → version → run → worker).
 */
export function ActivityRow({ item, dense = false }: ActivityRowProps) {
  const ActorIcon = ACTOR_ICON[item.actorType];
  const dot = toneDot(item.type);
  const body = (
    <>
      <div className="relative shrink-0">
        {item.worker ? (
          <WorkerAvatar name={item.worker.name} color={item.worker.avatarColor} size="sm" />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/5 ring-inset">
            <ActorIcon className="size-3.5" aria-hidden="true" />
          </span>
        )}
        {dot ? (
          <span
            className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-card", dot)}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm text-foreground", dense ? "truncate" : "text-pretty")}>{item.title}</p>
        {item.detail ? (
          <p className={cn("text-xs text-pretty text-muted-foreground", dense ? "line-clamp-1" : "line-clamp-2")}>{item.detail}</p>
        ) : null}
        {!dense && item.actorType === "USER" && item.actorName ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">by {item.actorName}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 self-start text-xs text-muted-foreground tabular-nums">
        <RelativeTime iso={item.createdAt} />
        {item.href ? (
          <ChevronRight
            className="size-3.5 opacity-0 transition-opacity group-hover/row:opacity-100"
            aria-hidden="true"
          />
        ) : null}
      </div>
    </>
  );

  const rowClass = cn("group/row flex items-start gap-3", dense ? "py-2.5" : "py-3");
  if (item.href) {
    return (
      <Link href={item.href} className={cn(rowClass, "-mx-2 rounded-md px-2 hover:bg-muted/60")}>
        {body}
      </Link>
    );
  }
  return <div className={rowClass}>{body}</div>;
}
