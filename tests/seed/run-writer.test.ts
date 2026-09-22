import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { parseBlueprint, parseJobSpec, type BlueprintComponent, type WorkerBlueprint } from "@/server/domain";
import { generatePerformanceReview } from "@/server/evaluation";
import { deliverableSummary, enqueueRun, executeRun } from "@/server/runtime";
// Not on the runtime index; the test only reads checkpoints back.
import { parseCheckpoint } from "@/server/runtime/checkpoint";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeBlueprint, makeJobSpec } from "../helpers/fixtures";
import { assertEvaluatedBefore } from "../../prisma/seed/cast";
import { seedSucceededRun, type SeedEnv } from "../../prisma/seed/runs";
import type { Seat } from "../../prisma/seed/trace";

/**
 * The seed's run writer on blueprints the demo cast does not have: data deliverables (JSON, CSV) must get the
 * runtime's own "In short" summary and be created at the runtime's boundary, and a performance review must never
 * be planned before a run has been evaluated.
 */

type Org = Awaited<ReturnType<typeof createTestOrg>>;

const HOUR_MS = 3_600_000;

function jsonBlueprint(): WorkerBlueprint {
  return makeBlueprint({ overrides: { deliverable: { titleTemplate: "Funding rounds — {{date}}", format: "json", contentKey: "records", dataKey: "records" } } });
}

function csvBlueprint(): WorkerBlueprint {
  const base = makeBlueprint();
  const toCsv: BlueprintComponent = {
    type: "deterministic",
    id: "to_csv",
    name: "Export CSV",
    description: "The ranked rounds as a spreadsheet.",
    operation: "to_csv",
    config: {},
    inputKeys: ["records"],
    outputKey: "csv",
  };
  return makeBlueprint({
    overrides: {
      components: [...base.components.filter((c) => c.id !== "analyst" && c.id !== "compile_report"), toCsv],
      deliverable: { titleTemplate: "Funding rounds — {{date}}", format: "csv", contentKey: "csv", dataKey: "records" },
    },
  });
}

async function hire(org: Org, blueprint: WorkerBlueprint): Promise<Seat> {
  const hired = await createHiredWorker(org.organization.id, { blueprint, spec: makeJobSpec(), userId: org.user.id });
  return {
    organizationId: org.organization.id,
    userId: org.user.id,
    userName: org.user.name,
    workerId: hired.worker.id,
    workerName: hired.worker.name,
    jobId: hired.job.id,
    jobTitle: hired.job.title,
    versionId: hired.version.id,
    blueprint: hired.blueprint,
    spec: hired.spec,
  };
}

/** Recomputes the summary from the stored row, exactly as ensureDeliverable derives it. */
async function expectedSummary(deliverableId: string): Promise<string> {
  const row = await db.deliverable.findUniqueOrThrow({ where: { id: deliverableId }, include: { workerVersion: { include: { jobSpec: true } } } });
  const blueprint = parseBlueprint(row.workerVersion.blueprint);
  const spec = parseJobSpec(row.workerVersion.jobSpec.spec);
  const contentValue = blueprint.deliverable.format === "json" ? (JSON.parse(row.content) as unknown) : row.content;
  const records = Array.isArray(row.data) ? (row.data as Array<Record<string, unknown>>) : null;
  return deliverableSummary({ blueprint, spec, contentValue, content: row.content, records });
}

const shape = (steps: Array<{ kind: string; componentId: string | null; status: string }>) => steps.map((s) => `${s.kind}:${s.componentId ?? "-"}:${s.status}`);

