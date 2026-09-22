import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { listActivity } from "@/server/activity";
import { db } from "@/server/db";
import { EvaluationDetailsSchema } from "@/server/domain/evaluation";
import { evaluateRun } from "@/server/evaluation";
import { llm } from "@/server/models";
import { AppError } from "@/server/errors";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { createRun, createRunWithDeliverable, goodRecords, goodReport, poorRecords, poorReport } from "./helpers";

describe("evaluation: evaluateRun", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  beforeAll(async () => {
    t = await createTestOrg("eval-run");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("saves one DETERMINISTIC and one LLM_JUDGE evaluation, refreshes the worker and records activity — idempotently", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const { run, deliverable } = await createRunWithDeliverable(hired, { costUsd: 0.21, durationMs: 62_000 }, { data: goodRecords(), content: goodReport() });

    const first = await evaluateRun(run.id);
    expect(first.deterministic).not.toBeNull();
    expect(first.judge).not.toBeNull();
    expect(first.deterministic?.deliverableId).toBe(deliverable.id);
    expect(first.deterministic?.runId).toBe(run.id);
    expect(first.deterministic?.workerVersionId).toBe(hired.version.id);
    expect(first.deterministic?.passed).toBe(true);
    expect(first.deterministic?.score).toBe(1);
    expect(first.judge?.score).toBeGreaterThanOrEqual(0.82);
    expect(first.judge?.passed).toBe(true);

    // Details follow the domain schemas.
    const det = EvaluationDetailsSchema.parse(first.deterministic?.details);
    expect(det.kind).toBe("deterministic");
    if (det.kind === "deterministic") {
      expect(det.checks.map((c) => c.id)).toEqual(["min_records", "fields", "dupes", "sections"]);
      expect(det.checks.every((c) => c.passed)).toBe(true);
    }
    const judge = EvaluationDetailsSchema.parse(first.judge?.details);
    expect(judge.kind).toBe("llm_judge");
    if (judge.kind === "llm_judge") {
      expect(judge.criteria.map((c) => c.id)).toEqual(["relevance", "insight"]);
      expect(judge.simulated).toBe(true);
      expect(judge.model).toBe("mock-standard");
      for (const c of judge.criteria) expect(c.reasoning.length).toBeGreaterThan(20);
    }

    // The judge call is attributed to the run.
    const calls = await db.modelCall.findMany({ where: { runId: run.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ purpose: "evaluation.judge", tier: "standard", workerId: hired.worker.id, jobId: hired.job.id, simulated: true });

    const second = await evaluateRun(run.id);
    expect(second.deterministic?.id).toBe(first.deterministic?.id);
    expect(second.judge?.id).toBe(first.judge?.id);
    const rows = await db.evaluation.findMany({ where: { deliverableId: deliverable.id } });
    expect(rows.map((r) => r.type).sort()).toEqual(["DETERMINISTIC", "LLM_JUDGE"]);

    const worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.score).toBeGreaterThan(85);
    expect(worker.scoreUpdatedAt).toBeInstanceOf(Date);
    expect(worker.health).toBe("UNKNOWN"); // one finished run is not enough for a verdict

    const events = await listActivity(t.organization.id, { workerId: hired.worker.id, types: ["EVALUATION_COMPLETED"] });
    expect(events).toHaveLength(2);
    expect(events[0].title).toMatch(/^Alex’s report scored \d{1,3}\/100$/);
    expect(events[0]).toMatchObject({ actorType: "SYSTEM", runId: run.id, jobId: hired.job.id, metadata: { deliverableId: deliverable.id } });
  });

  it("scores a poor deliverable visibly lower than a good one (both checks and simulated judge)", async () => {
    const hired = await createHiredWorker(t.organization.id, { collectorTier: "fast", withCleaning: false });
    const good = await createRunWithDeliverable(hired, {}, { data: goodRecords(), content: goodReport() });
    const poor = await createRunWithDeliverable(hired, {}, { data: poorRecords(), content: poorReport() });

    const [g, p] = await Promise.all([evaluateRun(good.run.id), evaluateRun(poor.run.id)]);
    expect(g.judge?.score).toBeGreaterThanOrEqual(0.82);
    expect(p.judge?.score).toBeLessThanOrEqual(0.65);
    expect((g.judge?.score ?? 0) - (p.judge?.score ?? 0)).toBeGreaterThanOrEqual(0.2);
    // Partial credit keeps the checks score continuous: 7/8 records, 82% fields, 1 duplicate, 1 of 2 sections.
    expect(p.deterministic?.score).toBeCloseTo((0.875 * 2 + (23 / 28) * 2 + 6 / 7 + 0.5) / 6, 3);
    expect(p.deterministic?.score).toBeLessThan(g.deterministic?.score ?? 0);

    const details = EvaluationDetailsSchema.parse(p.judge?.details);
    if (details.kind === "llm_judge") {
      const text = details.criteria.map((c) => c.reasoning).join(" ");
      expect(text).toMatch(/duplicate/i);
      expect(text).toMatch(/required field/i);
      expect(details.overallReasoning).toMatch(/Main issue:/);
    }

    // Deterministic on the same content (mock judge is a pure function of the deliverable).
    const again = await evaluateRun(poor.run.id);
    expect(again.judge?.score).toBe(p.judge?.score);
  });

  it("returns nulls for a run without a deliverable and NOT_FOUND for an unknown run", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const run = await createRun(hired, { status: "FAILED", error: "boom" });
    expect(await evaluateRun(run.id)).toEqual({ deterministic: null, judge: null });
    expect(await db.evaluation.count({ where: { runId: run.id } })).toBe(0);
    await expect(evaluateRun("run_does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps the deterministic result when the judge fails", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const { run, deliverable } = await createRunWithDeliverable(hired, {}, { data: goodRecords(), content: goodReport() });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(llm, "generateObject").mockRejectedValueOnce(new AppError("MODEL_ERROR", "provider down"));

    const result = await evaluateRun(run.id);
    expect(result.deterministic).not.toBeNull();
    expect(result.judge).toBeNull();
    expect(await db.evaluation.findMany({ where: { deliverableId: deliverable.id } })).toHaveLength(1);

    const [event] = await listActivity(t.organization.id, { workerId: hired.worker.id, types: ["EVALUATION_COMPLETED"] });
    expect(event.detail).toContain("Reviewer unavailable");

    // A later retry fills in the judge without duplicating the checks row.
    const retry = await evaluateRun(run.id);
    expect(retry.judge).not.toBeNull();
    expect(await db.evaluation.count({ where: { deliverableId: deliverable.id } })).toBe(2);
  });

  it("handles CSV deliverables without records and JSON deliverables whose data is the records array", async () => {
    const hired = await createHiredWorker(t.organization.id, {
      overrides: { deliverable: { titleTemplate: "Export", format: "csv", contentKey: "report" } },
    });
    const csv = await createRunWithDeliverable(hired, {}, { format: "CSV", content: "company,stage\nVectorline Systems,Series B\n" });
    const r = await evaluateRun(csv.run.id);
    const det = EvaluationDetailsSchema.parse(r.deterministic?.details);
    if (det.kind === "deterministic") {
      expect(det.checks.find((c) => c.type === "min_records")?.observed).toBe("no structured records");
    }
    expect(r.judge).not.toBeNull();

    const json = await createRunWithDeliverable(hired, {}, { format: "JSON", content: JSON.stringify(goodRecords()), data: goodRecords() });
    const j = await evaluateRun(json.run.id);
    expect(j.deterministic?.score).toBeGreaterThan(0.7);
    const events = await listActivity(t.organization.id, { workerId: hired.worker.id, types: ["EVALUATION_COMPLETED"] });
    expect(events.map((e) => e.title.split(" scored")[0]).sort()).toEqual(["Alex’s CSV export", "Alex’s JSON export"]);
  });
});
