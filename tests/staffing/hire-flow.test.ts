import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivity } from "@/server/activity";
import { db } from "@/server/db";
import { IntakeAnswersSchema, JobSpecSchema, WorkerProposalSchema, parseBlueprint, parseJobSpec } from "@/server/domain";
import { isAppError } from "@/server/errors";
import {
  approveJobSpec,
  buildJobSpec,
  discardJob,
  getHireFlowState,
  hireWorker,
  proposeWorker,
  reviseJobSpec,
  scopeJob,
  updateJobSpec,
} from "@/server/staffing";
import { tools } from "@/server/tools";
import { createTestOrg } from "../helpers/factory";
import { DESCRIPTIONS } from "./helpers";

/**
 * The runtime is built in parallel; only the first-run test depends on it. The specifier is a variable so the
 * typecheck does not hard-fail while `@/server/runtime` has no index yet (vite-node still resolves the alias).
 */
const runtimeReady = await (async () => {
  try {
    const specifier = "@/server/runtime";
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier);
    return typeof mod.enqueueRun === "function";
  } catch {
    return false;
  }
})();

async function expectAppError(code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    expect.unreachable(`expected AppError(${code})`);
  } catch (e) {
    expect(isAppError(e) ? e.code : e).toBe(code);
  }
}

