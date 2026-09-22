import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActivityType } from "@prisma/client";
import { listActivity } from "@/server/activity";
import { db } from "@/server/db";
import { ReviewMetricsSchema, parseBlueprint, type JobSpec, type ReplacementAnalysis } from "@/server/domain";
import { AppError } from "@/server/errors";
import { generatePerformanceReview, recordDeliverableFeedback } from "@/server/evaluation";
import { llm } from "@/server/models";
import { getJobDetail, jobHref, listJobs, parseJobStatusFilter } from "@/server/queries/jobs";
import { decideApproval, enqueueRun, executeRun, RunOutputSchema } from "@/server/runtime";
import { approveJobSpec, buildJobSpec, hireWorker, proposeWorker, scopeJob } from "@/server/staffing";
import { hireReplacement, proposeReplacement, retireWorker, sendMessageToWorker } from "@/server/workers";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";

/**
 * The canonical proof of the product's core loop, end to end, in Simulated mode:
 *
 *   Job → Worker → Runs → Deliverables → Evaluation → (feedback, review, chat) → Replace
 *
 * Every step goes through the public module surfaces exactly as the pages do; assertions read the rows the
 * engine wrote. The suite owns one organization and cleans it up afterwards.
 */

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

const DESCRIPTION =
  "I need someone to track newly funded AI infrastructure startups every week and write a short market research report on what changed.";
const ONE_OFF_INSTRUCTION = "This time, focus on vector databases and give me the top 8 rounds.";
const PERMANENT_INSTRUCTION = "From now on, include the lead investor for every round.";

const stepsOf = (runId: string) => db.runStep.findMany({ where: { runId }, orderBy: { index: "asc" } });
const loadRun = (runId: string) => db.run.findUniqueOrThrow({ where: { id: runId } });
const loadWorker = (workerId: string) => db.worker.findUniqueOrThrow({ where: { id: workerId } });
const loadVersion = (versionId: string) => db.workerVersion.findUniqueOrThrow({ where: { id: versionId } });

async function enqueueManual(t: TestOrg, workerId: string, instructions: string[] = []): Promise<string> {
  const { runId } = await enqueueRun({ organizationId: t.organization.id, workerId, trigger: "MANUAL", input: { instructions }, requestedById: t.user.id });
  return runId;
}

async function runToSuccess(runId: string): Promise<string> {
  const outcome = await executeRun(runId);
  expect(outcome.status).toBe("SUCCEEDED");
  if (outcome.status !== "SUCCEEDED") throw new Error("unreachable");
  expect(outcome.deliverableIds).toHaveLength(1);
  return outcome.deliverableIds[0];
}

