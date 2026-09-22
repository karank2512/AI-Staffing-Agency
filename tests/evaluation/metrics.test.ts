import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, toJson } from "@/server/db";
import { ReviewMetricsSchema } from "@/server/domain/evaluation";
import { getWorkerMetrics } from "@/server/evaluation";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { createRun, createRunWithDeliverable, goodRecords, goodReport, poorRecords, poorReport, type Hired } from "./helpers";

async function addEvaluations(hired: Hired, runId: string, deliverableId: string, det: number, judge: number) {
  const base = { organizationId: hired.worker.organizationId, workerId: hired.worker.id, workerVersionId: hired.version.id, runId, deliverableId };
  await db.evaluation.create({ data: { ...base, type: "DETERMINISTIC", score: det, passed: det >= 0.7 } });
  await db.evaluation.create({ data: { ...base, type: "LLM_JUDGE", score: judge, passed: judge >= 0.7 } });
}

describe("evaluation: getWorkerMetrics", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  beforeAll(async () => {
    t = await createTestOrg("eval-metrics");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("returns empty metrics with null rates (never NaN) for a worker without runs, and KPI rows with actual null", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const m = await getWorkerMetrics(t.organization.id, hired.worker.id);
    expect(ReviewMetricsSchema.parse(m)).toEqual(m);
    expect(m).toMatchObject({
      windowDays: 30,
      runs: 0,
      succeeded: 0,
      failed: 0,
      successRate: null,
      deliverables: 0,
      accepted: 0,
      rejected: 0,
      acceptanceRate: null,
      avgJudgeScore: null,
      avgDeterministicScore: null,
      avgRecordsPerRun: null,
      avgCostPerRunUsd: null,
      avgDurationSec: null,
      totalCostUsd: 0,
      scoreTrend: [],
    });
    expect(m.kpis.map((k) => k.kpiId)).toEqual(["acceptance", "coverage", "cost"]);
    expect(m.kpis.every((k) => k.actual === null && k.met === null)).toBe(true);
  });

  it("computes rates, averages, KPI actuals (met per direction) and a chronological score trend", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const now = Date.now();
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);

    // Run 1: good, accepted. Run 2: poor, rejected. Run 3: failed (no deliverable). Run 4: pending review.
    const r1 = await createRunWithDeliverable(hired, { finishedAt: at(40), costUsd: 0.4, durationMs: 60_000 }, { data: goodRecords(), content: goodReport(), status: "ACCEPTED" });
    await addEvaluations(hired, r1.run.id, r1.deliverable.id, 1, 0.9);
    const r2 = await createRunWithDeliverable(hired, { finishedAt: at(30), costUsd: 0.2, durationMs: 30_000 }, { data: poorRecords(), content: poorReport(), status: "REJECTED", feedback: "Too many gaps" });
    await addEvaluations(hired, r2.run.id, r2.deliverable.id, 0.5, 0.5);
    const r3 = await createRun(hired, { status: "FAILED", finishedAt: at(20), costUsd: 0.6, durationMs: 90_000, error: "Run exceeded the cost limit" });
    const r4 = await createRunWithDeliverable(hired, { finishedAt: at(10), costUsd: 0.4, durationMs: null }, { data: goodRecords(8), content: goodReport(goodRecords(8)) });
    await addEvaluations(hired, r4.run.id, r4.deliverable.id, 0.9, 0.8);
    // Outside the window / not finished: ignored.
    await createRunWithDeliverable(hired, { finishedAt: new Date(now - 40 * 86_400_000), costUsd: 9 }, { status: "REJECTED" });
    await createRun(hired, { status: "CANCELLED", costUsd: 5 });
    await createRun(hired, { status: "RUNNING", finishedAt: null, costUsd: 5 });

    const m = await getWorkerMetrics(t.organization.id, hired.worker.id);
    expect(ReviewMetricsSchema.parse(m)).toEqual(m);
    expect(m).toMatchObject({ runs: 4, succeeded: 3, failed: 1, successRate: 0.75, deliverables: 3, accepted: 1, rejected: 1, acceptanceRate: 0.5 });
    expect(m.avgJudgeScore).toBeCloseTo((0.9 + 0.5 + 0.8) / 3, 4);
    expect(m.avgDeterministicScore).toBeCloseTo((1 + 0.5 + 0.9) / 3, 4);
    expect(m.avgRecordsPerRun).toBeCloseTo((10 + 7 + 8) / 3, 1);
    expect(m.avgCostPerRunUsd).toBeCloseTo((0.4 + 0.2 + 0.6 + 0.4) / 4, 4);
    expect(m.totalCostUsd).toBeCloseTo(1.6, 4);
    expect(m.avgDurationSec).toBeCloseTo((60 + 30 + 90) / 3, 1); // null durations are skipped

    const byId = new Map(m.kpis.map((k) => [k.kpiId, k]));
    expect(byId.get("acceptance")).toMatchObject({ metric: "acceptance_rate", target: 0.9, actual: 0.5, met: false, direction: "higher_is_better", unit: "%" });
    expect(byId.get("coverage")).toMatchObject({ metric: "records_per_run", target: 10, actual: 8.3, met: false });
    expect(byId.get("cost")).toMatchObject({ metric: "cost_per_run_usd", target: 0.5, actual: 0.4, met: true, direction: "lower_is_better" });

    // Trend: chronological, ISO timestamps, FAILED run scored 0, SUCCEEDED runs blended with the version weights.
    expect(m.scoreTrend.map((p) => p.runId)).toEqual([r1.run.id, r2.run.id, r3.id, r4.run.id]);
    expect(m.scoreTrend.map((p) => p.score)).toEqual([
      Math.round(((1 * 0.3 + 0.9 * 0.4) / 0.7) * 1000) / 10,
      Math.round(((0.5 * 0.3 + 0.5 * 0.4) / 0.7) * 1000) / 10,
      0,
      Math.round(((0.9 * 0.3 + 0.8 * 0.4) / 0.7) * 1000) / 10,
    ]);
    for (const p of m.scoreTrend) expect(new Date(p.at).toISOString()).toBe(p.at);
    expect([...m.scoreTrend.map((p) => p.at)].sort()).toEqual(m.scoreTrend.map((p) => p.at));
  });

  it("honours windowDays, scopes to a given version, and is org-scoped", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const now = Date.now();
    await createRunWithDeliverable(hired, { finishedAt: new Date(now - 2 * 86_400_000) }, { status: "ACCEPTED" });
    await createRunWithDeliverable(hired, { finishedAt: new Date(now - 10 * 86_400_000) }, { status: "ACCEPTED" });

    expect((await getWorkerMetrics(t.organization.id, hired.worker.id, { windowDays: 7 })).runs).toBe(1);
    expect((await getWorkerMetrics(t.organization.id, hired.worker.id, { windowDays: 30 })).runs).toBe(2);
    expect((await getWorkerMetrics(t.organization.id, hired.worker.id, { windowDays: 0 })).windowDays).toBe(1);

    const v2 = await db.workerVersion.create({
      data: { workerId: hired.worker.id, jobSpecId: hired.jobSpec.id, version: 2, status: "PROPOSED", blueprint: toJson(hired.blueprint) },
    });
    await createRun(hired, { status: "SUCCEEDED", workerVersionId: v2.id });
    const forV2 = await getWorkerMetrics(t.organization.id, hired.worker.id, { workerVersionId: v2.id });
    expect(forV2.runs).toBe(1);
    expect(forV2.deliverables).toBe(0);
    expect((await getWorkerMetrics(t.organization.id, hired.worker.id)).runs).toBe(2); // current version only

    await expect(getWorkerMetrics("org_other", hired.worker.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getWorkerMetrics(t.organization.id, hired.worker.id, { workerVersionId: "ver_missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
