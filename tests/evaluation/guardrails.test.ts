import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { generatePerformanceReview, recordDeliverableFeedback } from "@/server/evaluation";
import { currentSpendMonth } from "@/server/security";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { asRole, rejection } from "../platform/helpers";
import { createRunWithDeliverable, goodRecords, goodReport, type Hired } from "./helpers";

/**
 * Reviewing work and asking for a performance review are both MEMBER-level (that is the job), but a review
 * costs a model call, so it is refused for a suspended or over-budget workspace.
 */

const code = (e: unknown): string | undefined => (e instanceof AppError ? e.code : undefined);

describe("evaluation guardrails", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("eval-guardrails");
    hired = await createHiredWorker(t.organization.id, { name: "Vera" });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("lets a member accept a deliverable and ask for a review", async () => {
    const member = asRole(t.session, "MEMBER");
    const { deliverable } = await createRunWithDeliverable(hired, {}, { data: goodRecords(), content: goodReport() });
    await recordDeliverableFeedback(member, { deliverableId: deliverable.id, decision: "accept", feedback: "Exactly what we needed." });
    expect((await db.deliverable.findUniqueOrThrow({ where: { id: deliverable.id } })).status).toBe("ACCEPTED");

    const { reviewId } = await generatePerformanceReview(member, hired.worker.id);
    expect(await db.workerReview.count({ where: { id: reviewId, organizationId: t.organization.id } })).toBe(1);
  });

  it("refuses a performance review for a suspended or over-budget workspace", async () => {
    await db.organization.update({ where: { id: t.organization.id }, data: { suspendedAt: new Date() } });
    expect(code(await rejection(generatePerformanceReview(t.session, hired.worker.id)))).toBe("FORBIDDEN");

    await db.organization.update({ where: { id: t.organization.id }, data: { suspendedAt: null, monthlyBudgetUsd: "0.50" } });
    await db.orgSpendMonth.create({ data: { organizationId: t.organization.id, month: currentSpendMonth(), costUsd: "0.75" } });
    expect(code(await rejection(generatePerformanceReview(t.session, hired.worker.id)))).toBe("LIMIT_EXCEEDED");

    // Reviewing a deliverable costs nothing, so it keeps working while the workspace is capped.
    const { deliverable } = await createRunWithDeliverable(hired, {}, { data: goodRecords(), content: goodReport() });
    await expect(recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "reject", feedback: "Too few rows." })).resolves.toBeUndefined();

    await db.orgSpendMonth.deleteMany({ where: { organizationId: t.organization.id } });
    await db.organization.update({ where: { id: t.organization.id }, data: { monthlyBudgetUsd: null } });
  });
});