describe("e2e: the core loop in simulated mode", () => {
  let t: TestOrg;

  beforeAll(async () => {
    t = await createTestOrg("e2e-loop");
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** What the hiring section produced; later sections (and the Jobs page check at the end) build on it. */
  const hired = {} as { jobId: string; jobSpecId: string; spec: JobSpec; workerId: string; versionId: string; workerName: string };

  // ── 1. Hire ────────────────────────────────────────────────────────────────

  describe("hiring: scope → spec → approve → propose → hire", () => {
    it("turns a plain-English request into an approved spec and a hired worker (no first run)", async () => {
      const scoped = await scopeJob(t.session, DESCRIPTION);
      expect(scoped.questions.jobFamily).toBe("market_research");
      expect(scoped.questions.questions.length).toBeLessThanOrEqual(3);

      const answers = Object.fromEntries(scoped.questions.questions.map((q) => [q.id, q.suggestions[0] ?? "Whatever you think is best"]));
      const built = await buildJobSpec(t.session, scoped.jobId, answers);
      expect(built.spec.jobFamily).toBe("market_research");
      expect(built.spec.deliverable.format).toBe("markdown");
      expect(built.spec.deliverable.sections.length).toBeGreaterThan(0);

      await approveJobSpec(t.session, built.jobSpecId);
      expect((await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } })).status).toBe("SPEC_APPROVED");

      const proposal = await proposeWorker(t.session, scoped.jobId);
      expect(proposal.simulated).toBe(true);
      expect(proposal.blueprint.components.map((c) => c.id)).toEqual(expect.arrayContaining(["collector", "analyst", "compile_report"]));

      const result = await hireWorker(t.session, scoped.jobId, { startFirstRun: false });
      expect(result.runId).toBeUndefined();
      const worker = await loadWorker(result.workerId);
      expect(worker).toMatchObject({ organizationId: t.organization.id, jobId: scoped.jobId, status: "ACTIVE", currentVersionId: result.versionId });
      expect((await loadVersion(result.versionId))).toMatchObject({ version: 1, status: "ACTIVE", changeReason: "INITIAL_HIRE", lockedAt: null });
      expect((await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } })).status).toBe("STAFFED");

      Object.assign(hired, { jobId: scoped.jobId, jobSpecId: built.jobSpecId, spec: built.spec, workerId: result.workerId, versionId: result.versionId, workerName: worker.name });
    });

    // ── 2. Run → Deliverable → Evaluation ──────────────────────────────────

    describe("the first manual run", () => {
      let runId: string;
      let deliverableId: string;

      it("runs to SUCCEEDED with a one-off instruction and produces a real deliverable", async () => {
        runId = await enqueueManual(t, hired.workerId, [ONE_OFF_INSTRUCTION]);
        const queued = await loadRun(runId);
        expect(queued).toMatchObject({ status: "QUEUED", trigger: "MANUAL", simulated: true, workerVersionId: hired.versionId, jobId: hired.jobId });
        expect((await loadVersion(hired.versionId)).lockedAt).toBeInstanceOf(Date); // first run locks v1 forever

        deliverableId = await runToSuccess(runId);

        const run = await loadRun(runId);
        expect(run).toMatchObject({ status: "SUCCEEDED", attempt: 1, error: null, lockedBy: null });
        expect(run.finishedAt).toBeInstanceOf(Date);
        expect(run.durationMs).toBeGreaterThan(0);
        expect(Number(run.costUsd)).toBeGreaterThan(0);
        expect(run.inputTokens).toBeGreaterThan(0);
        expect(run.outputTokens).toBeGreaterThan(0);
        const output = RunOutputSchema.parse(run.output);
        expect(output.deliverableIds).toEqual([deliverableId]);
        expect(output.stats.modelCalls).toBeGreaterThan(0);
        expect(output.stats.toolCalls).toBeGreaterThan(0);

        const deliverable = await db.deliverable.findUniqueOrThrow({ where: { id: deliverableId } });
        expect(deliverable).toMatchObject({ organizationId: t.organization.id, jobId: hired.jobId, workerId: hired.workerId, workerVersionId: hired.versionId, runId, format: "MARKDOWN", status: "PENDING_REVIEW" });
        expect(Array.isArray(deliverable.data)).toBe(true);
        const records = deliverable.data as Array<Record<string, unknown>>;
        expect(records.length).toBeGreaterThan(0);
        const required = hired.spec.deliverable.fields.filter((f) => f.required).map((f) => f.name);
        for (const record of records) for (const field of required) expect(record[field], `${field} on every record`).toBeDefined();
        // The markdown report carries the sections the spec asked for, plus the engine's own methodology note.
        expect(deliverable.content).toContain(`# ${hired.spec.deliverable.title}`);
        expect(deliverable.content).toContain(`## ${hired.spec.deliverable.sections[0]}`);
        expect(deliverable.content).toContain("## Top rounds");
        expect(deliverable.content).toContain("## Methodology");
        expect(deliverable.content).toContain(`Generated by ${hired.workerName}`);
        expect(deliverable.summary?.length).toBeGreaterThan(10);
      });

      it("left a complete trace: steps of every kind, model and tool calls linked to steps, usage, evaluations, score", async () => {
        const steps = await stepsOf(runId);
        expect(steps.length).toBeGreaterThan(5);
        expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i));
        const kinds = new Set(steps.map((s) => s.kind));
        for (const kind of ["MODEL_CALL", "TOOL_CALL", "DETERMINISTIC", "DELIVERABLE", "EVALUATION"] as const) expect(kinds.has(kind), kind).toBe(true);
        expect(kinds.has("ERROR")).toBe(false);
        expect(steps.every((s) => s.status === "SUCCEEDED" && s.finishedAt !== null)).toBe(true);
        expect(steps.at(-1)?.kind).toBe("EVALUATION");
        expect(steps.filter((s) => s.kind === "MODEL_CALL")[0]?.title).toContain(hired.workerName);

        const modelStepIds = new Set(steps.filter((s) => s.kind === "MODEL_CALL").map((s) => s.id));
        const modelCalls = await db.modelCall.findMany({ where: { runId } });
        expect(modelCalls.length).toBeGreaterThan(0);
        const agentCalls = modelCalls.filter((c) => c.purpose === "agent.turn");
        expect(agentCalls).toHaveLength(modelStepIds.size);
        for (const call of agentCalls) {
          expect(call.runStepId !== null && modelStepIds.has(call.runStepId)).toBe(true);
          expect(call).toMatchObject({ organizationId: t.organization.id, workerId: hired.workerId, jobId: hired.jobId, simulated: true, provider: "mock" });
          expect(Number(call.costUsd)).toBeGreaterThan(0);
        }
        expect(modelCalls.some((c) => c.purpose === "evaluation.judge")).toBe(true);

        const toolStepIds = new Set(steps.filter((s) => s.kind === "TOOL_CALL").map((s) => s.id));
        const toolCalls = await db.toolCall.findMany({ where: { runId } });
        expect(toolCalls).toHaveLength(toolStepIds.size);
        expect(toolCalls.length).toBeGreaterThan(0);
        for (const call of toolCalls) {
          expect(call.runStepId !== null && toolStepIds.has(call.runStepId)).toBe(true);
          expect(call).toMatchObject({ status: "SUCCEEDED", workerId: hired.workerId, simulated: true });
        }
        expect(toolCalls.some((c) => c.toolName === "web_search")).toBe(true);

        const usage = await db.usageRecord.findMany({ where: { organizationId: t.organization.id, runId } });
        expect(usage.length).toBeGreaterThan(0);
        expect(new Set(usage.map((u) => u.kind))).toEqual(new Set(["MODEL", "TOOL"]));
        expect(usage.every((u) => u.simulated && u.workerId === hired.workerId && u.jobId === hired.jobId)).toBe(true);
        const modelSpend = usage.filter((u) => u.kind === "MODEL").reduce((sum, u) => sum + Number(u.costUsd), 0);
        expect(Number((await loadRun(runId)).costUsd)).toBeCloseTo(usage.reduce((sum, u) => sum + Number(u.costUsd), 0), 6);
        expect(modelSpend).toBeGreaterThan(0);

        const evaluations = await db.evaluation.findMany({ where: { runId }, orderBy: { type: "asc" } });
        expect(evaluations.map((e) => e.type)).toEqual(["DETERMINISTIC", "LLM_JUDGE"]);
        for (const e of evaluations) {
          expect(e).toMatchObject({ deliverableId, workerId: hired.workerId, workerVersionId: hired.versionId, organizationId: t.organization.id });
          expect(e.score).toBeGreaterThanOrEqual(0);
          expect(e.score).toBeLessThanOrEqual(1);
        }

        const worker = await loadWorker(hired.workerId);
        expect(worker.score).not.toBeNull();
        expect(worker.score).toBeGreaterThan(0);
        expect(worker.scoreUpdatedAt).toBeInstanceOf(Date);
        expect(worker.lastRunAt).toBeInstanceOf(Date);
      });

      it("tells the story in the activity feed, with links", async () => {
        const jobFeed = await listActivity(t.organization.id, { jobId: hired.jobId });
        const byType = (type: ActivityType) => jobFeed.find((e) => e.type === type);
        expect(jobFeed.every((e) => e.jobId === hired.jobId)).toBe(true);
        expect(jobFeed.map((e) => e.type)).toEqual(expect.arrayContaining(["JOB_CREATED", "JOB_SPEC_APPROVED", "WORKER_HIRED", "RUN_QUEUED", "RUN_STARTED", "DELIVERABLE_CREATED", "EVALUATION_COMPLETED", "RUN_SUCCEEDED"]));
        // Newest first.
        expect(jobFeed.at(-1)?.type).toBe("JOB_CREATED");
        expect(jobFeed[0].type).toBe("RUN_SUCCEEDED");

        expect(byType("WORKER_HIRED")).toMatchObject({ actorType: "USER", actorName: t.user.name, workerId: hired.workerId, href: `/workers/${hired.workerId}` });
        expect(byType("WORKER_HIRED")?.title).toContain(hired.workerName);
        expect(byType("RUN_QUEUED")).toMatchObject({ runId, href: `/runs/${runId}` });
        expect(byType("RUN_SUCCEEDED")).toMatchObject({ runId, worker: { id: hired.workerId, name: hired.workerName }, metadata: { deliverableId }, href: `/deliverables/${deliverableId}` });
        expect(byType("EVALUATION_COMPLETED")).toMatchObject({ runId, metadata: { deliverableId }, href: `/deliverables/${deliverableId}` });
        expect(byType("DELIVERABLE_CREATED")).toMatchObject({ metadata: { deliverableId }, href: `/deliverables/${deliverableId}` });
        for (const e of jobFeed) expect(typeof e.createdAt).toBe("string");

        const workerFeed = await listActivity(t.organization.id, { workerId: hired.workerId, types: ["RUN_SUCCEEDED", "RUN_FAILED"], limit: 5 });
        expect(workerFeed).toHaveLength(1);
        expect(workerFeed[0].type).toBe("RUN_SUCCEEDED");
        expect(await listActivity(t.organization.id, { jobId: "job_that_does_not_exist" })).toEqual([]);
      });

      // ── 3. Feedback, review, chat ────────────────────────────────────────

      it("accepting the deliverable records USER_FEEDBACK and folds it into the score", async () => {
        const before = await loadWorker(hired.workerId);
        await recordDeliverableFeedback(t.session, { deliverableId, decision: "accept" });

        const feedback = await db.evaluation.findMany({ where: { deliverableId, type: "USER_FEEDBACK" } });
        expect(feedback).toHaveLength(1);
        expect(feedback[0]).toMatchObject({ score: 1, passed: true, runId, workerVersionId: hired.versionId, createdById: t.user.id });
        expect(await db.evaluation.count({ where: { runId } })).toBe(3);
        expect(await db.deliverable.findUniqueOrThrow({ where: { id: deliverableId } })).toMatchObject({ status: "ACCEPTED", reviewedById: t.user.id });

        const after = await loadWorker(hired.workerId);
        expect(after.score).not.toBeNull();
        expect(after.scoreUpdatedAt!.getTime()).toBeGreaterThanOrEqual(before.scoreUpdatedAt!.getTime());
        // A perfect user verdict can only pull the blended score up.
        expect(after.score!).toBeGreaterThanOrEqual(before.score!);

        const accepted = (await listActivity(t.organization.id, { workerId: hired.workerId, types: ["DELIVERABLE_ACCEPTED"] }))[0];
        expect(accepted).toMatchObject({ actorType: "USER", href: `/deliverables/${deliverableId}` });
      });

      it("writes a performance review from the record", async () => {
        const { reviewId } = await generatePerformanceReview(t.session, hired.workerId);
        const review = await db.workerReview.findUniqueOrThrow({ where: { id: reviewId } });
        expect(review).toMatchObject({ organizationId: t.organization.id, workerId: hired.workerId, workerVersionId: hired.versionId, requestedById: t.user.id });
        expect(["KEEP", "IMPROVE", "REPLACE"]).toContain(review.recommendation);
        expect(review.overallScore).toBeGreaterThanOrEqual(0);
        expect(review.summary.length).toBeGreaterThan(20);
        expect(review.summary).toContain(hired.workerName);
        const metrics = ReviewMetricsSchema.parse(review.metrics);
        expect(metrics).toMatchObject({ runs: 1, succeeded: 1, failed: 0, deliverables: 1, accepted: 1 });
        const event = (await listActivity(t.organization.id, { workerId: hired.workerId, types: ["REVIEW_GENERATED"] }))[0];
        expect(event.metadata).toMatchObject({ reviewId, recommendation: review.recommendation });
      });

      it("turns a permanent instruction from chat into a PROPOSED version, leaving v1 in charge", async () => {
        const reply = await sendMessageToWorker(t.session, hired.workerId, PERMANENT_INSTRUCTION);
        expect(reply.classification).toBe("SPEC_CHANGE");
        expect(reply.proposedVersionId).toBeDefined();

        const proposed = await loadVersion(reply.proposedVersionId!);
        expect(proposed).toMatchObject({ workerId: hired.workerId, version: 2, status: "PROPOSED", changeReason: "SPEC_CHANGE", parentVersionId: hired.versionId, lockedAt: null });
        const blueprint = parseBlueprint(proposed.blueprint);
        const agents = blueprint.components.filter((c) => c.type === "agent");
        expect(agents.length).toBeGreaterThan(0);
        expect(agents.every((a) => a.type === "agent" && a.instructions.includes("lead investor"))).toBe(true);
        expect((await loadWorker(hired.workerId)).currentVersionId).toBe(hired.versionId);

        const workerReply = await db.workerMessage.findUniqueOrThrow({ where: { id: reply.replyMessageId } });
        expect(workerReply.role).toBe("WORKER");
        expect(workerReply.metadata).toMatchObject({ proposedVersionId: reply.proposedVersionId, href: `/workers/${hired.workerId}/replace/${reply.proposedVersionId}` });
        expect(await listActivity(t.organization.id, { workerId: hired.workerId, types: ["VERSION_PROPOSED"] })).toHaveLength(1);
      });
    });
  });

  // ── 4. Replace like a contractor ────────────────────────────────────────────

  describe("replacing a struggling worker", () => {
    it("proposes an evidence-based replacement after a failed run, hires it, keeps history, and the new version succeeds", async () => {
      const hired = await createHiredWorker(t.organization.id, { userId: t.user.id, name: "Sam", collectorTier: "fast", withCleaning: false });

      // A genuine failure through the engine: the provider is down for every attempt of this run.
      const failedRunId = await enqueueManual(t, hired.worker.id);
      const original = llm.generateText;
      vi.spyOn(llm, "generateText").mockImplementation(async (req, tracking) => {
        if (tracking.runId === failedRunId) throw new AppError("MODEL_ERROR", "Anthropic could not complete the request: 503");
        return original(req, tracking);
      });
      expect(await executeRun(failedRunId)).toMatchObject({ status: "FAILED", willRetry: true });
      await db.run.update({ where: { id: failedRunId }, data: { availableAt: new Date() } }); // skip the retry backoff
      expect(await executeRun(failedRunId)).toMatchObject({ status: "FAILED", willRetry: false });
      vi.restoreAllMocks();
      const failed = await loadRun(failedRunId);
      expect(failed).toMatchObject({ status: "FAILED", attempt: 2, workerVersionId: hired.version.id });
      expect(failed.error).toContain("503");
      expect((await stepsOf(failedRunId)).filter((s) => s.kind === "ERROR")).toHaveLength(2);
      expect((await listActivity(t.organization.id, { workerId: hired.worker.id, types: ["RUN_FAILED"] }))[0]).toMatchObject({ runId: failedRunId, href: `/runs/${failedRunId}` });
      const runsBefore = await db.run.count({ where: { workerId: hired.worker.id } });
      expect(runsBefore).toBe(1);

      // Propose: the staffing lead studies the record and upgrades the design.
      const { versionId } = await proposeReplacement(t.session, hired.worker.id);
      const proposed = await loadVersion(versionId);
      expect(proposed).toMatchObject({ workerId: hired.worker.id, version: 2, status: "PROPOSED", changeReason: "REPLACEMENT", parentVersionId: hired.version.id });
      const analysis = proposed.analysis as ReplacementAnalysis;
      expect(analysis.simulated).toBe(true);
      expect(analysis.basedOn).toMatchObject({ runs: 1, failedRuns: 1 });
      expect(analysis.failurePatterns.map((p) => p.pattern)).toEqual(expect.arrayContaining([expect.stringContaining("1 of 1 run failed")]));
      const next = parseBlueprint(proposed.blueprint);
      const collector = next.components.find((c) => c.id === "collector");
      expect(collector?.type === "agent" && collector.modelTier).toBe("standard");
      expect(next.components.map((c) => c.id).slice(0, 3)).toEqual(["collector", "validate_records", "dedupe"]);
      expect((await loadWorker(hired.worker.id)).currentVersionId).toBe(hired.version.id); // nothing changes until you hire

      // Hire the replacement: v2 takes the seat, v1 is retired, and the record stays intact.
      const result = await hireReplacement(t.session, versionId, { startFirstRun: false });
      expect(result.runId).toBeUndefined();
      const worker = await loadWorker(hired.worker.id);
      expect(worker).toMatchObject({ currentVersionId: versionId, status: "ACTIVE", score: null, health: "UNKNOWN" });
      expect(await loadVersion(versionId)).toMatchObject({ status: "ACTIVE", lockedAt: null });
      expect((await loadVersion(versionId)).activatedAt).toBeInstanceOf(Date);
      const retired = await loadVersion(hired.version.id);
      expect(retired.status).toBe("REPLACED");
      expect(retired.retiredAt).toBeInstanceOf(Date);
      expect(await db.run.count({ where: { workerId: hired.worker.id } })).toBe(runsBefore);
      expect((await loadRun(failedRunId)).workerVersionId).toBe(hired.version.id);
      const replaced = (await listActivity(t.organization.id, { workerId: hired.worker.id, types: ["WORKER_REPLACED"] }))[0];
      expect(replaced).toMatchObject({ metadata: { versionId, version: 2, changeReason: "REPLACEMENT" }, href: `/workers/${hired.worker.id}/replace/${versionId}` });

      // The new version does the job.
      const runId = await enqueueManual(t, hired.worker.id);
      expect((await loadVersion(versionId)).lockedAt).toBeInstanceOf(Date);
      const deliverableId = await runToSuccess(runId);
      const run = await loadRun(runId);
      expect(run).toMatchObject({ status: "SUCCEEDED", workerVersionId: versionId, workerId: hired.worker.id });
      expect(await db.deliverable.findUniqueOrThrow({ where: { id: deliverableId } })).toMatchObject({ workerVersionId: versionId, format: "MARKDOWN" });
      expect((await stepsOf(runId)).filter((s) => s.kind === "DETERMINISTIC").map((s) => s.title).slice(0, 2)).toEqual(["Validate records", "Remove duplicates"]);
      expect(await db.run.count({ where: { workerId: hired.worker.id } })).toBe(runsBefore + 1);
      expect(await db.evaluation.count({ where: { runId } })).toBe(2);
      expect((await loadWorker(hired.worker.id)).score).not.toBeNull();
    });
  });

  // ── 5. Approval gate ────────────────────────────────────────────────────────

  describe("a worker whose notifier needs approval", () => {
    it("pauses at WAITING_FOR_APPROVAL, then approve → resume → SUCCEEDED with exactly one send", async () => {
      const hired = await createHiredWorker(t.organization.id, { userId: t.user.id, name: "Maya", withNotifier: true });
      const runId = await enqueueManual(t, hired.worker.id);

      const paused = await executeRun(runId);
      expect(paused.status).toBe("WAITING_FOR_APPROVAL");
      if (paused.status !== "WAITING_FOR_APPROVAL") throw new Error("unreachable");
      expect(paused.approvalIds).toHaveLength(1);
      const approvalId = paused.approvalIds[0];

      const approval = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
      expect(approval).toMatchObject({ status: "PENDING", toolName: "send_notification", runId, workerId: hired.worker.id, organizationId: t.organization.id });
      expect(approval.payload).toMatchObject({ channel: "email" });
      expect(await loadRun(runId)).toMatchObject({ status: "WAITING_FOR_APPROVAL", lockedBy: null });
      // The report already exists — only the send is gated.
      expect(await db.deliverable.count({ where: { runId } })).toBe(1);
      const sendsWhilePaused = await db.toolCall.findMany({ where: { runId, toolName: "send_notification" } });
      expect(sendsWhilePaused).toHaveLength(1);
      expect(sendsWhilePaused[0].status).toBe("PENDING_APPROVAL");
      const requested = (await listActivity(t.organization.id, { workerId: hired.worker.id, types: ["APPROVAL_REQUESTED"] }))[0];
      expect(requested).toMatchObject({ runId, metadata: { approvalId, toolName: "send_notification" }, href: "/approvals" });

      await decideApproval({ organizationId: t.organization.id, approvalId, userId: t.user.id, decision: "approve", note: "Send it" });
      expect(await db.approval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({ status: "APPROVED", decidedById: t.user.id, decisionNote: "Send it" });
      expect((await loadRun(runId)).status).toBe("QUEUED");

      await runToSuccess(runId);
      expect(await loadRun(runId)).toMatchObject({ status: "SUCCEEDED", attempt: 1 });
      const sends = await db.toolCall.findMany({ where: { runId, toolName: "send_notification" } });
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatchObject({ status: "SUCCEEDED", simulated: true });
      expect(sends[0].output).toMatchObject({ delivered: true, simulated: true });
      const steps = await stepsOf(runId);
      expect(steps.find((s) => s.kind === "APPROVAL")?.status).toBe("SUCCEEDED");
      expect(steps.some((s) => ["RUNNING", "PENDING", "WAITING"].includes(s.status))).toBe(false);
      expect(await db.evaluation.count({ where: { runId } })).toBe(2);

      const types = (await listActivity(t.organization.id, { workerId: hired.worker.id })).map((e) => e.type).reverse();
      expect(types).toEqual(expect.arrayContaining(["RUN_QUEUED", "RUN_STARTED", "DELIVERABLE_CREATED", "APPROVAL_REQUESTED", "APPROVAL_APPROVED", "TOOL_USED", "EVALUATION_COMPLETED", "RUN_SUCCEEDED"]));
      expect(types.filter((x) => x === "TOOL_USED")).toHaveLength(1);
      expect(types.indexOf("APPROVAL_APPROVED")).toBeGreaterThan(types.indexOf("APPROVAL_REQUESTED"));
      expect(types.at(-1)).toBe("RUN_SUCCEEDED");
    });
  });

  // ── 6. The Jobs pages read the record ───────────────────────────────────────

  describe("the Jobs pages read everything the loop wrote", () => {
    it("lists every job with its seat, cadence and delivery count, filtered straight from the URL", async () => {
      const view = await listJobs(t.organization.id);
      expect(view.counts).toMatchObject({ all: 3, STAFFED: 3, DRAFT: 0, SPEC_APPROVED: 0 });
      expect(view.filter).toBeNull();
      expect(view.hasRunsInFlight).toBe(false);

      const row = view.jobs.find((j) => j.id === hired.jobId);
      expect(row).toMatchObject({
        status: "STAFFED",
        familyLabel: "Market Research",
        href: `/jobs/${hired.jobId}`,
        deliverables: 1,
        hasHistory: true,
        worker: { id: hired.workerId, name: hired.workerName, status: "ACTIVE" },
      });
      expect(row?.cadence).toBeTruthy();
      expect(typeof row?.lastRunAt).toBe("string");

      expect(parseJobStatusFilter("staffed")).toBe("STAFFED");
      expect(parseJobStatusFilter("nonsense")).toBeNull();
      expect((await listJobs(t.organization.id, { status: "STAFFED" })).jobs).toHaveLength(3);
      expect((await listJobs(t.organization.id, { status: "DRAFT" })).jobs).toEqual([]);
      // Setup-stage jobs continue in the hire flow; everything else opens its history page.
      expect(jobHref({ id: "j", status: "SPEC_APPROVED" })).toBe("/hire?jobId=j");
      expect(jobHref({ id: "j", status: "CLOSED" })).toBe("/jobs/j");
    });

    it("tells the job's story: approved spec, versions, seat, runs, deliverables, activity and what to do next", async () => {
      const detail = await getJobDetail(t.organization.id, hired.jobId);
      expect(detail.job).toMatchObject({ id: hired.jobId, status: "STAFFED", familyLabel: "Market Research", description: DESCRIPTION });
      expect(detail.spec?.title).toBe(hired.spec.title);
      expect(detail.specVersions).toHaveLength(1);
      expect(detail.specVersions[0]).toMatchObject({ id: hired.jobSpecId, version: 1, status: "APPROVED", shown: true });
      expect(typeof detail.specVersions[0].approvedAt).toBe("string");

      expect(detail.workers).toHaveLength(1);
      expect(detail.currentWorker).toMatchObject({ id: hired.workerId, name: hired.workerName, status: "ACTIVE", versionNumber: 1, runs: 1 });
      expect(detail.currentWorker?.score).not.toBeNull();

      expect(detail.runs).toHaveLength(1);
      expect(detail.runs[0]).toMatchObject({ status: "SUCCEEDED", trigger: "MANUAL", simulated: true, error: null, worker: { id: hired.workerId } });
      expect(detail.runs[0].costUsd).toBeGreaterThan(0);
      expect(detail.runs[0].durationMs).toBeGreaterThan(0);
      expect(detail.deliverables).toHaveLength(1);
      expect(detail.deliverables[0]).toMatchObject({ status: "ACCEPTED", format: "MARKDOWN", runId: detail.runs[0].id, worker: { id: hired.workerId } });
      expect(detail.runs[0].deliverable?.id).toBe(detail.deliverables[0].id);
      expect(detail.stats).toMatchObject({ runs: 1, succeeded: 1, failed: 0, deliverables: 1, accepted: 1 });
      expect(detail.stats.totalCostUsd).toBeGreaterThan(0);

      expect(detail.activity.map((e) => e.type)).toEqual(
        expect.arrayContaining(["JOB_CREATED", "WORKER_HIRED", "RUN_SUCCEEDED", "DELIVERABLE_ACCEPTED", "REVIEW_GENERATED", "VERSION_PROPOSED"]),
      );
      expect(detail.activity.every((e) => e.jobId === hired.jobId)).toBe(true);
      // Seat taken → nothing to hire, close or discard.
      expect(detail.can).toEqual({ hire: false, continueSetup: false, close: false, discard: false });
      expect(detail.hasRunsInFlight).toBe(false);

      // Org-scoped: another organization sees neither the list entry nor the detail page.
      const other = await createTestOrg("e2e-other");
      try {
        expect((await listJobs(other.organization.id)).counts.all).toBe(0);
        await expect(getJobDetail(other.organization.id, hired.jobId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await other.cleanup();
      }
    });

    it("keeps a replaced worker's history on the job and reopens the seat once they retire", async () => {
      // Sam's job from section 4: a failed run under v1, a successful one under v2.
      const sam = await db.worker.findFirstOrThrow({ where: { organizationId: t.organization.id, name: "Sam" } });
      let detail = await getJobDetail(t.organization.id, sam.jobId);
      expect(detail.currentWorker).toMatchObject({ id: sam.id, versionNumber: 2, runs: 2 });
      expect(detail.stats).toMatchObject({ runs: 2, succeeded: 1, failed: 1 });
      expect(detail.runs.map((r) => r.status)).toEqual(["SUCCEEDED", "FAILED"]); // newest first
      expect(detail.runs[1].error).toContain("503");
      expect(detail.activity.map((e) => e.type)).toContain("WORKER_REPLACED");

      await retireWorker(t.session, sam.id);

      detail = await getJobDetail(t.organization.id, sam.jobId);
      expect(detail.job.status).toBe("SPEC_APPROVED");
      expect(detail.currentWorker).toBeNull();
      expect(detail.workers[0]).toMatchObject({ id: sam.id, status: "RETIRED" });
      expect(typeof detail.workers[0].retiredAt).toBe("string");
      expect(detail.stats.runs).toBe(2); // history survives the retirement
      // The seat is open again: hire (→ /hire?jobId=) or close; discarding is off the table because history exists.
      expect(detail.can).toEqual({ hire: true, continueSetup: false, close: true, discard: false });

      const row = (await listJobs(t.organization.id, { status: "SPEC_APPROVED" })).jobs.find((j) => j.id === sam.jobId);
      expect(row).toMatchObject({ status: "SPEC_APPROVED", worker: null, hasHistory: true, href: `/hire?jobId=${sam.jobId}` });
    });
  });
});
