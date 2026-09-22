import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { WorkerBlueprintSchema, safeParseBlueprint } from "@/server/domain/blueprint";
import { computeNextRunAt } from "@/server/domain/schedule";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeBlueprint, makeJobSpec } from "../helpers/fixtures";

describe("foundation fixtures", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const c of cleanups) await c();
  });

  it("builds schema-valid spec + blueprint variants", () => {
    expect(makeJobSpec().title).toBeTruthy();
    for (const opts of [{}, { withNotifier: true }, { withCleaning: false, collectorTier: "fast" as const }]) {
      const bp = makeBlueprint(opts);
      expect(WorkerBlueprintSchema.safeParse(JSON.parse(JSON.stringify(bp))).success).toBe(true);
    }
  });

  it("rejects blueprints with dangling references", () => {
    const bp = makeBlueprint();
    const broken = { ...bp, deliverable: { ...bp.deliverable, contentKey: "nope" } };
    expect(safeParseBlueprint(broken).success).toBe(false);
    const badTool = JSON.parse(JSON.stringify(bp));
    badTool.components[0].tools.push("send_notification");
    expect(safeParseBlueprint(badTool).success).toBe(false);
    const badCheck = JSON.parse(JSON.stringify(bp));
    badCheck.evaluation.deterministicChecks[0].config = { minimum: 3 };
    expect(safeParseBlueprint(badCheck).success).toBe(false);
  });

  it("creates a hired worker and cascades on org delete", async () => {
    const t = await createTestOrg("foundation");
    cleanups.push(t.cleanup);
    const { worker, version } = await createHiredWorker(t.organization.id, { withNotifier: true });
    expect(worker.currentVersionId).toBe(version.id);
    expect(await db.workerToolGrant.count({ where: { workerId: worker.id } })).toBe(4);
    await t.cleanup();
    cleanups.pop();
    expect(await db.worker.count({ where: { id: worker.id } })).toBe(0);
  });

  it("computes next run times in local time, strictly after `from`", () => {
    const from = new Date(2026, 8, 17, 14, 30); // Thu Sep 17 2026 14:30 local
    expect(computeNextRunAt({ kind: "manual" }, from)).toBeNull();
    expect(computeNextRunAt({ kind: "hourly" }, from)).toEqual(new Date(2026, 8, 17, 15, 0));
    expect(computeNextRunAt({ kind: "daily", hour: 9 }, from)).toEqual(new Date(2026, 8, 18, 9, 0));
    expect(computeNextRunAt({ kind: "daily", hour: 16 }, from)).toEqual(new Date(2026, 8, 17, 16, 0));
    expect(computeNextRunAt({ kind: "weekly", hour: 9, dayOfWeek: 1 }, from)).toEqual(new Date(2026, 8, 21, 9, 0));
    expect(computeNextRunAt({ kind: "weekly", hour: 9, dayOfWeek: 4 }, from)).toEqual(new Date(2026, 8, 24, 9, 0));
  });
});
