import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, toJson } from "@/server/db";
import { recordDeliverableFeedback } from "@/server/evaluation";
import {
  getChatExchange,
  getReplacePageData,
  getWorkerChat,
  getWorkerDebug,
  getWorkerPermissions,
  getWorkerVersions,
  replaceHref,
} from "@/server/queries/worker-manage";
import { hireReplacement, proposeReplacement, rejectProposedVersion, sendMessageToWorker, updateToolGrant } from "@/server/workers";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { createDeliverable, createJudgeEvaluation, createRun, daysAgo, records, type Hired, type TestOrg } from "../workers/helpers";

/**
 * Read models behind the worker profile's manage tabs and the replace page. Every query is org-scoped through
 * the Worker row, returns plain JSON, and must reflect what the workers module just wrote.
 */

describe("worker-manage queries", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeEach(async () => {
    t = await createTestOrg("pages-worker-manage");
    hired = await createHiredWorker(t.organization.id, { userId: t.user.id, collectorTier: "fast", withCleaning: false, withNotifier: true });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  async function seedPoorRecord() {
    await createRun(hired, { status: "FAILED", createdAt: daysAgo(12), error: "Collector produced no JSON array" });
    await createRun(hired, { status: "FAILED", createdAt: daysAgo(8), error: "Collector produced no JSON array" });
    const good = await createRun(hired, { status: "SUCCEEDED", createdAt: daysAgo(5) });
    const deliverable = await createDeliverable(hired, good.id, { title: "Weekly AI Infra Funding Report — Sep 13", data: records(4) });
    await createJudgeEvaluation(hired, { runId: good.id, deliverableId: deliverable.id, score: 0.45, reasoning: "Half the rounds lack an amount." });
    await recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "reject", feedback: "Only 4 rounds and two of them are duplicates; I need the amounts." });
    return good;
  }

  describe("getWorkerPermissions", () => {
    it("joins grants with registry metadata and the blueprint's reasons", async () => {
      const view = await getWorkerPermissions(t.organization.id, hired.worker.id);
      expect(view.worker).toMatchObject({ id: hired.worker.id, name: "Alex", status: "ACTIVE" });
      expect(view.grants.map((g) => g.toolName)).toEqual(["web_search", "fetch_url", "extract_data", "send_notification"]);

      const search = view.grants.find((g) => g.toolName === "web_search")!;
      expect(search).toMatchObject({
        displayName: expect.any(String),
        category: "research",
        sideEffect: "external_read",
        defaultRequiresApproval: false,
        reason: "Find funding announcements",
        inBlueprint: true,
        hasGrant: true,
        requiresApproval: false,
        revoked: false,
        revokedAt: null,
      });
      expect(search.humanDescription.length).toBeGreaterThan(0);

      const notify = view.grants.find((g) => g.toolName === "send_notification")!;
      expect(notify).toMatchObject({ category: "communication", sideEffect: "external_write", defaultRequiresApproval: true, requiresApproval: true });

      expect(view.schedule).toEqual({ kind: "weekly", hour: 9, dayOfWeek: 1 });
      expect(view.scheduleLabel).toBe("Weekly on Monday at 9am");
      expect(view.limits).toEqual(hired.blueprint.limits);
      expect(view.estimatedCostPerRunUsd).toBe(hired.blueprint.costEstimate.perRunUsd);
      expect(view.currentVersion).toEqual({ id: hired.version.id, version: 1 });
    });

    it("reflects revocations and approval changes, and keeps grants the design no longer mentions", async () => {
      await updateToolGrant(t.session, hired.worker.id, "fetch_url", { revoked: true });
      await updateToolGrant(t.session, hired.worker.id, "web_search", { requiresApproval: true });
      await updateToolGrant(t.session, hired.worker.id, "calculator", { requiresApproval: false });

      const view = await getWorkerPermissions(t.organization.id, hired.worker.id);
      const fetch = view.grants.find((g) => g.toolName === "fetch_url")!;
      expect(fetch.revoked).toBe(true);
      expect(fetch.revokedAt).toEqual(expect.any(String));
      expect(view.grants.find((g) => g.toolName === "web_search")?.requiresApproval).toBe(true);

      // A grant outside the blueprint is listed last with no reason.
      const calc = view.grants.at(-1)!;
      expect(calc).toMatchObject({ toolName: "calculator", inBlueprint: false, hasGrant: true, reason: null });
    });

    it("is org-scoped", async () => {
      const other = await createTestOrg("pages-worker-manage-other");
      try {
        await expect(getWorkerPermissions(other.organization.id, hired.worker.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("getWorkerChat / getChatExchange", () => {
    it("returns the conversation with classification chips, proposal links and the queued-instruction count", async () => {
      const q = await sendMessageToWorker(t.session, hired.worker.id, "What did you do in your last run?");
      const i = await sendMessageToWorker(t.session, hired.worker.id, "This time, focus on European companies");
      const c = await sendMessageToWorker(t.session, hired.worker.id, "From now on, include the lead investor for every round");
      expect(c.proposedVersionId).toBeDefined();

      const view = await getWorkerChat(t.organization.id, hired.worker.id);
      expect(view.worker.id).toBe(hired.worker.id);
      expect(view.pendingInstructions).toBe(1);
      expect(view.messages.map((m) => m.id)).toEqual([q.userMessageId, q.replyMessageId, i.userMessageId, i.replyMessageId, c.userMessageId, c.replyMessageId]);
      expect(view.messages.map((m) => m.role)).toEqual(["USER", "WORKER", "USER", "WORKER", "USER", "WORKER"]);

      const [question, answer, instruction, ack, change, proposal] = view.messages;
      expect(question.classification).toBe("QUESTION");
      expect(answer.content.length).toBeGreaterThan(0);
      expect(answer.simulated).toBe(true);
      expect(answer.href).toBeNull();
      expect(instruction.classification).toBe("TEMPORARY_INSTRUCTION");
      expect(instruction.normalizedInstruction).toBe("Focus on European companies");
      expect(ack.href).toBeNull();
      expect(change.classification).toBe("SPEC_CHANGE");
      expect(proposal).toMatchObject({
        proposedVersionId: c.proposedVersionId,
        proposedVersion: 2,
        proposalStatus: "PROPOSED",
        href: replaceHref(hired.worker.id, c.proposedVersionId!),
      });
      for (const m of view.messages) expect(new Date(m.createdAt).toString()).not.toBe("Invalid Date");

      // The exchange fetch returns exactly the two rows, oldest first, with the same view shape.
      const exchange = await getChatExchange(t.organization.id, hired.worker.id, [c.replyMessageId, c.userMessageId]);
      expect(exchange.map((m) => m.id)).toEqual([c.userMessageId, c.replyMessageId]);
      expect(exchange[1]).toEqual(proposal);
      expect(await getChatExchange(t.organization.id, hired.worker.id, [])).toEqual([]);
    });

    it("shows the proposal's later status on the reply and hides other orgs' messages", async () => {
      const c = await sendMessageToWorker(t.session, hired.worker.id, "From now on, run daily at 8am");
      await rejectProposedVersion(t.session, c.proposedVersionId!);
      const view = await getWorkerChat(t.organization.id, hired.worker.id);
      expect(view.messages.at(-1)?.proposalStatus).toBe("REJECTED");

      const other = await createTestOrg("pages-worker-manage-other");
      try {
        await expect(getWorkerChat(other.organization.id, hired.worker.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(getChatExchange(other.organization.id, hired.worker.id, [c.userMessageId])).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("getWorkerVersions", () => {
    it("lists versions newest first with review/compare links and the open proposal", async () => {
      await seedPoorRecord();
      const before = await getWorkerVersions(t.organization.id, hired.worker.id);
      expect(before.versions.map((v) => v.version)).toEqual([1]);
      expect(before.versions[0]).toMatchObject({ status: "ACTIVE", changeReason: "INITIAL_HIRE", isCurrent: true, runCount: 3, href: null, parentVersionId: null });
      expect(before.versions[0].score).not.toBeNull();
      expect(before.versions[0].successRate).toBeCloseTo(1 / 3, 3);
      expect(before.versions[0].avgCostPerRunUsd).toBeCloseTo(0.12, 3);
      expect(before.versions[0].tiers).toEqual(expect.arrayContaining([{ componentId: "collector", name: "Researcher", tier: "fast" }]));
      expect(before.versions[0].toolNames).toEqual(["web_search", "fetch_url", "extract_data", "send_notification"]);
      expect(before.openProposal).toBeNull();
      expect(before.canPropose).toBe(true);

      const { versionId } = await proposeReplacement(t.session, hired.worker.id);
      const after = await getWorkerVersions(t.organization.id, hired.worker.id);
      expect(after.versions.map((v) => v.version)).toEqual([2, 1]);
      const proposed = after.versions[0];
      expect(proposed).toMatchObject({
        id: versionId,
        status: "PROPOSED",
        changeReason: "REPLACEMENT",
        isCurrent: false,
        locked: false,
        runCount: 0,
        score: null,
        successRate: null,
        avgCostPerRunUsd: null,
        parentVersionId: hired.version.id,
        href: replaceHref(hired.worker.id, versionId),
      });
      expect(proposed.tiers.find((c) => c.componentId === "collector")?.tier).toBe("standard");
      expect(proposed.stepCount).toBeGreaterThan(before.versions[0].stepCount);
      expect(proposed.estimatedCostPerRunUsd).toBeGreaterThan(0);
      expect(after.openProposal).toEqual({ id: versionId, version: 2, changeReason: "REPLACEMENT", href: replaceHref(hired.worker.id, versionId) });
    });

    it("cannot propose for a retired worker and is org-scoped", async () => {
      await db.worker.update({ where: { id: hired.worker.id }, data: { status: "RETIRED", retiredAt: new Date() } });
      const view = await getWorkerVersions(t.organization.id, hired.worker.id);
      expect(view.canPropose).toBe(false);
      const other = await createTestOrg("pages-worker-manage-other");
      try {
        await expect(getWorkerVersions(other.organization.id, hired.worker.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("getWorkerDebug", () => {
    it("exposes the blueprint, the latest checkpoint, recent model/tool calls and raw grants", async () => {
      const run = await createRun(hired, { status: "SUCCEEDED", createdAt: daysAgo(1) });
      await db.run.update({ where: { id: run.id }, data: { checkpoint: toJson({ componentIndex: 2, nextStepIndex: 4, context: {}, counters: { activeMs: 1200 } }) } });
      await db.toolCall.create({
        data: { runId: run.id, workerId: hired.worker.id, toolName: "web_search", callId: "call_1", input: toJson({ query: "AI infra funding" }), output: toJson({ results: [] }), status: "SUCCEEDED", attempt: 1, latencyMs: 40, costUsd: 0.001, simulated: true },
      });
      // A chat reply is the cheapest way to produce real ModelCall rows through the models module.
      await sendMessageToWorker(t.session, hired.worker.id, "What did you do in your last run?");

      const view = await getWorkerDebug(t.organization.id, hired.worker.id);
      expect(view.currentVersion).toMatchObject({ id: hired.version.id, version: 1, status: "ACTIVE", locked: false });
      expect(view.blueprintValid).toBe(true);
      expect((view.blueprint as { persona: { name: string } }).persona.name).toBe("Alex");
      expect(view.latestRun).toMatchObject({ id: run.id, status: "SUCCEEDED", trigger: "MANUAL", attempt: 1, simulated: true });
      expect((view.latestRun?.checkpoint as { componentIndex: number }).componentIndex).toBe(2);

      expect(view.modelCalls.length).toBeGreaterThanOrEqual(2);
      expect(view.modelCalls.map((c) => c.purpose)).toEqual(expect.arrayContaining(["chat.classify", "chat.reply"]));
      for (const call of view.modelCalls) {
        expect(call.simulated).toBe(true);
        expect(call.provider).toBe("mock");
        expect(typeof call.costUsd).toBe("number");
        expect(call.request).not.toBeNull();
      }
      expect(view.toolCalls).toHaveLength(1);
      expect(view.toolCalls[0]).toMatchObject({ runId: run.id, toolName: "web_search", status: "SUCCEEDED", costUsd: 0.001, simulated: true });
      expect(view.grants.map((g) => g.toolName)).toEqual(["extract_data", "fetch_url", "send_notification", "web_search"]);
      expect(view.grants[0].createdAt).toEqual(expect.any(String));
    });

    it("tolerates a worker with no runs and keeps other orgs out", async () => {
      const view = await getWorkerDebug(t.organization.id, hired.worker.id);
      expect(view.latestRun).toBeNull();
      expect(view.modelCalls).toEqual([]);
      expect(view.toolCalls).toEqual([]);
      const other = await createTestOrg("pages-worker-manage-other");
      try {
        await expect(getWorkerDebug(other.organization.id, hired.worker.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await other.cleanup();
      }
    });
  });

  describe("getReplacePageData", () => {
    it("builds the replacement review: analysis, deltas, side-by-side cards and the diff", async () => {
      await seedPoorRecord();
      const { versionId } = await proposeReplacement(t.session, hired.worker.id);
      const page = await getReplacePageData(t.organization.id, hired.worker.id, versionId);

      expect(page.worker).toMatchObject({ id: hired.worker.id, name: "Alex", status: "ACTIVE" });
      expect(page.changeReason).toBe("REPLACEMENT");
      expect(page.canDecide).toBe(true);
      expect(page.simulated).toBe(true);
      expect(page.analysis).not.toBeNull();
      expect(page.analysis?.basedOn).toEqual({ runs: 3, failedRuns: 2, evaluations: 2, rejectedDeliverables: 1, windowDays: 30 });
      expect(page.deltas?.source).toBe("analysis");
      expect(page.deltas?.qualityPct).toEqual(expect.any(Number));
      // Cost is grounded in the two blueprints' estimates, never the plan's guess, so it agrees with the $ shown.
      const expectedCostPct = ((page.target.costPerRunUsd - page.base!.costPerRunUsd) / page.base!.costPerRunUsd) * 100;
      expect(page.deltas?.costPct).toBeCloseTo(expectedCostPct, 6);

      expect(page.base?.id).toBe(hired.version.id);
      expect(page.base?.trackRecord?.runs).toBe(3);
      expect(page.base?.steps.find((s) => s.id === "collector")?.tier).toBe("fast");
      expect(page.target.id).toBe(versionId);
      expect(page.target.trackRecord).toBeNull();
      expect(page.target.steps.find((s) => s.id === "collector")?.tier).toBe("standard");
      expect(page.target.steps.map((s) => s.id)).toEqual(expect.arrayContaining(["validate_records", "dedupe"]));
      expect(page.target.tools.map((x) => x.toolName)).toEqual(page.base?.tools.map((x) => x.toolName));
      expect(page.target.kpis.length).toBeGreaterThan(0);
      expect(page.target.costPerRunUsd).toBeGreaterThan(0);
      expect(page.target.limits).toEqual(hired.blueprint.limits);

      expect(page.diff.some((e) => e.path === "components.collector.modelTier" && e.kind === "changed")).toBe(true);
      expect(page.diff.some((e) => e.path === "components.validate_records" && e.kind === "added")).toBe(true);
    });

    it("stays viewable after the decision, treats a worker mismatch as missing, and derives cost-only deltas for spec changes", async () => {
      await seedPoorRecord();
      const { versionId } = await proposeReplacement(t.session, hired.worker.id);
      await hireReplacement(t.session, versionId, { startFirstRun: false });

      const after = await getReplacePageData(t.organization.id, hired.worker.id, versionId);
      expect(after.canDecide).toBe(false);
      expect(after.target.status).toBe("ACTIVE");
      expect(after.target.activatedAt).toEqual(expect.any(String));
      expect(after.base?.id).toBe(hired.version.id);
      expect(after.base?.status).toBe("REPLACED");

      const stranger = await createHiredWorker(t.organization.id, { userId: t.user.id, name: "Maya" });
      await expect(getReplacePageData(t.organization.id, stranger.worker.id, versionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(getReplacePageData(t.organization.id, hired.worker.id, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });

      const change = await sendMessageToWorker(t.session, hired.worker.id, "From now on, run daily at 8am");
      const spec = await getReplacePageData(t.organization.id, hired.worker.id, change.proposedVersionId!);
      expect(spec.changeReason).toBe("SPEC_CHANGE");
      expect(spec.analysis).toBeNull();
      expect(spec.simulated).toBe(false);
      expect(spec.deltas).toMatchObject({ source: "estimate", qualityPct: null, latencyPct: null });
      expect(spec.base?.id).toBe(versionId);
      expect(spec.target.scheduleLabel).toBe("Daily at 8am");
      expect(spec.diff.some((e) => e.path === "schedule")).toBe(true);
    });
  });
});
