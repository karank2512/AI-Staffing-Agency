import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { Section } from "@/components/section";
import { formatDateTime } from "@/lib/format";
import type { ActivityItem } from "@/server/activity";
import { listWorkerActivity, listWorkerRuns } from "@/server/queries/worker-profile";
import { Row, RowList, RowTitle } from "../_components/rows";
import { RunsTable } from "../_components/runs-table";
import type { WorkerTabProps } from "./types";

/** The worker's feed: one sentence per event, grouped under a sticky day header. No icon per row. */
export default async function ActivityTab({ session, workerId, workerName }: WorkerTabProps) {
  const [days, runs] = await Promise.all([
    listWorkerActivity(session.organizationId, workerId),
    listWorkerRuns(session.organizationId, workerId),
  ]);
  const eventCount = days.reduce((n, d) => n + d.items.length, 0);

  return (
    <>
      <Section
        title={`What ${workerName} has been up to`}
        description={eventCount > 0 ? `${eventCount} recent events, newest first.` : undefined}
      >
        {days.length === 0 ? (
          <RowList>
            <li>
              <EmptyState
                title="Nothing to show yet"
                description={`Once ${workerName} starts working, every run, deliverable and decision lands here.`}
              />
            </li>
          </RowList>
        ) : (
          <div className="space-y-8">
            {days.map((day) => (
              <div key={day.date}>
                <p className="eyebrow sticky top-[calc(var(--nav-height)+var(--localnav-height))] z-10 mb-2.5 bg-canvas py-1.5">
                  {day.label}
                </p>
                <RowList>
                  {day.items.map((item) => (
                    <FeedRow key={item.id} item={item} />
                  ))}
                </RowList>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Runs"
        description={runs.length > 0 ? `Every time ${workerName} worked, newest first.` : undefined}
      >
        <RunsTable runs={runs} workerName={workerName} />
      </Section>
    </>
  );
}

function FeedRow({ item }: { item: ActivityItem }) {
  const actor = item.actorType === "USER" && item.actorName ? item.actorName : null;

  return (
    <Row href={item.href ?? undefined}>
      <div className="min-w-0 flex-1">
        <RowTitle className="font-normal">{item.title}</RowTitle>
        {item.detail ? (
          <p className="text-footnote mt-1 line-clamp-2 text-pretty text-muted-foreground">{item.detail}</p>
        ) : null}
        {actor ? <p className="text-footnote mt-1 text-muted-foreground">by {actor}</p> : null}
      </div>
      <span className="text-footnote shrink-0 text-muted-foreground" title={formatDateTime(item.createdAt)}>
        <RelativeTime iso={item.createdAt} />
      </span>
    </Row>
  );
}
