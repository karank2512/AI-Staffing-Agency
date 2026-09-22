import type { WorkerVersion } from "@prisma/client";
import { db } from "@/server/db";
import { computeWorkerScore, getWorkerMetrics } from "@/server/evaluation";
import { notFound } from "@/server/errors";
import { diffBlueprints } from "./diff";
import { loadWorker, parseStoredAnalysis, parseStoredBlueprint } from "./shared";
import type { VersionComparison, VersionSummary } from "./types";

/**
 * Read models for the Versions tab and the compare page. A summary carries the version's OWN track record
 * (score and metrics scoped to that version), which is what makes "was the replacement better?" answerable.
 */

/** A version's record is its whole life, not the last month: an old version would otherwise look empty. */
const SUMMARY_WINDOW_DAYS = 365;

interface RunCounts {
  total: number;
  finished: number;
}

async function runCountsByVersion(organizationId: string, workerId: string): Promise<Map<string, RunCounts>> {
  const groups = await db.run.groupBy({
    by: ["workerVersionId", "status"],
    where: { organizationId, workerId },
    _count: { _all: true },
  });
  const counts = new Map<string, RunCounts>();
  for (const g of groups) {
    const entry = counts.get(g.workerVersionId) ?? { total: 0, finished: 0 };
    entry.total += g._count._all;
    if (g.status === "SUCCEEDED" || g.status === "FAILED") entry.finished += g._count._all;
    counts.set(g.workerVersionId, entry);
  }
  return counts;
}

async function summarize(organizationId: string, row: WorkerVersion, counts: RunCounts): Promise<VersionSummary> {
  const [score, metrics] = await Promise.all([
    computeWorkerScore(row.workerId, { workerVersionId: row.id }),
    counts.finished > 0
      ? getWorkerMetrics(organizationId, row.workerId, { workerVersionId: row.id, windowDays: SUMMARY_WINDOW_DAYS })
      : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    changeReason: row.changeReason,
    changeSummary: row.changeSummary,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    locked: row.lockedAt !== null,
    blueprint: parseStoredBlueprint(row.blueprint),
    runCount: counts.total,
    score,
    metrics,
  };
}

export async function listVersions(organizationId: string, workerId: string): Promise<VersionSummary[]> {
  const worker = await loadWorker(organizationId, workerId);
  const [rows, counts] = await Promise.all([
    db.workerVersion.findMany({ where: { workerId: worker.id }, orderBy: { version: "desc" } }),
    runCountsByVersion(organizationId, worker.id),
  ]);
  const summaries: VersionSummary[] = [];
  for (const row of rows) summaries.push(await summarize(organizationId, row, counts.get(row.id) ?? { total: 0, finished: 0 }));
  return summaries;
}

export async function getVersionComparison(organizationId: string, versionId: string, againstVersionId?: string): Promise<VersionComparison> {
  const target = await db.workerVersion.findFirst({
    where: { id: versionId, worker: { organizationId } },
    include: { worker: { select: { id: true, name: true, title: true, avatarColor: true } } },
  });
  if (!target) throw notFound("Worker version");

  const baseId = againstVersionId ?? target.parentVersionId;
  const base = baseId ? await db.workerVersion.findFirst({ where: { id: baseId, workerId: target.workerId } }) : null;
  if (baseId && !base) throw notFound("Worker version");

  const counts = await runCountsByVersion(organizationId, target.workerId);
  const empty: RunCounts = { total: 0, finished: 0 };
  const targetSummary = await summarize(organizationId, target, counts.get(target.id) ?? empty);
  const baseSummary = base ? await summarize(organizationId, base, counts.get(base.id) ?? empty) : null;

  return {
    worker: target.worker,
    base: baseSummary,
    target: targetSummary,
    diff: baseSummary ? diffBlueprints(baseSummary.blueprint, targetSummary.blueprint) : { entries: [] },
    analysis: target.changeReason === "REPLACEMENT" ? parseStoredAnalysis(target.analysis) : null,
    canDecide: target.status === "PROPOSED",
  };
}
