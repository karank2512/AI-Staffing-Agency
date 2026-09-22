import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, toJson } from "@/server/db";
import { runMaintenance, runRetention } from "@/server/maintenance";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";

/**
 * Retention clears debug *payloads* (prompts, tool inputs/outputs) and deletes old event rows, while leaving the
 * metrics on the same rows alone — usage, cost and the run timeline must survive a purge. Everything here is
 * scoped to this test's organization: the test database is shared with other suites.
 */

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

const DAY_MS = 86_400_000;
const NOW = new Date("2026-06-01T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe("ops: retention sweep", () => {
  let t: TestOrg;
  let runId: string;
  let liveRunId: string;

  beforeAll(async () => {
    t = await createTestOrg("ops-retention");
    const hired = await createHiredWorker(t.organization.id);

    const base = {
      organizationId: t.organization.id,
      jobId: hired.job.id,
      workerId: hired.worker.id,
      workerVersionId: hired.version.id,
      trigger: "MANUAL" as const,
      simulated: true,
      input: toJson({ instructions: [], params: {} }),
    };
    runId = (await db.run.create({ data: { ...base, status: "SUCCEEDED", createdAt: daysAgo(100) }, select: { id: true } })).id;
    liveRunId = (await db.run.create({ data: { ...base, status: "RUNNING", createdAt: daysAgo(100) }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await t.cleanup();
  });

  it("clears old model-call payloads but keeps tokens, cost and latency", async () => {
    const old = await db.modelCall.create({
      data: {
        organizationId: t.organization.id,
        runId,
        purpose: "agent.turn",
        provider: "mock",
        model: "mock-standard",
        tier: "standard",
        inputTokens: 1_200,
        outputTokens: 340,
        costUsd: "0.004200",
        latencyMs: 812,
        request: toJson({ messages: [{ role: "user", content: "confidential customer brief" }] }),
        response: toJson({ text: "confidential answer" }),
        createdAt: daysAgo(90),
      },
    });
    const recent = await db.modelCall.create({
      data: {
        organizationId: t.organization.id,
        runId,
        purpose: "agent.turn",
        provider: "mock",
        model: "mock-standard",
        tier: "standard",
        request: toJson({ messages: [] }),
        response: toJson({ text: "fresh" }),
        createdAt: daysAgo(2),
      },
    });

    const result = await runRetention({ now: NOW, organizationId: t.organization.id });
    expect(result.modelCallsCleared).toBe(1);

    const cleared = await db.modelCall.findUniqueOrThrow({ where: { id: old.id } });
    expect(cleared.request).toBeNull();
    expect(cleared.response).toBeNull();
    expect(cleared.inputTokens).toBe(1_200);
    expect(cleared.outputTokens).toBe(340);
    expect(Number(cleared.costUsd)).toBeCloseTo(0.0042, 6);
    expect(cleared.latencyMs).toBe(812);

    expect((await db.modelCall.findUniqueOrThrow({ where: { id: recent.id } })).response).not.toBeNull();

    // Idempotent: a second pass finds nothing left to clear.
    expect((await runRetention({ now: NOW, organizationId: t.organization.id })).modelCallsCleared).toBe(0);
  });

  it("clears step payloads of finished runs only, keeping titles and timings", async () => {
    const finished = await db.runStep.create({
      data: {
        runId,
        index: 1,
        kind: "TOOL_CALL",
        status: "SUCCEEDED",
        title: "Searched the web for “AI infra funding”",
        input: toJson({ query: "customer name" }),
        output: toJson({ results: ["secret"] }),
        startedAt: daysAgo(90),
        durationMs: 1_400,
      },
    });
    const live = await db.runStep.create({
      data: {
        runId: liveRunId,
        index: 1,
        kind: "TOOL_CALL",
        status: "RUNNING",
        title: "Still working",
        input: toJson({ query: "in progress" }),
        startedAt: daysAgo(90),
      },
    });

    const result = await runRetention({ now: NOW, organizationId: t.organization.id });
    expect(result.runStepsCleared).toBe(1);

    const cleared = await db.runStep.findUniqueOrThrow({ where: { id: finished.id } });
    expect(cleared.input).toBeNull();
    expect(cleared.output).toBeNull();
    expect(cleared.title).toBe("Searched the web for “AI infra funding”");
    expect(cleared.durationMs).toBe(1_400);

    // A run that is still executing reads its own steps; never touch them.
    expect((await db.runStep.findUniqueOrThrow({ where: { id: live.id } })).input).not.toBeNull();
  });

  it("deletes activity and security events past the event horizon and keeps recent ones", async () => {
    const oldActivity = await db.activityEvent.create({
      data: { organizationId: t.organization.id, type: "RUN_SUCCEEDED", title: "old", createdAt: daysAgo(400) },
    });
    const recentActivity = await db.activityEvent.create({
      data: { organizationId: t.organization.id, type: "RUN_SUCCEEDED", title: "recent", createdAt: daysAgo(10) },
    });
    const oldSecurity = await db.securityEvent.create({
      data: { organizationId: t.organization.id, type: "SIGN_IN_SUCCEEDED", createdAt: daysAgo(400) },
    });
    const recentSecurity = await db.securityEvent.create({
      data: { organizationId: t.organization.id, type: "SIGN_IN_SUCCEEDED", createdAt: daysAgo(10) },
    });

    const result = await runRetention({ now: NOW, organizationId: t.organization.id });
    expect(result.activityEventsDeleted).toBe(1);
    expect(result.securityEventsDeleted).toBe(1);

    expect(await db.activityEvent.findUnique({ where: { id: oldActivity.id } })).toBeNull();
    expect(await db.activityEvent.findUnique({ where: { id: recentActivity.id } })).not.toBeNull();
    expect(await db.securityEvent.findUnique({ where: { id: oldSecurity.id } })).toBeNull();
    expect(await db.securityEvent.findUnique({ where: { id: recentSecurity.id } })).not.toBeNull();
  });

  it("batches, and reports when a limit stopped the pass early", async () => {
    await db.activityEvent.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        organizationId: t.organization.id,
        type: "NOTE" as const,
        title: `old ${i}`,
        createdAt: daysAgo(400),
      })),
    });

    const first = await runRetention({ now: NOW, organizationId: t.organization.id, batchSize: 2, maxBatches: 2 });
    expect(first.activityEventsDeleted).toBe(4);
    expect(first.truncated).toBe(true);

    const second = await runRetention({ now: NOW, organizationId: t.organization.id, batchSize: 2, maxBatches: 2 });
    expect(second.activityEventsDeleted).toBe(1);
    expect(second.truncated).toBe(false);

    expect(await db.activityEvent.count({ where: { organizationId: t.organization.id, type: "NOTE" } })).toBe(0);
  });

  it("runs every housekeeping step in one pass and reports which ones failed", async () => {
    const result = await runMaintenance({ now: NOW, organizationId: t.organization.id });
    // Maintenance must never be the reason a worker stops claiming runs, so failures are collected, not thrown.
    expect(result.errors).toEqual([]);
    expect(result.retention).not.toBeNull();
    expect(result.rateLimitBucketsDeleted).toBeGreaterThanOrEqual(0);
    expect(result.staleHeartbeatsDeleted).toBeGreaterThanOrEqual(0);
  });
});
