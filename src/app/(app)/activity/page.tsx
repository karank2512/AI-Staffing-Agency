import type { Metadata } from "next";
import Link from "next/link";
import { isToday, isYesterday } from "date-fns";
import { Activity, ArrowUp, ChevronDown } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/server/queries/activity";
import { ActivityFilters } from "./_components/activity-filters";
import { ActivityRow } from "./_components/activity-row";

export const metadata: Metadata = { title: "Activity" };

interface ActivitySearchParams {
  worker?: string;
  type?: string;
  before?: string;
}

const GROUP_OPTIONS = (Object.keys(ACTIVITY_GROUPS) as Array<keyof typeof ACTIVITY_GROUPS>).map((value) => ({
  value,
  label: ACTIVITY_GROUP_LABELS[value],
}));

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
  const text = query.toString();
  return text ? `/activity?${text}` : "/activity";
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<ActivitySearchParams> }) {
  const [s, params] = await Promise.all([requireSession(), searchParams]);
  const workerId = params.worker?.trim() || undefined;
  const group = isActivityGroup(params.type) ? params.type : undefined;
  const before = params.before?.trim() || undefined;

  const [feed, workers, inFlight] = await Promise.all([
    getActivityFeed(s.organizationId, { workerId, group, before }),
    listActivityWorkers(s.organizationId),
    hasActivityInFlight(s.organizationId),
  ]);
  const days = groupActivityByDay(feed.items);
  const filtered = Boolean(workerId || group);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything your workers and your team have done, newest first."
        actions={
          // The raw id goes through even when it matches no worker (stale link): the select falls back to its
          // placeholder and the Clear button still offers a way out of the empty result.
          <ActivityFilters workers={workers} groups={GROUP_OPTIONS} workerId={workerId} group={group} />
        }
      />

      <div className="space-y-8">
        {before ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>Showing events from before {formatDateTime(before)}.</span>
            <Button variant="ghost" size="xs" asChild>
              <Link href={buildQuery(params, { before: undefined })}>
                <ArrowUp aria-hidden="true" /> Back to latest
              </Link>
            </Button>
          </div>
        ) : null}

        {days.length === 0 ? (
          <EmptyState
            icon={Activity}
            title={filtered || before ? "Nothing here" : "No activity yet"}
            description={
              filtered || before
                ? "No events match these filters. Try widening them or jump back to the latest."
                : "Hire your first worker and this feed will fill up with what they do: runs, deliverables, and requests for your sign-off."
            }
            action={
              filtered || before ? (
                <Button variant="outline" asChild>
                  <Link href="/activity">Show everything</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/hire">Hire a worker</Link>
                </Button>
              )
            }
          />
        ) : (
          days.map((day) => (
            <section key={day.day} className="space-y-3">
              <h2 className="eyebrow">{dayLabel(day)}</h2>
              <Card>
                <CardContent className="divide-y">
                  {day.items.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </CardContent>
              </Card>
            </section>
          ))
        )}

        {feed.nextCursor ? (
          <div className="flex justify-center">
            <Button variant="outline" asChild>
              <Link href={buildQuery(params, { before: feed.nextCursor })}>
                <ChevronDown aria-hidden="true" /> Load older activity
              </Link>
            </Button>
          </div>
        ) : days.length > 0 ? (
          <p className="text-center text-xs text-muted-foreground">That&apos;s everything — you&apos;ve reached the beginning.</p>
        ) : null}
      </div>

      {/* Only the live (first) page follows runs in flight; an older page is a snapshot the reader is studying. */}
      <AutoRefresh active={inFlight && !before} intervalMs={5000} />
    </>
  );
}
