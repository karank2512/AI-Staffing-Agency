import { afterAll, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";
import { db } from "@/server/db";
import { EXPECTED_MIGRATIONS, checkReadiness, listLiveExecutors, sweepStaleHeartbeats } from "@/server/maintenance";

/**
 * Probes are what an orchestrator trusts to decide whether to send traffic here, so they are tested by invoking
 * the handlers the way a load balancer would reach them — not by asserting on the helpers underneath.
 */

const HEARTBEAT_ID = "ops-test-heartbeat";

describe("ops: health and readiness probes", () => {
  afterAll(async () => {
    await db.executorHeartbeat.deleteMany({ where: { executorId: HEARTBEAT_ID } });
  });

  it("answers liveness from process state only, uncached", async () => {
    const response = health();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as { status: string; version: string; uptimeS: number };
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.uptimeS).toBeGreaterThanOrEqual(0);
  });

  it("reports ready when the database is reachable and migrated", async () => {
    const response = await ready();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as {
      status: string;
      checks: { database: string; migrations: string };
      executors: { live: number; inFlight: number; lastSeenAt: string | null };
    };
    expect(body.status).toBe("ready");
    expect(body.checks).toEqual({ database: "ok", migrations: "ok" });
    expect(body.executors.live).toBeGreaterThanOrEqual(0);
    // Never leak the reason a check failed (or would fail) to an unauthenticated caller.
    expect(JSON.stringify(body)).not.toContain("postgres");
  });

  it("expects exactly the migrations in prisma/migrations (the manifest is baked in at build)", () => {
    const onDisk = readdirSync(resolve(process.cwd(), "prisma/migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect([...EXPECTED_MIGRATIONS]).toEqual(onDisk);
  });

  it("reports executor liveness as information, never as a readiness failure", async () => {
    const before = await checkReadiness();
    expect(before.ready).toBe(true);

    await db.executorHeartbeat.create({ data: { executorId: HEARTBEAT_ID, hostname: "probe-host", inFlight: 2 } });
    const live = await listLiveExecutors();
    expect(live.some((e) => e.executorId === HEARTBEAT_ID && e.inFlight === 2)).toBe(true);

    const after = await checkReadiness();
    expect(after.ready).toBe(true);
    expect(after.executors.live).toBeGreaterThanOrEqual(1);
  });

  it("sweeps heartbeats left behind by a crashed executor", async () => {
    await db.executorHeartbeat.upsert({
      where: { executorId: HEARTBEAT_ID },
      create: { executorId: HEARTBEAT_ID, hostname: "probe-host", inFlight: 0, seenAt: new Date(Date.now() - 3_600_000) },
      update: { seenAt: new Date(Date.now() - 3_600_000) },
    });

    await sweepStaleHeartbeats();
    expect(await db.executorHeartbeat.findUnique({ where: { executorId: HEARTBEAT_ID } })).toBeNull();
  });
});
