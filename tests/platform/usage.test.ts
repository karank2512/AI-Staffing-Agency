import { format, subDays } from "date-fns";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db, toJson } from "@/server/db";
import { AppError } from "@/server/errors";
import { getUsageSummary, getWorkerCostSummary, recordUsage } from "@/server/usage";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { captureConsoleError, rejection, withEnv } from "./helpers";

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;
type Hired = Awaited<ReturnType<typeof createHiredWorker>>;

function createRun(orgId: string, hired: Hired, data: { workerVersionId?: string; costUsd?: number; startedAt?: Date | null; createdAt?: Date } = {}) {
  return db.run.create({
    data: {
      organizationId: orgId,
      jobId: hired.job.id,
      workerId: hired.worker.id,
      workerVersionId: data.workerVersionId ?? hired.version.id,
      status: "RUNNING",
      startedAt: data.startedAt === undefined ? new Date() : data.startedAt,
      costUsd: data.costUsd ?? 0,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  });
}

describe("usage: recordUsage", () => {
  let t: TestOrg;
  let other: TestOrg;
  let hired: Hired;
  let otherHired: Hired;
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    t = await createTestOrg("platform-usage");
    other = await createTestOrg("platform-usage-other");
    hired = await createHiredWorker(t.organization.id);
    otherHired = await createHiredWorker(other.organization.id);
  });
  afterEach(() => {
    while (restores.length) restores.pop()?.();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("applies the margin multiplier with decimal (not float) math", async () => {
    restores.push(withEnv({ USAGE_MARGIN_MULTIPLIER: undefined })); // default 1.4
    await recordUsage({
      organizationId: t.organization.id,
      kind: "MODEL",
      provider: "mock",
      resource: "margin-default",
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.1,
      simulated: true,
    });
    const row = await db.usageRecord.findFirstOrThrow({ where: { organizationId: t.organization.id, resource: "margin-default" } });
    expect(row.costUsd.toString()).toBe("0.1");
    expect(row.billableUsd.toString()).toBe("0.14"); // 0.1 * 1.4 === 0.13999999999999999 in floats
    expect(row).toMatchObject({ kind: "MODEL", provider: "mock", inputTokens: 1200, outputTokens: 300, simulated: true, workerId: null, runId: null });

    process.env.USAGE_MARGIN_MULTIPLIER = "2";
    await recordUsage({ organizationId: t.organization.id, kind: "TOOL", provider: "tool", resource: "margin-2x", costUsd: 0.008, simulated: false });
    const tool = await db.usageRecord.findFirstOrThrow({ where: { organizationId: t.organization.id, resource: "margin-2x" } });
    expect(Number(tool.billableUsd)).toBe(0.016);
    expect(tool).toMatchObject({ kind: "TOOL", inputTokens: 0, outputTokens: 0, simulated: false });
  });

  it("never throws — bad org, NaN cost and negative tokens are all tolerated", async () => {
    const errors = captureConsoleError();
    await expect(
      recordUsage({ organizationId: "org_that_does_not_exist", kind: "TOOL", provider: "tool", resource: "web_search", costUsd: 0.01, simulated: true }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);

    await expect(
      recordUsage({ organizationId: t.organization.id, kind: "MODEL", provider: "mock", resource: "garbage-in", costUsd: Number.NaN, inputTokens: -5, outputTokens: 10.6, simulated: true }),
    ).resolves.toBeUndefined();
    const row = await db.usageRecord.findFirstOrThrow({ where: { organizationId: t.organization.id, resource: "garbage-in" } });
    expect(Number(row.costUsd)).toBe(0);
    expect(row.inputTokens).toBe(0);
    expect(row.outputTokens).toBe(11);
  });

  it("atomically rolls usage up onto the run, even under concurrency", async () => {
    const run = await createRun(t.organization.id, hired);
    const base = { organizationId: t.organization.id, workerId: hired.worker.id, jobId: hired.job.id, runId: run.id, simulated: true };

    await Promise.all([
      ...Array.from({ length: 8 }, () =>
        recordUsage({ ...base, kind: "MODEL", provider: "mock", resource: "mock-standard", inputTokens: 1000, outputTokens: 250, costUsd: 0.0125 }),
      ),
      ...Array.from({ length: 4 }, () => recordUsage({ ...base, kind: "TOOL", provider: "tool", resource: "web_search", costUsd: 0.008 })),
    ]);

    const after = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(Number(after.costUsd)).toBe(0.132); // 8 × 0.0125 + 4 × 0.008
    expect(after.inputTokens).toBe(8000);
    expect(after.outputTokens).toBe(2000);
    expect(await db.usageRecord.count({ where: { organizationId: t.organization.id, runId: run.id } })).toBe(12);
  });

  it("tolerates a missing run and still writes the ledger row", async () => {
    await expect(
      recordUsage({ organizationId: t.organization.id, kind: "TOOL", provider: "tool", resource: "missing-run-tool", costUsd: 0.002, simulated: true, runId: "run_that_does_not_exist" }),
    ).resolves.toBeUndefined();
    const row = await db.usageRecord.findFirstOrThrow({ where: { organizationId: t.organization.id, resource: "missing-run-tool" } });
    expect(row.runId).toBe("run_that_does_not_exist");
    expect(row.workerId).toBeNull();
  });

  it("never increments a run that belongs to another organization", async () => {
    const foreignRun = await createRun(other.organization.id, otherHired);
    await recordUsage({ organizationId: t.organization.id, kind: "MODEL", provider: "mock", resource: "cross-org", inputTokens: 500, costUsd: 0.5, simulated: true, runId: foreignRun.id });

    const after = await db.run.findUniqueOrThrow({ where: { id: foreignRun.id } });
    expect(Number(after.costUsd)).toBe(0);
    expect(after.inputTokens).toBe(0);
  });

  it("backfills workerId / jobId from the run when the caller only knows the run", async () => {
    const run = await createRun(t.organization.id, hired);
    await recordUsage({ organizationId: t.organization.id, kind: "TOOL", provider: "tool", resource: "backfill-tool", costUsd: 0.001, simulated: true, runId: run.id });
    const row = await db.usageRecord.findFirstOrThrow({ where: { organizationId: t.organization.id, resource: "backfill-tool" } });
    expect(row.workerId).toBe(hired.worker.id);
    expect(row.jobId).toBe(hired.job.id);
  });
});

describe("usage: getUsageSummary", () => {
  let t: TestOrg;
  let hired: Hired;
  // A fixed past week (local time) keeps the buckets deterministic.
  const from = new Date(2026, 0, 5, 0, 0, 0, 0);
  const to = new Date(2026, 0, 11, 23, 59, 59, 999);

  beforeAll(async () => {
    t = await createTestOrg("platform-usage-summary");
    hired = await createHiredWorker(t.organization.id);
    const org = { organizationId: t.organization.id };
    const alex = { ...org, workerId: hired.worker.id, jobId: hired.job.id };
    await db.usageRecord.createMany({
      data: [
        // Worker, run A — two model calls on the same model + one tool call, either side of local midnight.
        { ...alex, runId: "run_a", kind: "MODEL", provider: "mock", resource: "mock-standard", inputTokens: 1000, outputTokens: 200, costUsd: 0.1, billableUsd: 0.14, simulated: true, occurredAt: new Date(2026, 0, 6, 23, 30) },
        { ...alex, runId: "run_a", kind: "MODEL", provider: "mock", resource: "mock-standard", inputTokens: 2000, outputTokens: 400, costUsd: 0.2, billableUsd: 0.28, simulated: true, occurredAt: new Date(2026, 0, 7, 0, 30) },
        { ...alex, runId: "run_a", kind: "TOOL", provider: "tool", resource: "web_search", costUsd: 0.008, billableUsd: 0.0112, simulated: true, occurredAt: new Date(2026, 0, 7, 0, 31) },
        // Worker, run B — a live model call.
        { ...alex, runId: "run_b", kind: "MODEL", provider: "anthropic", resource: "claude-live", inputTokens: 500, outputTokens: 100, costUsd: 0.05, billableUsd: 0.07, simulated: false, occurredAt: new Date(2026, 0, 9, 12, 0) },
        { ...alex, runId: "run_b", kind: "TOOL", provider: "tool", resource: "web_search", costUsd: 0.008, billableUsd: 0.0112, simulated: false, occurredAt: new Date(2026, 0, 9, 12, 1) },
        { ...alex, runId: "run_b", kind: "TOOL", provider: "tool", resource: "fetch_url", costUsd: 0, billableUsd: 0, simulated: false, occurredAt: new Date(2026, 0, 9, 12, 2) },
        // Platform usage (no worker): scoping call.
        { ...org, kind: "MODEL", provider: "mock", resource: "mock-fast", inputTokens: 300, outputTokens: 50, costUsd: 0.01, billableUsd: 0.014, simulated: true, occurredAt: new Date(2026, 0, 5, 9, 0) },
        // Ledger row whose worker no longer exists.
        { ...org, workerId: "worker_deleted", kind: "TOOL", provider: "tool", resource: "calculator", costUsd: 0.001, billableUsd: 0.0014, simulated: true, occurredAt: new Date(2026, 0, 5, 9, 5) },
        // Outside the range — must be ignored.
        { ...alex, runId: "run_old", kind: "MODEL", provider: "mock", resource: "mock-standard", inputTokens: 9999, outputTokens: 9999, costUsd: 9, billableUsd: 12.6, simulated: true, occurredAt: new Date(2026, 0, 4, 23, 59) },
        { ...alex, runId: "run_new", kind: "MODEL", provider: "mock", resource: "mock-standard", inputTokens: 9999, outputTokens: 9999, costUsd: 9, billableUsd: 12.6, simulated: true, occurredAt: new Date(2026, 0, 12, 0, 0) },
      ],
    });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("returns plain numbers and ISO strings in the contracted shape", async () => {
    const summary = await getUsageSummary(t.organization.id, { from, to });

    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary); // no Decimal / Date anywhere
    expect(summary.from).toBe(from.toISOString());
    expect(summary.to).toBe(to.toISOString());
    expect(summary.totals).toEqual({
      costUsd: 0.377,
      billableUsd: 0.5278,
      simulatedCostUsd: 0.319,
      inputTokens: 3800,
      outputTokens: 750,
      modelCalls: 4,
      toolCalls: 4,
    });
  });

  it("zero-fills every LOCAL calendar day and buckets around midnight correctly", async () => {
    const { byDay } = await getUsageSummary(t.organization.id, { from, to });
    expect(byDay.map((d) => d.date)).toEqual([
      "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11",
    ]);
    expect(byDay[0]).toEqual({ date: "2026-01-05", costUsd: 0.011, billableUsd: 0.0154, modelCostUsd: 0.01, toolCostUsd: 0.001 });
    expect(byDay[1]).toEqual({ date: "2026-01-06", costUsd: 0.1, billableUsd: 0.14, modelCostUsd: 0.1, toolCostUsd: 0 });
    expect(byDay[2]).toEqual({ date: "2026-01-07", costUsd: 0.208, billableUsd: 0.2912, modelCostUsd: 0.2, toolCostUsd: 0.008 });
    expect(byDay[3]).toEqual({ date: "2026-01-08", costUsd: 0, billableUsd: 0, modelCostUsd: 0, toolCostUsd: 0 });
    expect(byDay[4].costUsd).toBe(0.058);
    expect(byDay[6]).toEqual({ date: "2026-01-11", costUsd: 0, billableUsd: 0, modelCostUsd: 0, toolCostUsd: 0 });
  });

  it("groups by worker (with platform + removed workers), model and tool", async () => {
    const summary = await getUsageSummary(t.organization.id, { from, to });

    expect(summary.byWorker).toEqual([
      { workerId: hired.worker.id, workerName: "Alex", avatarColor: "violet", costUsd: 0.366, billableUsd: 0.5124, runs: 2 },
      { workerId: null, workerName: "Platform (scoping, reviews, chat)", avatarColor: null, costUsd: 0.01, billableUsd: 0.014, runs: 0 },
      { workerId: "worker_deleted", workerName: "Former worker", avatarColor: null, costUsd: 0.001, billableUsd: 0.0014, runs: 0 },
    ]);

    expect(summary.byModel).toEqual([
      { provider: "mock", model: "mock-standard", calls: 2, inputTokens: 3000, outputTokens: 600, costUsd: 0.3, simulated: true },
      { provider: "anthropic", model: "claude-live", calls: 1, inputTokens: 500, outputTokens: 100, costUsd: 0.05, simulated: false },
      { provider: "mock", model: "mock-fast", calls: 1, inputTokens: 300, outputTokens: 50, costUsd: 0.01, simulated: true },
    ]);

    expect(summary.byTool).toEqual([
      { toolName: "web_search", calls: 2, costUsd: 0.016 },
      { toolName: "calculator", calls: 1, costUsd: 0.001 },
      { toolName: "fetch_url", calls: 1, costUsd: 0 },
    ]);
  });

  it("is org-scoped and zero-filled for an organization with no usage", async () => {
    const empty = await createTestOrg("platform-usage-empty");
    try {
      const summary = await getUsageSummary(empty.organization.id, { from, to });
      expect(summary.totals).toEqual({ costUsd: 0, billableUsd: 0, simulatedCostUsd: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, toolCalls: 0 });
      expect(summary.byDay).toHaveLength(7);
      expect(summary.byDay.every((d) => d.costUsd === 0)).toBe(true);
      expect(summary.byWorker).toEqual([]);
      expect(summary.byModel).toEqual([]);
      expect(summary.byTool).toEqual([]);
    } finally {
      await empty.cleanup();
    }
  });

  it("rejects an inverted range", async () => {
    const err = await rejection(getUsageSummary(t.organization.id, { from: to, to: from }));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("VALIDATION");
  });
});

describe("usage: getWorkerCostSummary", () => {
  let t: TestOrg;
  let other: TestOrg;
  let hired: Hired;
  let v2Id: string;

  beforeAll(async () => {
    t = await createTestOrg("platform-usage-worker");
    other = await createTestOrg("platform-usage-worker-other");
    hired = await createHiredWorker(t.organization.id);
    const v2 = await db.workerVersion.create({
      data: { workerId: hired.worker.id, jobSpecId: hired.jobSpec.id, version: 2, status: "PROPOSED", blueprint: toJson(hired.blueprint), changeReason: "REPLACEMENT" },
    });
    v2Id = v2.id;

    const now = new Date();
    const runV1a = await createRun(t.organization.id, hired, { costUsd: 0.2 });
    await createRun(t.organization.id, hired, { costUsd: 0.1 });
    await createRun(t.organization.id, hired, { workerVersionId: v2Id, costUsd: 0.06 });
    await createRun(t.organization.id, hired, { startedAt: null }); // still queued → not counted
    await createRun(t.organization.id, hired, { costUsd: 5, createdAt: subDays(now, 40) }); // outside the window

    await db.deliverable.create({
      data: { organizationId: t.organization.id, jobId: hired.job.id, workerId: hired.worker.id, workerVersionId: hired.version.id, runId: runV1a.id, title: "Report", content: "# Report" },
    });

    const usage = { organizationId: t.organization.id, workerId: hired.worker.id, jobId: hired.job.id, simulated: true };
    await db.usageRecord.createMany({
      data: [
        { ...usage, kind: "MODEL", provider: "mock", resource: "mock-standard", costUsd: 0.25, billableUsd: 0.35, occurredAt: now },
        { ...usage, kind: "MODEL", provider: "mock", resource: "mock-standard", costUsd: 0.05, billableUsd: 0.07, occurredAt: subDays(now, 2) },
        { ...usage, kind: "TOOL", provider: "tool", resource: "web_search", costUsd: 0.06, billableUsd: 0.084, occurredAt: subDays(now, 2) },
        { ...usage, kind: "MODEL", provider: "mock", resource: "mock-standard", costUsd: 7, billableUsd: 9.8, occurredAt: subDays(now, 45) }, // outside
        // Same org, no worker → must not leak into the worker summary.
        { organizationId: t.organization.id, kind: "MODEL", provider: "mock", resource: "mock-fast", costUsd: 3, billableUsd: 4.2, simulated: true, occurredAt: now },
      ],
    });
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("returns the contracted shape with a zero-filled window ending today", async () => {
    const summary = await getWorkerCostSummary(t.organization.id, hired.worker.id);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);

    expect(summary.days).toBe(30);
    expect(summary.runs).toBe(3);
    expect(summary.totalCostUsd).toBe(0.36);
    expect(summary.avgCostPerRunUsd).toBe(0.12); // (0.2 + 0.1 + 0.06) / 3 from Run.costUsd
    expect(summary.costPerDeliverableUsd).toBe(0.36);
    expect(summary.estimatedPerRunUsd).toBe(hired.blueprint.costEstimate.perRunUsd);

    expect(summary.byDay).toHaveLength(30);
    const today = format(new Date(), "yyyy-MM-dd");
    expect(summary.byDay[29]).toEqual({ date: today, costUsd: 0.25 });
    expect(summary.byDay[27]).toEqual({ date: format(subDays(new Date(), 2), "yyyy-MM-dd"), costUsd: 0.11 });
    expect(summary.byDay[0]).toEqual({ date: format(subDays(new Date(), 29), "yyyy-MM-dd"), costUsd: 0 });

    expect(summary.byVersion).toEqual([
      { workerVersionId: hired.version.id, version: 1, runs: 2, totalCostUsd: 0.3, avgCostPerRunUsd: 0.15 },
      { workerVersionId: v2Id, version: 2, runs: 1, totalCostUsd: 0.06, avgCostPerRunUsd: 0.06 },
    ]);
    expect(summary.byResource).toEqual([
      { label: "mock-standard", kind: "MODEL", calls: 2, costUsd: 0.3 },
      { label: "web_search", kind: "TOOL", calls: 1, costUsd: 0.06 },
    ]);
  });

  it("honours a custom window", async () => {
    const summary = await getWorkerCostSummary(t.organization.id, hired.worker.id, 1);
    expect(summary.days).toBe(1);
    expect(summary.byDay).toEqual([{ date: format(new Date(), "yyyy-MM-dd"), costUsd: 0.25 }]);
    expect(summary.totalCostUsd).toBe(0.25);

    const wide = await getWorkerCostSummary(t.organization.id, hired.worker.id, 60);
    expect(wide.runs).toBe(4);
    expect(wide.totalCostUsd).toBe(7.36);
  });

  it("returns nulls (never NaN) for a worker without history, and reads the estimate leniently", async () => {
    const fresh = await createHiredWorker(t.organization.id, { name: "Maya" });
    const summary = await getWorkerCostSummary(t.organization.id, fresh.worker.id, 7);
    expect(summary).toMatchObject({ days: 7, runs: 0, totalCostUsd: 0, avgCostPerRunUsd: null, costPerDeliverableUsd: null, estimatedPerRunUsd: 0.18, byVersion: [], byResource: [] });
    expect(summary.byDay).toHaveLength(7);

    // A blueprint from some other schema era must not break the cost page.
    await db.workerVersion.update({ where: { id: fresh.version.id }, data: { blueprint: toJson({ costEstimate: { perRunUsd: "cheap" } }) } });
    expect((await getWorkerCostSummary(t.organization.id, fresh.worker.id, 7)).estimatedPerRunUsd).toBeNull();
  });

  it("throws NOT_FOUND for a worker outside the caller's organization", async () => {
    const err = await rejection(getWorkerCostSummary(other.organization.id, hired.worker.id));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("NOT_FOUND");
  });
});
