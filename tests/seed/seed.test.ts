import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActivity } from "@/server/activity";
import type { SessionContext } from "@/server/auth/types";
import { DEMO_USER } from "@/server/auth/types";
import { verifyPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { parseBlueprint } from "@/server/domain";
import { decideApproval, enqueueRun, executeRun } from "@/server/runtime";
import { parseCheckpoint } from "@/server/runtime/checkpoint";
import { proposeReplacement } from "@/server/workers";
import { DEMO_IDS, seedDemo, type SeedSummary } from "../../prisma/seed/demo";

/**
 * The demo seed is the YC demo environment, so this suite proves the demo path works for real on the seeded data:
 * the workforce looks right, the pending approval resumes the actual executor, Replace produces the fix, and a
 * re-seed rebuilds exactly the same workspace. The seed only ever touches the demo org (deleted by slug).
 */

const DAY_MS = 86_400_000;

async function countsFor(organizationId: string) {
  const byRun = { run: { organizationId } };
  const byWorker = { worker: { organizationId } };
  const [jobs, specs, workers, versions, grants, runs, steps, modelCalls, toolCalls, approvals, deliverables, evaluations, reviews, messages, activity, usage] = await Promise.all([
    db.job.count({ where: { organizationId } }),
    db.jobSpec.count({ where: { job: { organizationId } } }),
    db.worker.count({ where: { organizationId } }),
    db.workerVersion.count({ where: byWorker }),
    db.workerToolGrant.count({ where: byWorker }),
    db.run.count({ where: { organizationId } }),
    db.runStep.count({ where: byRun }),
    db.modelCall.count({ where: { organizationId } }),
    db.toolCall.count({ where: byRun }),
    db.approval.count({ where: { organizationId } }),
    db.deliverable.count({ where: { organizationId } }),
    db.evaluation.count({ where: { organizationId } }),
    db.workerReview.count({ where: { organizationId } }),
    db.workerMessage.count({ where: { organizationId } }),
    db.activityEvent.count({ where: { organizationId } }),
    db.usageRecord.count({ where: { organizationId } }),
  ]);
  return { jobs, specs, workers, versions, grants, runs, steps, modelCalls, toolCalls, approvals, deliverables, evaluations, reviews, messages, activity, usage };
}

describe("demo seed", () => {
  let summary: SeedSummary;
  let firstCounts: Awaited<ReturnType<typeof countsFor>>;
  let session: SessionContext;
  const startedAt = new Date();

  beforeAll(async () => {
    summary = await seedDemo(db);
    firstCounts = await countsFor(summary.organizationId);
    const user = await db.user.findUniqueOrThrow({ where: { id: summary.userId }, include: { organization: true } });
    session = { userId: user.id, organizationId: user.organizationId, organizationName: user.organization.name, role: user.role, name: user.name, email: user.email };
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: DEMO_IDS.organizationId } });
    await db.user.deleteMany({ where: { id: DEMO_IDS.userId } });
  });

  it("creates the demo org and a user who can sign in with the published credentials", async () => {
    const org = await db.organization.findUniqueOrThrow({ where: { slug: DEMO_USER.organizationSlug } });
    expect(org.id).toBe("org_demo");
    const user = await db.user.findUniqueOrThrow({ where: { email: DEMO_USER.email.toLowerCase() } });
    expect(user).toMatchObject({ id: "user_demo", organizationId: "org_demo", name: DEMO_USER.name, role: "OWNER" });
    expect(await verifyPassword(DEMO_USER.password, user.passwordHash)).toBe(true);
  });

  it("staffs Alex (healthy), Maya (healthy) and Sam (needs attention) with consistent schedules", async () => {
    const workers = await db.worker.findMany({ where: { organizationId: summary.organizationId }, include: { currentVersion: true, job: true } });
    const byName = Object.fromEntries(workers.map((w) => [w.name, w]));
    expect(Object.keys(byName).sort()).toEqual(["Alex", "Maya", "Sam"]);
    for (const w of workers) {
      expect(w.status).toBe("ACTIVE");
      expect(w.job.status).toBe("STAFFED");
      expect(w.currentVersion?.status).toBe("ACTIVE");
      expect(w.currentVersion?.lockedAt).not.toBeNull();
      expect(w.nextRunAt!.getTime()).toBeGreaterThan(startedAt.getTime());
      expect(w.lastRunAt).not.toBeNull();
      expect(w.score).not.toBeNull();
    }
    expect(byName.Alex).toMatchObject({ health: "HEALTHY", scheduleKind: "WEEKLY", scheduleHour: 9, scheduleDow: 1 });
    expect(byName.Alex.score!).toBeGreaterThanOrEqual(80);
    expect(byName.Maya).toMatchObject({ health: "HEALTHY", scheduleKind: "DAILY", scheduleHour: 8 });
    expect(byName.Sam).toMatchObject({ health: "NEEDS_ATTENTION", scheduleKind: "DAILY" });
    expect(byName.Sam.score!).toBeLessThan(65);
    expect(byName.Sam.healthReason).toMatch(/below the 65 threshold/);

    const alexRuns = await db.run.groupBy({ by: ["status"], where: { workerId: summary.workers.alex }, _count: { _all: true } });
    expect(alexRuns).toEqual([{ status: "SUCCEEDED", _count: { _all: 6 } }]);
    const alexMessages = await db.workerMessage.findMany({ where: { workerId: summary.workers.alex }, orderBy: { createdAt: "asc" } });
    expect(alexMessages.map((m) => `${m.role}:${m.classification}`)).toEqual(["USER:QUESTION", "WORKER:QUESTION", "USER:TEMPORARY_INSTRUCTION", "WORKER:TEMPORARY_INSTRUCTION"]);
    const instruction = alexMessages[2];
    expect(instruction.instructionActive).toBe(false);
    const applied = await db.run.findUniqueOrThrow({ where: { id: instruction.appliedToRunId! } });
    expect(applied).toMatchObject({ workerId: summary.workers.alex, trigger: "MANUAL", input: { instructions: [instruction.content] } });
  });

  it("holds exactly one pending approval on a WAITING run whose checkpoint resumes at the notifier", async () => {
    const pending = await db.approval.findMany({ where: { organizationId: summary.organizationId, status: "PENDING" } });
    expect(pending).toHaveLength(1);
    const [approval] = pending;
    expect(approval.id).toBe(summary.pendingApprovalId);
    expect(approval).toMatchObject({ toolName: "send_notification", workerId: summary.workers.maya, runId: summary.waitingRunId });
    expect(approval.title).toMatch(/^Send “Customer Feedback Report” to 1 recipient by email$/);
    expect(approval.payload).toMatchObject({ channel: "email", recipients: ["product@acme.example"], subject: "Customer Feedback Report" });

    const run = await db.run.findUniqueOrThrow({ where: { id: summary.waitingRunId }, include: { workerVersion: true } });
    expect(run).toMatchObject({ status: "WAITING_FOR_APPROVAL", lockedBy: null, finishedAt: null, simulated: true });
    expect(Date.now() - run.createdAt.getTime()).toBeLessThan(60 * 60_000);
    const blueprint = parseBlueprint(run.workerVersion.blueprint);
    const checkpoint = parseCheckpoint(run.checkpoint);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.componentIndex).toBe(blueprint.components.findIndex((c) => c.id === "notifier"));
    expect(checkpoint!.agent?.componentId).toBe("notifier");
    expect(checkpoint!.agent?.turn).toBe(1);
    expect(checkpoint!.agent?.pendingToolCalls).toHaveLength(1);
    expect(checkpoint!.agent?.pendingToolCalls[0]).toMatchObject({ toolCallId: approval.toolCallId, callId: "mock_0_0", toolName: "send_notification" });
    expect(checkpoint!.agent?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(checkpoint!.counters.activeMs).toBeGreaterThan(0);
    expect(Object.keys(checkpoint!.context)).toEqual(expect.arrayContaining(["job_brief", "instructions", "records", "stats", "insights", "report"]));

    const deliverable = await db.deliverable.findUniqueOrThrow({ where: { id: checkpoint!.deliverableId! } });
    expect(deliverable).toMatchObject({ runId: run.id, status: "PENDING_REVIEW", format: "MARKDOWN" });
    const toolCall = await db.toolCall.findUniqueOrThrow({ where: { id: approval.toolCallId }, include: { runStep: true } });
    expect(toolCall).toMatchObject({ status: "PENDING_APPROVAL", runId: run.id });
    expect(toolCall.runStep?.status).toBe("PENDING");
    const approvalStep = await db.runStep.findFirstOrThrow({ where: { runId: run.id, kind: "APPROVAL" } });
    expect(approvalStep).toMatchObject({ status: "WAITING", componentId: "notifier", title: approval.title, input: { approvalId: approval.id, toolCallId: approval.toolCallId } });
    expect(checkpoint!.nextStepIndex).toBe(approvalStep.index + 1);
  });

  it("gives Sam the record that justifies a replacement and nothing in flight", async () => {
    const version = await db.workerVersion.findFirstOrThrow({ where: { workerId: summary.workers.sam, status: "ACTIVE" } });
    const blueprint = parseBlueprint(version.blueprint);
    const collector = blueprint.components.find((c) => c.id === "collector");
    expect(collector?.type === "agent" && collector.modelTier).toBe("fast");
    expect(blueprint.components.some((c) => c.type === "deterministic" && (c.operation === "validate_records" || c.operation === "dedupe"))).toBe(false);

    const runs = await db.run.findMany({ where: { workerId: summary.workers.sam }, orderBy: { createdAt: "asc" } });
    expect(runs).toHaveLength(7);
    expect(runs.filter((r) => r.status === "FAILED")).toHaveLength(3);
    expect(runs.filter((r) => r.status === "SUCCEEDED")).toHaveLength(4);
    expect(runs.every((r) => r.status === "FAILED" || r.status === "SUCCEEDED")).toBe(true);
    for (const failed of runs.filter((r) => r.status === "FAILED")) {
      expect(failed.error).toMatch(/did not return valid JSON|would exceed its limit of 12 tool calls/);
      const errorSteps = await db.runStep.count({ where: { runId: failed.id, kind: "ERROR", status: "FAILED" } });
      expect(errorSteps).toBe(failed.attempt);
    }

    const rejected = await db.deliverable.findMany({ where: { workerId: summary.workers.sam, status: "REJECTED" } });
    expect(rejected).toHaveLength(2);
    for (const d of rejected) expect(d.feedback).toMatch(/companies — the brief asks for 10/);
    const judges = await db.evaluation.findMany({ where: { workerId: summary.workers.sam, type: "LLM_JUDGE" } });
    expect(judges).toHaveLength(4);
    for (const j of judges) expect(j.score).toBeLessThan(0.75);

    const reviews = await db.workerReview.findMany({ where: { workerId: summary.workers.sam } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0].recommendation).toBe("REPLACE");
    const messages = await db.workerMessage.findMany({ where: { workerId: summary.workers.sam }, orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => m.role)).toEqual(["USER", "WORKER"]);
  });

  it("writes runs the way the executor does: steps, traced calls, and usage that sums to the run rollups", async () => {
    const runs = await db.run.findMany({ where: { organizationId: summary.organizationId }, include: { steps: true, modelCalls: true, toolCalls: true } });
    const usage = await db.usageRecord.findMany({ where: { organizationId: summary.organizationId, runId: { not: null } } });
    for (const run of runs) {
      const rows = usage.filter((u) => u.runId === run.id);
      const cost = rows.reduce((s, u) => s + Number(u.costUsd), 0);
      expect(cost).toBeCloseTo(Number(run.costUsd), 6);
      expect(rows.reduce((s, u) => s + u.inputTokens, 0)).toBe(run.inputTokens);
      expect(rows.reduce((s, u) => s + u.outputTokens, 0)).toBe(run.outputTokens);
      for (const u of rows) {
        expect(u.simulated).toBe(true);
        expect(Number(u.billableUsd)).toBeCloseTo(Number(u.costUsd) * 1.4, 5);
      }
      const indexes = run.steps.map((s) => s.index).sort((a, b) => a - b);
      expect(indexes).toEqual(indexes.map((_, i) => i));
      for (const call of run.modelCalls.filter((m) => m.purpose === "agent.turn")) expect(call.runStepId).not.toBeNull();
      for (const call of run.toolCalls) expect(call.runStepId).not.toBeNull();
      if (run.status === "SUCCEEDED") {
        expect(run.durationMs).toBeGreaterThanOrEqual(30_000);
        expect(run.durationMs).toBeLessThanOrEqual(180_000);
        expect(run.steps.map((s) => s.kind)).toEqual(expect.arrayContaining(["MODEL_CALL", "TOOL_CALL", "DETERMINISTIC", "DELIVERABLE", "EVALUATION"]));
        const types = await db.evaluation.findMany({ where: { runId: run.id }, select: { type: true } });
        expect(types.map((t) => t.type)).toEqual(expect.arrayContaining(["DETERMINISTIC", "LLM_JUDGE"]));
      }
    }
  });

  it("spreads history over the last three weeks, with the newest activity in the last hour and every link resolving", async () => {
    const items = await listActivity(summary.organizationId, { limit: 500 });
    expect(items.length).toBeGreaterThan(50);
    const now = Date.now();
    for (const item of items) {
      const at = new Date(item.createdAt).getTime();
      expect(at).toBeLessThanOrEqual(now);
      expect(at).toBeGreaterThan(now - 22 * DAY_MS);
    }
    expect(now - new Date(items[0].createdAt).getTime()).toBeLessThan(60 * 60_000);
    const types = new Set(items.map((i) => i.type));
    for (const type of ["WORKER_HIRED", "RUN_SUCCEEDED", "RUN_FAILED", "DELIVERABLE_ACCEPTED", "DELIVERABLE_REJECTED", "APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED", "EVALUATION_COMPLETED", "REVIEW_GENERATED", "INSTRUCTION_RECEIVED", "TOOL_USED", "JOB_SPEC_APPROVED"] as const) {
      expect(types.has(type), type).toBe(true);
    }
    expect(items.find((i) => i.type === "WORKER_HIRED")?.actorName).toBe(DEMO_USER.name);
    expect(items.find((i) => i.type === "DELIVERABLE_ACCEPTED")?.actorName).toBe(DEMO_USER.name);
    expect(items.find((i) => i.type === "RUN_SUCCEEDED")?.actorType).toBe("WORKER");

    const org = summary.organizationId;
    for (const item of items) {
      expect(item.href, item.type).not.toBeNull();
      const [, area, id, sub, subId] = item.href!.split("/");
      const exists =
        area === "approvals"
          ? true
          : area === "deliverables"
            ? await db.deliverable.count({ where: { id, organizationId: org } })
            : area === "runs"
              ? await db.run.count({ where: { id, organizationId: org } })
              : area === "jobs"
                ? await db.job.count({ where: { id, organizationId: org } })
                : area === "workers" && sub === "replace"
                  ? await db.workerVersion.count({ where: { id: subId, worker: { id, organizationId: org } } })
                  : area === "workers"
                    ? await db.worker.count({ where: { id, organizationId: org } })
                    : 0;
      expect(exists, item.href!).toBeTruthy();
    }
  });

  it("lists a job ready to hire and a draft job waiting on intake answers", async () => {
    const pricing = await db.job.findUniqueOrThrow({ where: { id: summary.jobs.pricing }, include: { specs: true, workers: true } });
    expect(pricing).toMatchObject({ status: "SPEC_APPROVED", title: "Weekly competitor pricing check" });
    expect(pricing.workers).toHaveLength(0);
    expect(pricing.specs.map((s) => s.status)).toEqual(["APPROVED"]);
    const triage = await db.job.findUniqueOrThrow({ where: { id: summary.jobs.triage }, include: { specs: true } });
    expect(triage.status).toBe("DRAFT");
    expect(triage.specs).toHaveLength(0);
    expect((triage.intake as { questions: unknown[] }).questions.length).toBeGreaterThan(0);
  });

  it("demo path: approving Maya's request resumes the real executor, sends once and finishes the run", async () => {
    await decideApproval({ organizationId: summary.organizationId, approvalId: summary.pendingApprovalId, userId: summary.userId, decision: "approve" });
    const outcome = await executeRun(summary.waitingRunId);
    expect(outcome.status).toBe("SUCCEEDED");

    const run = await db.run.findUniqueOrThrow({ where: { id: summary.waitingRunId } });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.durationMs).toBeGreaterThan(0);
    const sends = await db.toolCall.findMany({ where: { runId: run.id, toolName: "send_notification" } });
    expect(sends).toHaveLength(1);
    expect(sends[0].status).toBe("SUCCEEDED");
    expect(await db.usageRecord.count({ where: { runId: run.id, kind: "TOOL", resource: "send_notification" } })).toBe(1);
    expect(await db.deliverable.count({ where: { runId: run.id } })).toBe(1);
    expect(await db.evaluation.count({ where: { runId: run.id, type: { in: ["DETERMINISTIC", "LLM_JUDGE"] } } })).toBe(2);
    const steps = await db.runStep.findMany({ where: { runId: run.id }, orderBy: { index: "asc" } });
    expect(steps.filter((s) => s.status === "WAITING" || s.status === "PENDING" || s.status === "RUNNING")).toHaveLength(0);
    expect(steps.at(-1)?.kind).toBe("EVALUATION");
    const cp = parseCheckpoint(run.checkpoint);
    expect(cp?.context.notification_status).toMatch(/Sent "Customer Feedback Report" by email to 1 recipient/);
    expect(await db.approval.count({ where: { organizationId: summary.organizationId, status: "PENDING" } })).toBe(0);
  });

  it("seeded history has the same shape as a live run of the same worker (guards emulator drift)", async () => {
    const shape = (steps: Array<{ kind: string; componentId: string | null; status: string }>) => steps.map((s) => `${s.kind}:${s.componentId ?? "-"}:${s.status}`);
    const seeded = await db.run.findFirstOrThrow({
      where: { workerId: summary.workers.alex, status: "SUCCEEDED", trigger: "SCHEDULED" },
      include: { steps: { orderBy: { index: "asc" } } },
    });
    const { runId } = await enqueueRun({ organizationId: summary.organizationId, workerId: summary.workers.alex, trigger: "MANUAL", requestedById: summary.userId });
    expect((await executeRun(runId)).status).toBe("SUCCEEDED");
    const live = await db.runStep.findMany({ where: { runId }, orderBy: { index: "asc" } });
    expect(shape(live)).toEqual(shape(seeded.steps));
    expect(live.map((s) => s.title).filter((t) => t.includes("is thinking"))).toEqual(seeded.steps.map((s) => s.title).filter((t) => t.includes("is thinking")));

    // Maya: a live pause → approve → resume leaves the same trace as a seeded, approved run.
    const approvedRun = await db.approval.findFirstOrThrow({ where: { workerId: summary.workers.maya, status: "APPROVED", run: { trigger: "SCHEDULED" } }, select: { runId: true } });
    const seededMaya = await db.runStep.findMany({ where: { runId: approvedRun.runId }, orderBy: { index: "asc" } });
    const maya = await enqueueRun({ organizationId: summary.organizationId, workerId: summary.workers.maya, trigger: "MANUAL", requestedById: summary.userId });
    const paused = await executeRun(maya.runId);
    expect(paused.status).toBe("WAITING_FOR_APPROVAL");
    if (paused.status !== "WAITING_FOR_APPROVAL") throw new Error("unreachable");
    await decideApproval({ organizationId: summary.organizationId, approvalId: paused.approvalIds[0], userId: summary.userId, decision: "approve" });
    expect((await executeRun(maya.runId)).status).toBe("SUCCEEDED");
    const liveMaya = await db.runStep.findMany({ where: { runId: maya.runId }, orderBy: { index: "asc" } });
    expect(shape(liveMaya)).toEqual(shape(seededMaya));
    const toolUsed = await db.activityEvent.count({ where: { runId: approvedRun.runId, type: "TOOL_USED" } });
    expect(toolUsed).toBe(await db.activityEvent.count({ where: { runId: maya.runId, type: "TOOL_USED" } }));
  });

  it("demo path: replacing Sam proposes a standard-tier researcher with validation and de-duplication", async () => {
    const { versionId } = await proposeReplacement(session, summary.workers.sam);
    const version = await db.workerVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version).toMatchObject({ status: "PROPOSED", version: 2, changeReason: "REPLACEMENT" });
    const blueprint = parseBlueprint(version.blueprint);
    const collector = blueprint.components.find((c) => c.id === "collector");
    expect(collector?.type === "agent" && collector.modelTier).toBe("standard");
    const ops = blueprint.components.flatMap((c) => (c.type === "deterministic" ? [c.operation] : []));
    expect(ops).toEqual(expect.arrayContaining(["validate_records", "dedupe"]));
    expect(version.analysis).toMatchObject({ basedOn: { failedRuns: 3, rejectedDeliverables: 2 } });
  });

  it("re-seeding rebuilds the same workspace", async () => {
    const again = await seedDemo(db);
    expect(again.organizationId).toBe(summary.organizationId);
    expect(again.workers).toEqual(summary.workers);
    expect(await countsFor(again.organizationId)).toEqual(firstCounts);
    expect(await db.approval.count({ where: { organizationId: again.organizationId, status: "PENDING" } })).toBe(1);
  });
});
