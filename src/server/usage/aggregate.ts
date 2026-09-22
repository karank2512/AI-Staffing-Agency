import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

/**
 * Shared SQL-side aggregation for the usage ledger (audit INF-18). A busy workspace can have hundreds of
 * thousands of UsageRecord rows in a 90-day window; nothing here ever loads them into JS.
 *
 * Day buckets are SERVER-LOCAL calendar days, the same ones `buckets.dayKey` (date-fns) produces, so the two
 * paths agree. `occurredAt` is `timestamp(3)` holding UTC wall-clock, hence the double conversion: read it as
 * UTC, then render it in the server's IANA zone, which is passed explicitly rather than relying on the session
 * time zone (the connection is pinned to UTC).
 */

const serverTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** `sum()` of an empty group is NULL, and Decimal sums arrive as Prisma.Decimal. */
export const num = (value: Prisma.Decimal | number | bigint | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

export interface DayRow {
  day: string;
  kind: "MODEL" | "TOOL";
  costUsd: number;
  billableUsd: number;
}

/** costUsd + billableUsd per local day and kind, for one org (optionally one worker). */
export async function sumByLocalDay(
  organizationId: string,
  range: { from: Date; to: Date },
  opts: { workerId?: string } = {},
): Promise<DayRow[]> {
  const zone = serverTimeZone();
  const workerFilter = opts.workerId ? Prisma.sql`AND "workerId" = ${opts.workerId}` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ day: string; kind: string; cost: Prisma.Decimal | null; billable: Prisma.Decimal | null }>>`
    SELECT to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day,
           "kind"::text AS kind,
           sum("costUsd") AS cost,
           sum("billableUsd") AS billable
    FROM "UsageRecord"
    WHERE "organizationId" = ${organizationId}
      AND "occurredAt" >= ${range.from}
      AND "occurredAt" <= ${range.to}
      ${workerFilter}
    GROUP BY 1, 2`;
  return rows.map((r) => ({
    day: r.day,
    kind: r.kind === "TOOL" ? "TOOL" : "MODEL",
    costUsd: num(r.cost),
    billableUsd: num(r.billable),
  }));
}

/** Distinct runs that spent anything, per worker (`null` = platform usage outside any run). */
export async function countRunsPerWorker(
  organizationId: string,
  range: { from: Date; to: Date },
): Promise<Map<string | null, number>> {
  const rows = await db.$queryRaw<Array<{ workerId: string | null; runs: bigint }>>`
    SELECT "workerId", count(DISTINCT "runId") AS runs
    FROM "UsageRecord"
    WHERE "organizationId" = ${organizationId}
      AND "occurredAt" >= ${range.from}
      AND "occurredAt" <= ${range.to}
      AND "runId" IS NOT NULL
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.workerId, Number(r.runs)]));
}
