import type { Metadata } from "next";
import Link from "next/link";
import { isToday, isYesterday } from "date-fns";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { LiveDot } from "@/components/live-dot";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireSession } from "@/server/auth";
import {
  ACTIVITY_GROUP_LABELS,
  ACTIVITY_GROUPS,
  getActivityFeed,
  groupActivityByDay,
  hasActivityInFlight,
  isActivityGroup,
  listActivityWorkers,
  type ActivityDayGroup,
  type ActivityGroup,
} from "@/server/queries/activity";
import { ActivityFilters } from "./_components/activity-filters";
import { ActivityRow } from "./_components/activity-row";

export const metadata: Metadata = { title: "Activity" };

interface ActivitySearchParams {
  worker?: string;
  type?: string;
  before?: string;
  show?: string;
}

/** "Load more" grows the page in place. Capped so the feed query can still tell us whether older events exist. */
const PAGE_SIZE = 40;
const MAX_SHOW = 160;

/** Shorter, friendlier labels than the query module's own — the segments have to fit a phone. */
const SEGMENT_LABELS: Partial<Record<ActivityGroup, string>> = {
  approvals: "Decisions",
  hiring: "Hiring",
  permissions: "Permissions",
};

const SEGMENTS = [
  { value: "", label: "All" },
  ...(Object.keys(ACTIVITY_GROUPS) as ActivityGroup[]).map((value) => ({
    value,
    label: SEGMENT_LABELS[value] ?? ACTIVITY_GROUP_LABELS[value],
  })),
];

function parseShow(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return PAGE_SIZE;
  return Math.min(MAX_SHOW, Math.max(PAGE_SIZE, Math.round(n / PAGE_SIZE) * PAGE_SIZE));
}

function dayLabel(group: ActivityDayGroup): string {
  // Label from the first event's timestamp (not the yyyy-MM-dd key) so "Today" agrees with the server's clock.
  const first = new Date(group.items[0]?.createdAt ?? group.day);
  if (isToday(first)) return "Today";
  if (isYesterday(first)) return "Yesterday";
  return formatDate(first);
}

function buildQuery(params: ActivitySearchParams, overrides: Partial<ActivitySearchParams>): string {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  if (merged.worker) query.set("worker", merged.worker);
  if (merged.type) query.set("type", merged.type);
  if (merged.before) query.set("before", merged.before);
  if (merged.show) query.set("show", merged.show);
  const text = query.toString();
  return text ? `/activity?${text}` : "/activity";
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<ActivitySearchParams> }) {
  const [s, params] = await Promise.all([requireSession(), searchParams]);
  const workerId = params.worker?.trim() || undefined;
  const group = isActivityGroup(params.type) ? params.type : undefined;
  const before = params.before?.trim() || undefined;
  const show = parseShow(params.show);

  const [feed, workers, inFlight] = await Promise.all([
    getActivityFeed(s.organizationId, { workerId, group, before, limit: show }),
    listActivityWorkers(s.organizationId),
    hasActivityInFlight(s.organizationId),
  ]);
  const days = groupActivityByDay(feed.items);
  const filtered = Boolean(workerId || group);
  const live = inFlight && !before;

  // Grow the page first; once it is as large as the feed query can page in one go, step back in time instead.
  const more = feed.nextCursor
    ? show < MAX_SHOW
      ? { href: buildQuery(params, { show: String(show + PAGE_SIZE) }), label: "Load more" }
      : { href: buildQuery(params, { before: feed.nextCursor, show: undefined }), label: "Show older activity" }
    : null;

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything your workers and your team have done, newest first."
        actions={live ? <LiveDot /> : undefined}
      />

      <div className="space-y-8">
        <ActivityFilters workers={workers} groups={SEGMENTS} workerId={workerId} group={group} />

        {before ? (
          <p className="text-footnote flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span>Events from before {formatDateTime(before)}.</span>
            <Button variant="link" asChild>
              <Link href={buildQuery(params, { before: undefined, show: undefined })}>Back to latest</Link>
            </Button>
          </p>
        ) : null}

        {days.length === 0 ? (
          <Card>
            <EmptyState
              title={filtered || before ? "Nothing matches" : "Nothing has happened yet"}
              description={
                filtered || before
                  ? "No events fit these filters. Widen them, or jump back to the latest."
                  : "Hire your first worker and this feed fills up on its own: runs, deliverables, and the moments a worker stops to ask you something."
              }
              action={
                filtered || before ? (
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/activity">Show everything</Link>
                  </Button>
                ) : (
                  <Button size="lg" asChild>
                    <Link href="/hire">Hire a worker</Link>
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {days.map((day) => (
              <Card key={day.day} className="overflow-visible py-0">
                <h2 className="text-footnote sticky top-(--nav-height) z-10 rounded-t-xl border-b border-border bg-card px-6 py-3 font-semibold text-muted-foreground">
                  {dayLabel(day)}
                </h2>
                <div className="divide-y divide-border px-6 pb-2">
                  {day.items.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        {more ? (
          <div className="flex justify-center">
            <Button variant="secondary" asChild>
              <Link href={more.href}>{more.label}</Link>
            </Button>
          </div>
        ) : days.length > 0 ? (
          <p className="text-footnote text-center text-muted-foreground">That&apos;s the beginning of the record.</p>
        ) : null}
      </div>

      {/* Only the live (first) page follows runs in flight; an older page is a snapshot the reader is studying. */}
      <AutoRefresh active={live} intervalMs={5000} />
    </>
  );
}
