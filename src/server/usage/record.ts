import { Prisma } from "@prisma/client";
import { config } from "@/server/config";
import { db, type DbOrTx } from "@/server/db";
import { errorMessage } from "@/server/errors";
import { recordRealSpend } from "@/server/security";

export interface RecordUsageInput {
  organizationId: string;
  kind: "MODEL" | "TOOL";
  /** Model provider ("anthropic", "mock") or "tool". */
  provider: string;
  /** Model id or tool name. */
  resource: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Our cost (COGS). */
  costUsd: number;
  simulated: boolean;
  workerId?: string;
  jobId?: string;
  runId?: string;
}

const USD_SCALE = 6; // Decimal(12, 6)

function toTokenCount(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function toCost(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(n) && n > 0 ? n : 0).toDecimalPlaces(USD_SCALE);
}

/**
 * Append one row to the metering ledger and — when the call belongs to a run — roll it up onto the Run.
 *
 * NEVER throws: metering must not be able to fail a model/tool call that already happened.
 * The ledger row, the Run rollup and (for REAL spend) the org's month-to-date counter are written in one
 * transaction so they cannot drift apart, and both rollups use SQL-level increments (this function is the ONLY
 * writer of Run.costUsd/inputTokens/outputTokens), so concurrent calls never lose an update. A missing run is
 * tolerated (updateMany → count 0).
 *
 * Simulated calls cost nothing real, so they never touch OrgSpendMonth: the monthly budget guards the operator's
 * actual provider bill, not the priced-for-realism numbers the demo shows (audit INF-02).
 */
export async function recordUsage(u: RecordUsageInput): Promise<void> {
  try {
    const costUsd = toCost(u.costUsd);
    // Decimal math: 0.1 × 1.4 must be billed as 0.14, not 0.13999999999999999.
    const billableUsd = costUsd.mul(config.usage.marginMultiplier).toDecimalPlaces(USD_SCALE);
    const inputTokens = toTokenCount(u.inputTokens);
    const outputTokens = toTokenCount(u.outputTokens);

    let workerId = u.workerId;
    let jobId = u.jobId;
    if (u.runId && (!workerId || !jobId)) {
      // Callers usually pass both; backfilling keeps per-worker reporting right when they only know the run.
      const run = await db.run.findFirst({
        where: { id: u.runId, organizationId: u.organizationId },
        select: { workerId: true, jobId: true },
      });
      workerId ??= run?.workerId;
      jobId ??= run?.jobId;
    }

    const data = {
      organizationId: u.organizationId,
      kind: u.kind,
      provider: u.provider,
      resource: u.resource,
      inputTokens,
      outputTokens,
      costUsd,
      billableUsd,
      simulated: u.simulated,
      workerId: workerId ?? null,
      jobId: jobId ?? null,
      runId: u.runId ?? null,
    };
    const realSpend = !u.simulated && costUsd.greaterThan(0);
    /** SQL-level increments, so concurrent calls for the same run never lose an update. */
    const rollUpOntoRun = (client: DbOrTx) =>
      client.run.updateMany({
        where: { id: u.runId, organizationId: u.organizationId },
        data: {
          costUsd: { increment: costUsd },
          inputTokens: { increment: inputTokens },
          outputTokens: { increment: outputTokens },
        },
      });

    // Simulated mode is the hot path (every mock call lands here), so it stays on the cheap batch transaction;
    // only REAL spend needs the interactive one that also increments the workspace's month-to-date total.
    if (!realSpend) {
      if (!u.runId) await db.usageRecord.create({ data });
      else await db.$transaction([db.usageRecord.create({ data }), rollUpOntoRun(db)]);
      return;
    }

    await db.$transaction(async (tx) => {
      await tx.usageRecord.create({ data });
      if (u.runId) await rollUpOntoRun(tx);
      // Keeps the budget check O(1): assertWithinBudget reads one OrgSpendMonth row instead of summing a ledger.
      await recordRealSpend(u.organizationId, costUsd.toNumber(), tx);
    });
  } catch (e) {
    console.error(
      `[usage] failed to record ${u.kind} usage (${u.provider}/${u.resource}) for org ${u.organizationId}: ${errorMessage(e)}`,
    );
  }
}