describe("staffing: hire flow in simulated mode", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  let other: Awaited<ReturnType<typeof createTestOrg>>;
  beforeAll(async () => {
    t = await createTestOrg("staffing-hire");
    other = await createTestOrg("staffing-hire-other");
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("scope → answer → spec → approve → propose → hire, with every row and activity in place", async () => {
    // 1. Scope: DRAFT job, ≤ 3 questions stored on intake, JOB_CREATED.
    const scoped = await scopeJob(t.session, DESCRIPTIONS.market_research);
    expect(scoped.questions.jobFamily).toBe("market_research");
    expect(scoped.questions.questions.length).toBeGreaterThan(0);
    expect(scoped.questions.questions.length).toBeLessThanOrEqual(3);
    const jobRow = await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } });
    expect(jobRow).toMatchObject({ organizationId: t.organization.id, status: "DRAFT", jobFamily: "market_research", title: scoped.questions.draftTitle, createdById: t.user.id });
    expect(IntakeAnswersSchema.parse(jobRow.intake)).toEqual({ questions: scoped.questions.questions, answers: {} });

    let state = await getHireFlowState(t.organization.id, scoped.jobId);
    expect(state).toMatchObject({ step: "questions", jobSpecId: null, spec: null, specStatus: null, proposal: null });
    expect(state.intake?.questions).toEqual(scoped.questions.questions);

    // 2. Build the spec from the answers: DRAFT v1, answers saved, spec reflects them.
    const answers = { focus: "AI infrastructure in Europe, seed to Series B", volume: "about 12", recipients: "Email it to research@acme.example every Monday", bogus: "ignored" };
    const built = await buildJobSpec(t.session, scoped.jobId, answers);
    expect(JobSpecSchema.safeParse(built.spec).success).toBe(true);
    expect(built.spec.deliverable.targetCount).toBe(12);
    expect(built.spec.toolsLikelyNeeded).toContain("send_notification");
    expect(built.spec.toolsLikelyNeeded.every((n) => tools.has(n))).toBe(true);
    expect(built.spec.approvalPolicy.requireApprovalFor.length).toBeGreaterThan(0);
    expect(built.spec.constraints).toContain("Focus: AI infrastructure in Europe, seed to Series B");
    expect(built.spec.cadence).toEqual({ kind: "weekly", hour: 9, dayOfWeek: 1 });
    const specRow = await db.jobSpec.findUniqueOrThrow({ where: { id: built.jobSpecId } });
    expect(specRow).toMatchObject({ jobId: scoped.jobId, version: 1, status: "DRAFT" });
    expect(parseJobSpec(specRow.spec)).toEqual(built.spec);
    const afterBuild = await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } });
    expect(IntakeAnswersSchema.parse(afterBuild.intake).answers).toEqual({ focus: answers.focus, volume: answers.volume, recipients: answers.recipients });
    expect(afterBuild.title).toBe(built.spec.title);

    state = await getHireFlowState(t.organization.id, scoped.jobId);
    expect(state).toMatchObject({ step: "spec", jobSpecId: built.jobSpecId, specStatus: "DRAFT", proposal: null });
    expect(state.spec).toEqual(built.spec);

    // Re-answering creates v2 and supersedes v1.
    const rebuilt = await buildJobSpec(t.session, scoped.jobId, { volume: "20" });
    expect(rebuilt.spec.deliverable.targetCount).toBe(20);
    expect(rebuilt.spec.constraints).toContain("Focus: AI infrastructure in Europe, seed to Series B"); // earlier answers kept
    const versions = await db.jobSpec.findMany({ where: { jobId: scoped.jobId }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [1, "SUPERSEDED"],
      [2, "DRAFT"],
    ]);

    // 3. Edit the draft, reject an invalid patch.
    const edited = await updateJobSpec(t.session, rebuilt.jobSpecId, { title: "AI Infra Funding Radar", deliverable: { ...rebuilt.spec.deliverable, targetCount: 15 } });
    expect(edited.title).toBe("AI Infra Funding Radar");
    expect(edited.deliverable.targetCount).toBe(15);
    expect((await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } })).title).toBe("AI Infra Funding Radar");
    await expectAppError("VALIDATION", () => updateJobSpec(t.session, rebuilt.jobSpecId, { title: "no", cadence: { kind: "daily", hour: 99 } } as never));
    await expectAppError("NOT_FOUND", () => updateJobSpec(other.session, rebuilt.jobSpecId, { title: "Hijacked title" }));

    // 4. Approve: APPROVED + Job SPEC_APPROVED + activity; idempotent; superseded versions cannot be approved.
    await approveJobSpec(t.session, rebuilt.jobSpecId);
    await approveJobSpec(t.session, rebuilt.jobSpecId);
    await expectAppError("CONFLICT", () => approveJobSpec(t.session, built.jobSpecId));
    const approved = await db.jobSpec.findUniqueOrThrow({ where: { id: rebuilt.jobSpecId } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).toBeInstanceOf(Date);
    expect((await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } })).status).toBe("SPEC_APPROVED");
    await expectAppError("CONFLICT", () => updateJobSpec(t.session, rebuilt.jobSpecId, { title: "Too late to edit" }));
    await expectAppError("CONFLICT", () => buildJobSpec(t.session, scoped.jobId, {}));

    state = await getHireFlowState(t.organization.id, scoped.jobId);
    expect(state).toMatchObject({ step: "proposal", jobSpecId: rebuilt.jobSpecId, specStatus: "APPROVED", proposal: null });

    // 5. Propose: stored on the job, returned again unless regenerate.
    const proposal = await proposeWorker(t.session, scoped.jobId);
    expect(WorkerProposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposal).toMatchObject({ jobSpecId: rebuilt.jobSpecId, simulated: true });
    expect(proposal.rationale.length).toBeGreaterThanOrEqual(3);
    expect(proposal.blueprint.jobFamily).toBe("market_research");
    expect(proposal.blueprint.components.map((c) => c.id)).toContain("notifier"); // recipients answer → send_notification
    expect(proposal.blueprint.deliverable.titleTemplate).toContain("{{date}}");
    const again = await proposeWorker(t.session, scoped.jobId);
    expect(again).toEqual(proposal);
    const regenerated = await proposeWorker(t.session, scoped.jobId, { regenerate: true });
    expect(regenerated.blueprint).toEqual(proposal.blueprint); // deterministic in simulated mode
    expect(regenerated.generatedAt >= proposal.generatedAt).toBe(true);
    state = await getHireFlowState(t.organization.id, scoped.jobId);
    expect(state.proposal?.blueprint).toEqual(proposal.blueprint);
    await expectAppError("NOT_FOUND", () => proposeWorker(other.session, scoped.jobId));

    // 6. Hire (no first run): Worker + v1 ACTIVE + grants + schedule; job STAFFED; proposal cleared; activity.
    const hired = await hireWorker(t.session, scoped.jobId, { startFirstRun: false });
    expect(hired.runId).toBeUndefined();
    const worker = await db.worker.findUniqueOrThrow({ where: { id: hired.workerId }, include: { toolGrants: true, versions: true } });
    expect(worker).toMatchObject({
      organizationId: t.organization.id,
      jobId: scoped.jobId,
      status: "ACTIVE",
      health: "UNKNOWN",
      name: proposal.blueprint.persona.name,
      title: proposal.blueprint.persona.title,
      avatarColor: proposal.blueprint.persona.avatarColor,
      scheduleKind: "WEEKLY",
      scheduleHour: 9,
      scheduleDow: 1,
      currentVersionId: hired.versionId,
    });
    expect(worker.nextRunAt).toBeInstanceOf(Date);
    expect(worker.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(worker.nextRunAt!.getDay()).toBe(1);
    expect(worker.nextRunAt!.getHours()).toBe(9);
    expect(worker.versions).toHaveLength(1);
    const version = worker.versions[0];
    expect(version).toMatchObject({ id: hired.versionId, version: 1, status: "ACTIVE", changeReason: "INITIAL_HIRE", jobSpecId: rebuilt.jobSpecId, lockedAt: null, createdById: t.user.id });
    expect(version.activatedAt).toBeInstanceOf(Date);
    expect(version.changeSummary).toBe(proposal.rationale.join("\n"));
    expect(parseBlueprint(version.blueprint)).toEqual(proposal.blueprint);
    expect(new Map(worker.toolGrants.map((g) => [g.toolName, g.requiresApproval]))).toEqual(
      new Map(proposal.blueprint.tools.map((g) => [g.toolName, g.requiresApproval || tools.get(g.toolName)!.defaultRequiresApproval])),
    );
    expect(worker.toolGrants.find((g) => g.toolName === "send_notification")?.requiresApproval).toBe(true);
    expect(worker.toolGrants.every((g) => g.revokedAt === null && g.grantedById === t.user.id)).toBe(true);
    const staffed = await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } });
    expect(staffed.status).toBe("STAFFED");
    expect(staffed.pendingProposal).toBeNull();

    const events = await listActivity(t.organization.id, { jobId: scoped.jobId });
    expect(events.map((e) => e.type)).toEqual(["WORKER_HIRED", "JOB_SPEC_APPROVED", "JOB_CREATED"]);
    expect(events[0]).toMatchObject({
      title: `You hired ${worker.name} as ${worker.title}`,
      actorType: "USER",
      actorName: "Test User",
      workerId: worker.id,
      metadata: { version: 1, changeReason: "INITIAL_HIRE" },
      href: `/workers/${worker.id}`,
    });
    expect(events[1]).toMatchObject({ actorType: "USER", actorName: "Test User" });
    expect(events[2]).toMatchObject({ actorType: "USER", actorName: "Test User", title: expect.stringContaining("Test User opened a job") });

    // 7. Once staffed: second hire conflicts, the hire flow is gone, revising/discarding is refused.
    await expectAppError("CONFLICT", () => hireWorker(t.session, scoped.jobId, { startFirstRun: false }));
    await expectAppError("NOT_FOUND", () => getHireFlowState(t.organization.id, scoped.jobId));
    await expectAppError("CONFLICT", () => reviseJobSpec(t.session, scoped.jobId));
    await expectAppError("CONFLICT", () => discardJob(t.session, scoped.jobId));
    await expectAppError("CONFLICT", () => proposeWorker(t.session, scoped.jobId));
    expect(await db.worker.count({ where: { jobId: scoped.jobId } })).toBe(1);
  });

  it("names are unique across the workforce and a custom name is honoured", async () => {
    const first = await scopeJob(t.session, DESCRIPTIONS.feedback_analysis);
    const firstSpec = await buildJobSpec(t.session, first.jobId, {});
    await approveJobSpec(t.session, firstSpec.jobSpecId);
    const firstProposal = await proposeWorker(t.session, first.jobId);
    const existing = (await db.worker.findMany({ where: { organizationId: t.organization.id, status: { not: "RETIRED" } } })).map((w) => w.name.toLowerCase());
    expect(existing).not.toContain(firstProposal.blueprint.persona.name.toLowerCase());
    const hiredFirst = await hireWorker(t.session, first.jobId, { name: "  Robin  ", startFirstRun: false });
    const robin = await db.worker.findUniqueOrThrow({ where: { id: hiredFirst.workerId }, include: { currentVersion: true } });
    expect(robin.name).toBe("Robin");
    expect(parseBlueprint(robin.currentVersion!.blueprint).persona.name).toBe("Robin");
    expect(robin.avatarColor).toBe(parseBlueprint(robin.currentVersion!.blueprint).persona.avatarColor);
    const hiredEvent = (await listActivity(t.organization.id, { workerId: robin.id, types: ["WORKER_HIRED"] }))[0];
    expect(hiredEvent.title).toBe(`You hired Robin as ${robin.title}`);

    // A second worker for the same family avoids the names already in use (including "Robin").
    const second = await scopeJob(t.session, DESCRIPTIONS.feedback_analysis);
    const secondSpec = await buildJobSpec(t.session, second.jobId, {});
    await approveJobSpec(t.session, secondSpec.jobSpecId);
    const secondProposal = await proposeWorker(t.session, second.jobId);
    const used = (await db.worker.findMany({ where: { organizationId: t.organization.id, status: { not: "RETIRED" } } })).map((w) => w.name.toLowerCase());
    expect(used).not.toContain(secondProposal.blueprint.persona.name.toLowerCase());
    await expectAppError("VALIDATION", () => hireWorker(t.session, second.jobId, { name: "x".repeat(41), startFirstRun: false }));
    await discardJob(t.session, second.jobId); // SPEC_APPROVED with no worker → allowed
    expect(await db.job.findUnique({ where: { id: second.jobId } })).toBeNull();
  });

  it("reviseJobSpec from the proposal step returns to DRAFT and clears the proposal; discardJob deletes", async () => {
    const scoped = await scopeJob(t.session, DESCRIPTIONS.lead_research);
    const built = await buildJobSpec(t.session, scoped.jobId, { volume: "30" });
    await expectAppError("CONFLICT", () => proposeWorker(t.session, scoped.jobId)); // spec not approved yet
    await expectAppError("CONFLICT", () => hireWorker(t.session, scoped.jobId, { startFirstRun: false })); // no proposal
    await approveJobSpec(t.session, built.jobSpecId);
    const proposal = await proposeWorker(t.session, scoped.jobId);
    expect(proposal.blueprint.deliverable.format).toBe("csv");
    expect(proposal.blueprint.components.map((c) => c.id)).toContain("to_csv");

    const revised = await reviseJobSpec(t.session, scoped.jobId);
    expect(revised.spec).toEqual(built.spec);
    expect(revised.jobSpecId).not.toBe(built.jobSpecId);
    const job = await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } });
    expect(job.status).toBe("DRAFT");
    expect(job.pendingProposal).toBeNull();
    const specs = await db.jobSpec.findMany({ where: { jobId: scoped.jobId }, orderBy: { version: "asc" } });
    expect(specs.map((s) => [s.version, s.status])).toEqual([
      [1, "APPROVED"],
      [2, "DRAFT"],
    ]);
    const state = await getHireFlowState(t.organization.id, scoped.jobId);
    expect(state).toMatchObject({ step: "spec", jobSpecId: revised.jobSpecId, specStatus: "DRAFT", proposal: null });
    await expectAppError("CONFLICT", () => proposeWorker(t.session, scoped.jobId)); // the old approved v1 is not the current spec
    await expectAppError("CONFLICT", () => hireWorker(t.session, scoped.jobId, { startFirstRun: false }));

    // Approving the revision supersedes the old approved version; the old proposal is not resurrected.
    await approveJobSpec(t.session, revised.jobSpecId);
    const after = await db.jobSpec.findMany({ where: { jobId: scoped.jobId }, orderBy: { version: "asc" } });
    expect(after.map((s) => s.status)).toEqual(["SUPERSEDED", "APPROVED"]);
    expect((await getHireFlowState(t.organization.id, scoped.jobId)).proposal).toBeNull();
    const fresh = await proposeWorker(t.session, scoped.jobId);
    expect(fresh.jobSpecId).toBe(revised.jobSpecId);

    await expectAppError("NOT_FOUND", () => discardJob(other.session, scoped.jobId));
    await discardJob(t.session, scoped.jobId);
    expect(await db.job.findUnique({ where: { id: scoped.jobId } })).toBeNull();
    expect(await db.jobSpec.count({ where: { jobId: scoped.jobId } })).toBe(0);
    await expectAppError("NOT_FOUND", () => getHireFlowState(t.organization.id, scoped.jobId));
    const unspecced = await scopeJob(t.session, DESCRIPTIONS.general);
    await expectAppError("CONFLICT", () => reviseJobSpec(t.session, unspecced.jobId)); // nothing to revise yet
  });

  it("is org-scoped on every entry point", async () => {
    const scoped = await scopeJob(t.session, DESCRIPTIONS.support_triage);
    const built = await buildJobSpec(t.session, scoped.jobId, {});
    await expectAppError("NOT_FOUND", () => buildJobSpec(other.session, scoped.jobId, {}));
    await expectAppError("NOT_FOUND", () => updateJobSpec(other.session, built.jobSpecId, { title: "Not yours" }));
    await expectAppError("NOT_FOUND", () => approveJobSpec(other.session, built.jobSpecId));
    await expectAppError("NOT_FOUND", () => reviseJobSpec(other.session, scoped.jobId));
    await expectAppError("NOT_FOUND", () => getHireFlowState(other.organization.id, scoped.jobId));
    await expectAppError("NOT_FOUND", () => proposeWorker(other.session, scoped.jobId));
    await expectAppError("NOT_FOUND", () => hireWorker(other.session, scoped.jobId, { startFirstRun: false }));
    await expectAppError("NOT_FOUND", () => discardJob(other.session, scoped.jobId));
    expect((await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } })).status).toBe("DRAFT");
    await expectAppError("VALIDATION", () => scopeJob(t.session, "   "));
  });

  it.skipIf(!runtimeReady)("queues the first run at hire time (trigger HIRE) and locks version 1", async () => {
    const scoped = await scopeJob(t.session, DESCRIPTIONS.market_analysis);
    const built = await buildJobSpec(t.session, scoped.jobId, {});
    await approveJobSpec(t.session, built.jobSpecId);
    await proposeWorker(t.session, scoped.jobId);
    const hired = await hireWorker(t.session, scoped.jobId);
    expect(hired.runId).toBeDefined();
    const run = await db.run.findUniqueOrThrow({ where: { id: hired.runId! } });
    expect(run).toMatchObject({ organizationId: t.organization.id, workerId: hired.workerId, workerVersionId: hired.versionId, jobId: scoped.jobId, trigger: "HIRE", status: "QUEUED", simulated: true, requestedById: t.user.id });
    const version = await db.workerVersion.findUniqueOrThrow({ where: { id: hired.versionId } });
    expect(version.lockedAt).toBeInstanceOf(Date);
  });
});
