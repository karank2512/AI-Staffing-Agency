import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, toJson } from "@/server/db";
import { HEALTH_THRESHOLDS } from "@/server/domain/evaluation";
import { assessHealth, combineScores, computeWorkerScore, refreshWorkerHealth, refreshWorkerScore, runScore } from "@/server/evaluation";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { createRun, createRunWithDeliverable, goodRecords, goodReport, type Hired } from "./helpers";

const W = { deterministic: 0.3, judge: 0.4, user: 0.3 };

describe("evaluation: combineScores (pure)", () => {
  it("blends the per-source means with the given weights", () => {
    const s = combineScores({ deterministic: [0.8, 1], judge: [0.7], user: [1, 0] }, W, 2);
    expect(s.components).toEqual({ deterministic: 0.9, judge: 0.7, user: 0.5 });
    expect(s.weightsUsed).toEqual(W);
    expect(s.score).toBeCloseTo((0.9 * 0.3 + 0.7 * 0.4 + 0.5 * 0.3) * 100, 1); // 70
    expect(s.sampleSize).toEqual({ deterministic: 2, judge: 1, user: 2, runs: 2 });
  });

  it("re-normalizes the weights over the sources that have data", () => {
    const s = combineScores({ deterministic: [0.5], judge: [1], user: [] }, W);
    expect(s.components.user).toBeNull();
    expect(s.weightsUsed.deterministic).toBeCloseTo(0.3 / 0.7, 6);
    expect(s.weightsUsed.judge).toBeCloseTo(0.4 / 0.7, 6);
    expect(s.weightsUsed.user).toBe(0);
    expect(s.score).toBeCloseTo(((0.5 * 0.3 + 1 * 0.4) / 0.7) * 100, 1); // ≈ 78.6

    const only = combineScores({ deterministic: [], judge: [], user: [1, 1, 0] }, W);
    expect(only.weightsUsed).toEqual({ deterministic: 0, judge: 0, user: 1 });
    expect(only.score).toBeCloseTo(66.7, 1);
  });

  it("never returns NaN: no data, zero weights, or non-finite inputs → null / ignored", () => {
    const empty = combineScores({ deterministic: [], judge: [], user: [] }, W, 0);
    expect(empty.score).toBeNull();
    expect(empty.components).toEqual({ deterministic: null, judge: null, user: null });
    expect(empty.weightsUsed).toEqual({ deterministic: 0, judge: 0, user: 0 });

    const zeroWeights = combineScores({ deterministic: [1], judge: [1], user: [] }, { deterministic: 0, judge: 0, user: 1 });
    expect(zeroWeights.score).toBeNull();
    expect(zeroWeights.components.deterministic).toBe(1);

    const garbage = combineScores({ deterministic: [Number.NaN, 0.5], judge: [Number.POSITIVE_INFINITY], user: [] }, W);
    expect(garbage.components.deterministic).toBe(0.5);
    expect(garbage.components.judge).toBeNull();
    expect(Number.isNaN(garbage.score)).toBe(false);
    expect(garbage.score).toBe(50);

    const clamped = combineScores({ deterministic: [1.4], judge: [-2], user: [] }, W);
    expect(clamped.components.deterministic).toBe(1);
    expect(clamped.components.judge).toBe(0);
  });

  it("runScore: SUCCEEDED blends evaluations, FAILED is 0, anything else is excluded", () => {
    expect(runScore("SUCCEEDED", [{ type: "DETERMINISTIC", score: 0.8 }, { type: "LLM_JUDGE", score: 0.9 }], W)).toBeCloseTo(
      ((0.8 * 0.3 + 0.9 * 0.4) / 0.7) * 100,
      1,
    );
    expect(runScore("SUCCEEDED", [], W)).toBeNull();
    expect(runScore("FAILED", [{ type: "LLM_JUDGE", score: 1 }], W)).toBe(0);
    expect(runScore("CANCELLED", [], W)).toBeNull();
    expect(runScore("RUNNING", [], W)).toBeNull();
  });

  it("assessHealth follows HEALTH_THRESHOLDS with human-readable reasons", () => {
    expect(assessHealth({ score: 20, recentStatuses: ["FAILED"] })).toEqual({ health: "UNKNOWN", reason: null });
    expect(assessHealth({ score: 90, recentStatuses: ["SUCCEEDED", "SUCCEEDED"] })).toEqual({ health: "HEALTHY", reason: null });
    expect(assessHealth({ score: null, recentStatuses: ["SUCCEEDED", "SUCCEEDED"] })).toEqual({ health: "HEALTHY", reason: null });
    expect(assessHealth({ score: 58.4, recentStatuses: ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"] })).toEqual({
      health: "NEEDS_ATTENTION",
      reason: "Quality score 58 is below the 65 threshold",
    });
    expect(assessHealth({ score: 90, recentStatuses: ["FAILED", "SUCCEEDED", "FAILED", "SUCCEEDED", "FAILED", "FAILED", "FAILED"] })).toEqual({
      health: "NEEDS_ATTENTION",
      reason: "3 of the last 5 runs failed",
    });
    expect(assessHealth({ score: 64.9, recentStatuses: ["FAILED", "FAILED", "SUCCEEDED"] }).reason).toBe(
      "Quality score 64 is below the 65 threshold and 2 of the last 3 runs failed",
    );
  });
});

describe("evaluation: computeWorkerScore / refreshWorkerScore / refreshWorkerHealth", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  beforeAll(async () => {
    t = await createTestOrg("eval-score");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  async function evaluated(hired: Hired, scores: { det: number; judge?: number; user?: number }, at: Date) {
    const { run, deliverable } = await createRunWithDeliverable(hired, { finishedAt: at }, { data: goodRecords(), content: goodReport() });
    const base = { organizationId: hired.worker.organizationId, workerId: hired.worker.id, workerVersionId: hired.version.id, runId: run.id, deliverableId: deliverable.id };
    await db.evaluation.create({ data: { ...base, type: "DETERMINISTIC", score: scores.det, passed: scores.det >= 0.7 } });
    if (scores.judge !== undefined) await db.evaluation.create({ data: { ...base, type: "LLM_JUDGE", score: scores.judge, passed: scores.judge >= 0.7 } });
    if (scores.user !== undefined) await db.evaluation.create({ data: { ...base, type: "USER_FEEDBACK", score: scores.user, passed: scores.user === 1 } });
    return run;
  }

  it("a fresh worker has no score and stays UNKNOWN", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const score = await refreshWorkerScore(hired.worker.id);
    expect(score.score).toBeNull();
    expect(score.sampleSize.runs).toBe(0);
    const worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.score).toBeNull();
    expect(worker.scoreUpdatedAt).toBeInstanceOf(Date);
    expect(worker.health).toBe("UNKNOWN");
    expect(worker.healthReason).toBeNull();
  });

  it("FAILED runs contribute a 0 to the deterministic component and flip health to NEEDS_ATTENTION with a reason", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const now = Date.now();
    await evaluated(hired, { det: 0.9, judge: 0.8 }, new Date(now - 5 * 60_000));
    await evaluated(hired, { det: 1, judge: 0.8 }, new Date(now - 4 * 60_000));

    const healthy = await refreshWorkerScore(hired.worker.id);
    expect(healthy.score).toBeCloseTo(((0.95 * 0.3 + 0.8 * 0.4) / 0.7) * 100, 0); // ≈ 86
    expect(healthy.sampleSize).toEqual({ deterministic: 2, judge: 2, user: 0, runs: 2 });
    let worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.health).toBe("HEALTHY");
    expect(worker.score).toBe(healthy.score);

    await createRun(hired, { status: "FAILED", finishedAt: new Date(now - 3 * 60_000), error: "Run exceeded the cost limit" });
    await createRun(hired, { status: "FAILED", finishedAt: new Date(now - 2 * 60_000), error: "Run exceeded the cost limit" });
    await createRun(hired, { status: "FAILED", finishedAt: new Date(now - 1 * 60_000), error: "Run exceeded the cost limit" });
    // Cancelled and unfinished runs never count.
    await createRun(hired, { status: "CANCELLED", finishedAt: new Date(now) });
    await createRun(hired, { status: "RUNNING", finishedAt: null });

    const dragged = await refreshWorkerScore(hired.worker.id);
    expect(dragged.sampleSize.runs).toBe(5);
    expect(dragged.sampleSize.deterministic).toBe(5); // 2 evaluations + 3 zeros
    expect(dragged.components.deterministic).toBeCloseTo((0.9 + 1) / 5, 5);
    expect(dragged.score).toBeCloseTo(((0.38 * 0.3 + 0.8 * 0.4) / 0.7) * 100, 0); // ≈ 62
    expect(dragged.score).toBeLessThan(healthy.score ?? 0);
    expect(dragged.score).toBeLessThan(HEALTH_THRESHOLDS.minScore);

    worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.health).toBe("NEEDS_ATTENTION");
    expect(worker.healthReason).toBe(`Quality score ${Math.floor(dragged.score ?? 0)} is below the 65 threshold and 3 of the last 5 runs failed`);
  });

  it("uses the last N finished runs of the requested version and the version's weights", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const now = Date.now();
    for (let i = 0; i < 12; i++) await evaluated(hired, { det: i < 2 ? 0 : 1, judge: 1 }, new Date(now - (12 - i) * 60_000));

    const last10 = await computeWorkerScore(hired.worker.id);
    expect(last10.sampleSize.runs).toBe(10);
    expect(last10.components.deterministic).toBe(1); // the two zeros are older than the window
    expect(last10.score).toBe(100);

    const all = await computeWorkerScore(hired.worker.id, { lastNRuns: 12 });
    expect(all.sampleSize.runs).toBe(12);
    expect(all.components.deterministic).toBeCloseTo(10 / 12, 5);

    // Another (proposed) version has no runs → no data.
    const v2 = await db.workerVersion.create({
      data: { workerId: hired.worker.id, jobSpecId: hired.jobSpec.id, version: 2, status: "PROPOSED", blueprint: toJson(hired.blueprint) },
    });
    const other = await computeWorkerScore(hired.worker.id, { workerVersionId: v2.id });
    expect(other.score).toBeNull();
    expect(other.sampleSize.runs).toBe(0);
  });

  it("user feedback joins the blend with re-normalized weights", async () => {
    const hired = await createHiredWorker(t.organization.id);
    await evaluated(hired, { det: 1, judge: 1, user: 0 }, new Date());
    const score = await computeWorkerScore(hired.worker.id);
    expect(score.components).toEqual({ deterministic: 1, judge: 1, user: 0 });
    expect(score.weightsUsed).toEqual({ deterministic: 0.3, judge: 0.4, user: 0.3 });
    expect(score.score).toBe(70);
  });

  it("refreshWorkerHealth never touches RETIRED workers", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const now = Date.now();
    await createRun(hired, { status: "FAILED", finishedAt: new Date(now - 2000) });
    await createRun(hired, { status: "FAILED", finishedAt: new Date(now - 1000) });
    await db.worker.update({ where: { id: hired.worker.id }, data: { status: "RETIRED", retiredAt: new Date(), health: "HEALTHY", healthReason: null } });

    await refreshWorkerHealth(hired.worker.id);
    const worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.health).toBe("HEALTHY");
    expect(worker.healthReason).toBeNull();

    await db.worker.update({ where: { id: hired.worker.id }, data: { status: "ACTIVE" } });
    await refreshWorkerHealth(hired.worker.id);
    expect((await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } })).healthReason).toBe("2 of the last 2 runs failed");
  });

  it("throws NOT_FOUND for an unknown worker", async () => {
    await expect(computeWorkerScore("worker_does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
