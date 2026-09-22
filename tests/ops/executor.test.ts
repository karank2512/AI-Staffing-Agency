import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, toJson } from "@/server/db";
import { startExecutor, stopExecutor } from "@/server/runtime/executor";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";

/**
 * Shutdown behaviour is the reason this suite exists (audit OPS-02): a deploy must not cost an in-flight run one
 * of its two attempts. The queue and scheduler are wrapped so the loop only ever touches this test's
 * organization — the test database is shared with other suites, and a real executor claims anything QUEUED.
 */

const shared = vi.hoisted(() => ({
  organizationId: "",
  /** Resolves the mocked run at the end of the suite so no promise is left hanging. */
  release: undefined as undefined | (() => void),
}));

vi.mock("@/server/runtime/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/runtime/queue")>();
  return {
    ...actual,
    claimNextRun: (executorId: string) => actual.claimNextRun(executorId, { organizationId: shared.organizationId }),
    recoverStaleRuns: () => actual.recoverStaleRuns({ organizationId: shared.organizationId }),
  };
});

vi.mock("@/server/runtime/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/runtime/scheduler")>();
  return { ...actual, tickScheduler: (now?: Date) => actual.tickScheduler(now ?? new Date(), { organizationId: shared.organizationId }) };
});

// A run that never finishes on its own: exactly the case a container shutdown has to handle well.
vi.mock("@/server/runtime/run", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/runtime/run")>();
  return {
    ...actual,
    executeRun: () =>
      new Promise((resolve) => {
        shared.release = () => resolve({ status: "CANCELLED" as const });
      }),
  };
});

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

async function waitFor<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("ops: executor lifecycle", () => {
  let t: TestOrg;
  let runId: string;
  let executorId: string;

  beforeAll(async () => {
    process.env.EXECUTOR_POLL_MS = "50";
    t = await createTestOrg("ops-executor");
    shared.organizationId = t.organization.id;
    const hired = await createHiredWorker(t.organization.id);
    // Written straight to the queue rather than through enqueueRun: this suite is about the executor loop, and a
    // hand-written row keeps it independent of the enqueue path's own quota checks.
    runId = (
      await db.run.create({
        data: {
          organizationId: t.organization.id,
          jobId: hired.job.id,
          workerId: hired.worker.id,
          workerVersionId: hired.version.id,
          status: "QUEUED",
          trigger: "MANUAL",
          simulated: true,
          input: toJson({ instructions: [], params: {} }),
        },
        select: { id: true },
      })
    ).id;
    startExecutor();

    const claimed = await waitFor("the run to be claimed", async () => {
      const run = await db.run.findUniqueOrThrow({ where: { id: runId }, select: { status: true, lockedBy: true, attempt: true } });
      return run.status === "RUNNING" && run.lockedBy ? run : null;
    });
    executorId = claimed.lockedBy as string;
    expect(claimed.attempt).toBe(1);
  });

  afterAll(async () => {
    shared.release?.();
    await stopExecutor({ graceMs: 0 });
    await db.executorHeartbeat.deleteMany({ where: { executorId } });
    await t.cleanup();
    delete process.env.EXECUTOR_POLL_MS;
  });

  it("publishes a heartbeat row naming the host and what it is carrying", async () => {
    const beat = await waitFor("the executor heartbeat", () => db.executorHeartbeat.findUnique({ where: { executorId } }));
    expect(beat.hostname.length).toBeGreaterThan(0);
    expect(beat.inFlight).toBeGreaterThanOrEqual(0);
    expect(beat.seenAt.getTime()).toBeGreaterThanOrEqual(beat.startedAt.getTime() - 1_000);

    const refreshed = await waitFor("a refreshed heartbeat", async () => {
      const row = await db.executorHeartbeat.findUniqueOrThrow({ where: { executorId } });
      return row.inFlight === 1 ? row : null;
    });
    expect(refreshed.inFlight).toBe(1);
  });

  it("hands the lease back on shutdown without burning an attempt, and clears its heartbeat", async () => {
    await stopExecutor({ graceMs: 50 });

    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("QUEUED");
    // The whole point: the next executor gets a fresh go at it, not the run's last attempt.
    expect(run.attempt).toBe(1);
    expect(run.lockedBy).toBeNull();
    expect(run.lockedAt).toBeNull();
    expect(run.heartbeatAt).toBeNull();
    expect(run.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

    expect(await db.executorHeartbeat.findUnique({ where: { executorId } })).toBeNull();
  });

  it("is safe to stop twice and when no executor is running", async () => {
    await expect(stopExecutor({ graceMs: 0 })).resolves.toBeUndefined();
    await expect(stopExecutor()).resolves.toBeUndefined();
  });
});