describe("seeded run writer", () => {
  let org: Org;
  let env: SeedEnv;

  beforeAll(async () => {
    org = await createTestOrg("seed-writer");
    env = { db, session: org.session };
  });

  afterAll(async () => {
    await org.cleanup();
  });

  it("gives a JSON deliverable the runtime's records summary, created where a live run creates it", async () => {
    const seat = await hire(org, jsonBlueprint());
    const seeded = await seedSucceededRun(env, seat, { trigger: "MANUAL", queuedAt: new Date(Date.now() - 2 * HOUR_MS), seed: 0 });
    const row = await db.deliverable.findUniqueOrThrow({ where: { id: seeded.deliverableId! } });
    expect(row.format).toBe("JSON");
    expect(row.summary).toBe(await expectedSummary(row.id));
    expect(row.summary).toMatch(/^\d+ funding rounds?, including .+\.$/);

    // Made right after the collector (the first boundary with `records`): its raw output, before the rank step.
    const records = row.data as Array<Record<string, unknown>>;
    expect(records.length).toBeGreaterThan(0);
    expect(records.some((r) => "rank" in r)).toBe(false);
    expect(JSON.parse(row.content)).toEqual(records);
    expect(seeded.records).toEqual(records);

    const { runId } = await enqueueRun({ organizationId: seat.organizationId, workerId: seat.workerId, trigger: "MANUAL", requestedById: seat.userId });
    expect((await executeRun(runId)).status).toBe("SUCCEEDED");
    const live = await db.deliverable.findFirstOrThrow({ where: { runId } });
    expect(live.summary).toMatch(/^\d+ funding rounds?, including .+\.$/);
    // Seed 0 keeps the simulated web's own order, so the same brain (fed the same blueprint hints) finds the same rounds.
    const companies = (rows: unknown) => (rows as Array<Record<string, unknown>>).map((r) => r.company);
    expect(companies(records)).toEqual(companies(live.data));
    const [seededSteps, liveSteps] = await Promise.all([
      db.runStep.findMany({ where: { runId: seeded.runId }, orderBy: { index: "asc" } }),
      db.runStep.findMany({ where: { runId }, orderBy: { index: "asc" } }),
    ]);
    expect(shape(seededSteps)).toEqual(shape(liveSteps));
  });

  it("replays the mock brain with the blueprint hints a live run passes it (same records, same analysis)", async () => {
    // No dedupe step: the analyst counts duplicates by the no_duplicates check's keyFields, which only the hints carry.
    const seat = await hire(org, makeBlueprint({ withCleaning: false, collectorTier: "fast" }));
    const seeded = await seedSucceededRun(env, seat, { trigger: "MANUAL", queuedAt: new Date(Date.now() - 5 * 60_000), seed: 0 });
    const { runId } = await enqueueRun({ organizationId: seat.organizationId, workerId: seat.workerId, trigger: "MANUAL", requestedById: seat.userId });
    expect((await executeRun(runId)).status).toBe("SUCCEEDED");
    const [seededRun, liveRun] = await Promise.all([db.run.findUniqueOrThrow({ where: { id: seeded.runId } }), db.run.findUniqueOrThrow({ where: { id: runId } })]);
    const seededContext = parseCheckpoint(seededRun.checkpoint)!.context;
    const liveContext = parseCheckpoint(liveRun.checkpoint)!.context;
    expect(seededContext.records).toEqual(liveContext.records);
    expect(seededContext.insights).toEqual(liveContext.insights);
  });

  it("summarizes a CSV deliverable from its ranked records, not its header row", async () => {
    const seat = await hire(org, csvBlueprint());
    const seeded = await seedSucceededRun(env, seat, { trigger: "MANUAL", queuedAt: new Date(Date.now() - HOUR_MS), seed: 3 });
    const row = await db.deliverable.findUniqueOrThrow({ where: { id: seeded.deliverableId! } });
    expect(row.format).toBe("CSV");
    expect(row.summary).toBe(await expectedSummary(row.id));
    expect(row.summary).toMatch(/^\d+ funding rounds?, ranked by amount — top: .+\(\$[\d.]+[KMB]?\)/);
    expect(row.summary).not.toContain(row.content.split("\n")[0]);
  });

  it("refuses to plan a performance review before the worker has an evaluated run", async () => {
    const seat = await hire(org, makeBlueprint());
    const later = new Date(Date.now() - 10 * 60_000);
    await expect(generatePerformanceReview(org.session, seat.workerId)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(assertEvaluatedBefore(env, seat, later)).rejects.toThrow(/planned before any of their runs was evaluated/);

    const seeded = await seedSucceededRun(env, seat, { trigger: "MANUAL", queuedAt: new Date(Date.now() - 3 * HOUR_MS), seed: 5 });
    // Evaluated after it finished: a review planned before that point is still refused.
    await expect(assertEvaluatedBefore(env, seat, new Date(seeded.finishedAt!.getTime() - 1))).rejects.toThrow(/planned before/);
    await expect(assertEvaluatedBefore(env, seat, later)).resolves.toBeUndefined();
  });
});
