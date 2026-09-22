import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivity } from "@/server/activity";
import { db } from "@/server/db";
import { EvaluationDetailsSchema } from "@/server/domain/evaluation";
import { recordDeliverableFeedback } from "@/server/evaluation";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { createRunWithDeliverable, goodRecords, goodReport } from "./helpers";

describe("evaluation: recordDeliverableFeedback", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  let other: Awaited<ReturnType<typeof createTestOrg>>;
  beforeAll(async () => {
    t = await createTestOrg("eval-feedback");
    other = await createTestOrg("eval-feedback-other");
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("accept then reject keeps ONE USER_FEEDBACK row (score 1 → 0), updates the deliverable and the worker score", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const { run, deliverable } = await createRunWithDeliverable(hired, {}, { data: goodRecords(), content: goodReport() });

    await recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "accept" });

    let rows = await db.evaluation.findMany({ where: { deliverableId: deliverable.id, type: "USER_FEEDBACK" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      score: 1,
      passed: true,
      runId: run.id,
      workerId: hired.worker.id,
      workerVersionId: hired.version.id,
      organizationId: t.organization.id,
      createdById: t.user.id,
    });
    expect(EvaluationDetailsSchema.parse(rows[0].details)).toEqual({ kind: "user_feedback", decision: "accepted" });
    let updated = await db.deliverable.findUniqueOrThrow({ where: { id: deliverable.id } });
    expect(updated).toMatchObject({ status: "ACCEPTED", feedback: null, reviewedById: t.user.id });
    expect(updated.reviewedAt).toBeInstanceOf(Date);
    let worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.score).toBe(100); // user feedback is the only source with data so far

    await recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "reject", feedback: "  Half the rounds are older than 30 days.  " });

    rows = await db.evaluation.findMany({ where: { deliverableId: deliverable.id, type: "USER_FEEDBACK" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score: 0, passed: false, runId: run.id });
    expect(EvaluationDetailsSchema.parse(rows[0].details)).toEqual({
      kind: "user_feedback",
      decision: "rejected",
      feedback: "Half the rounds are older than 30 days.",
    });
    expect(rows[0].summary).toBe("Rejected by Test User: Half the rounds are older than 30 days.");
    updated = await db.deliverable.findUniqueOrThrow({ where: { id: deliverable.id } });
    expect(updated).toMatchObject({ status: "REJECTED", feedback: "Half the rounds are older than 30 days." });
    worker = await db.worker.findUniqueOrThrow({ where: { id: hired.worker.id } });
    expect(worker.score).toBe(0);

    const events = await listActivity(t.organization.id, { workerId: hired.worker.id, types: ["DELIVERABLE_ACCEPTED", "DELIVERABLE_REJECTED"] });
    expect(events.map((e) => e.type)).toEqual(["DELIVERABLE_REJECTED", "DELIVERABLE_ACCEPTED"]);
    expect(events[0]).toMatchObject({
      actorType: "USER",
      actorName: "Test User",
      runId: run.id,
      jobId: hired.job.id,
      detail: "Half the rounds are older than 30 days.",
      metadata: { deliverableId: deliverable.id },
      href: `/deliverables/${deliverable.id}`,
    });
    expect(events[0].title).toBe(`Test User sent back Alex’s “${deliverable.title}”`);
    expect(events[1].title).toBe(`Test User accepted Alex’s “${deliverable.title}”`);
  });

  it("is org-scoped and validates its input", async () => {
    const hired = await createHiredWorker(t.organization.id);
    const { deliverable } = await createRunWithDeliverable(hired);

    await expect(recordDeliverableFeedback(other.session, { deliverableId: deliverable.id, decision: "accept" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordDeliverableFeedback(t.session, { deliverableId: "del_missing", decision: "accept" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "maybe" as unknown as "accept" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "reject", feedback: "x".repeat(4_001) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect((await db.deliverable.findUniqueOrThrow({ where: { id: deliverable.id } })).status).toBe("PENDING_REVIEW");
    expect(await db.evaluation.count({ where: { deliverableId: deliverable.id } })).toBe(0);
  });
});
