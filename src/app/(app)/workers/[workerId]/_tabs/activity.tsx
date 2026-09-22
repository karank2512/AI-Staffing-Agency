import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  Briefcase,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  GitBranch,
  History,
  KeyRound,
  MessageSquare,
  Pause,
  Play,
  ShieldCheck,
  ShieldX,
  StickyNote,
  UserMinus,
  UserPlus,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ActivityType } from "@prisma/client";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { Section } from "@/components/section";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityItem } from "@/server/activity";
import { listWorkerActivity, listWorkerRuns } from "@/server/queries/worker-profile";
import { RunsTable } from "../_components/runs-table";
import type { WorkerTabProps } from "./types";

/** Icon + tone per event type. Tones follow the status palette (emerald / amber / rose / sky / slate). */
const EVENT_META: Record<ActivityType, { icon: LucideIcon; className: string }> = {
  JOB_CREATED: { icon: Briefcase, className: "bg-slate-100 text-slate-600" },
  JOB_SPEC_APPROVED: { icon: ClipboardCheck, className: "bg-slate-100 text-slate-600" },
  WORKER_HIRED: { icon: UserPlus, className: "bg-emerald-50 text-emerald-600" },
  WORKER_PAUSED: { icon: Pause, className: "bg-amber-50 text-amber-600" },
  WORKER_RESUMED: { icon: Play, className: "bg-emerald-50 text-emerald-600" },
  WORKER_RETIRED: { icon: UserMinus, className: "bg-slate-100 text-slate-600" },
  WORKER_REPLACED: { icon: ArrowLeftRight, className: "bg-sky-50 text-sky-600" },
  VERSION_PROPOSED: { icon: GitBranch, className: "bg-sky-50 text-sky-600" },
  VERSION_REJECTED: { icon: XCircle, className: "bg-slate-100 text-slate-600" },
  RUN_QUEUED: { icon: History, className: "bg-slate-100 text-slate-600" },
  RUN_STARTED: { icon: Play, className: "bg-sky-50 text-sky-600" },
  RUN_SUCCEEDED: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
  RUN_FAILED: { icon: XCircle, className: "bg-rose-50 text-rose-600" },
  RUN_CANCELLED: { icon: Ban, className: "bg-slate-100 text-slate-600" },
  TOOL_USED: { icon: Wrench, className: "bg-slate-100 text-slate-600" },
  APPROVAL_REQUESTED: { icon: ShieldCheck, className: "bg-amber-50 text-amber-600" },
  APPROVAL_APPROVED: { icon: ShieldCheck, className: "bg-emerald-50 text-emerald-600" },
  APPROVAL_REJECTED: { icon: ShieldX, className: "bg-rose-50 text-rose-600" },
  DELIVERABLE_CREATED: { icon: FileText, className: "bg-sky-50 text-sky-600" },
  DELIVERABLE_ACCEPTED: { icon: CheckCircle2, className: "bg-emerald-50 text-emerald-600" },
  DELIVERABLE_REJECTED: { icon: XCircle, className: "bg-rose-50 text-rose-600" },
  EVALUATION_COMPLETED: { icon: ClipboardCheck, className: "bg-slate-100 text-slate-600" },
  REVIEW_GENERATED: { icon: ClipboardList, className: "bg-sky-50 text-sky-600" },
  INSTRUCTION_RECEIVED: { icon: MessageSquare, className: "bg-sky-50 text-sky-600" },
  PERMISSION_CHANGED: { icon: KeyRound, className: "bg-amber-50 text-amber-600" },
  NOTE: { icon: StickyNote, className: "bg-slate-100 text-slate-600" },
};

const FALLBACK_META = { icon: StickyNote, className: "bg-slate-100 text-slate-600" };

export default async function ActivityTab({ session, workerId, workerName }: WorkerTabProps) {
  const [days, runs] = await Promise.all([
    listWorkerActivity(session.organizationId, workerId),
    listWorkerRuns(session.organizationId, workerId),
  ]);
  const eventCount = days.reduce((n, d) => n + d.items.length, 0);

  return (
    <>
      <Section title={`What ${workerName} has been up to`} description={eventCount > 0 ? `${eventCount} recent events, newest first.` : undefined}>
        {days.length === 0 ? (
          <EmptyState icon={History} title="Nothing to show yet" description={`Once ${workerName} starts working, every run, deliverable and decision lands here.`} />
        ) : (
          <div className="space-y-6">
            {days.map((day) => (
              <div key={day.date}>
                <p className="eyebrow sticky top-0 z-10 mb-2 bg-background py-1">{day.label}</p>
                <Card className="py-0">
                  <ol className="divide-y">
                    {day.items.map((item) => (
                      <FeedRow key={item.id} item={item} />
                    ))}
                  </ol>
                </Card>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Runs" description={runs.length > 0 ? `Every time ${workerName} worked, newest first (last ${runs.length}).` : undefined}>
        <Card className="py-0">
          <RunsTable runs={runs} workerName={workerName} />
        </Card>
      </Section>
    </>
  );
}

function FeedRow({ item }: { item: ActivityItem }) {
  const meta = EVENT_META[item.type] ?? FALLBACK_META;
  const Icon = meta.icon;
  const actor = item.actorType === "USER" && item.actorName ? item.actorName : null;

  return (
    <li className="flex gap-3 px-4 py-3">
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", meta.className)}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-medium text-pretty">
            {item.href ? (
              <Link href={item.href} className="underline-offset-4 hover:underline">
                {item.title}
              </Link>
            ) : (
              item.title
            )}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(item.createdAt)}>
            <RelativeTime iso={item.createdAt} />
          </span>
        </div>
        {item.detail ? <p className="mt-0.5 line-clamp-2 text-sm text-pretty text-muted-foreground">{item.detail}</p> : null}
        {actor || item.href ? (
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {actor ? <span>by {actor}</span> : null}
            {item.href ? (
              <Link href={item.href} className="inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline">
                Open
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}
