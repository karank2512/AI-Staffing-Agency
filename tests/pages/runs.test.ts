import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, toJson } from "@/server/db";
import { AppError } from "@/server/errors";
import { recordDeliverableFeedback } from "@/server/evaluation";
import { decideApproval, enqueueRun, executeRun } from "@/server/runtime";
import {
  columnsFor,
  countDeliverables,
  csvHeader,
  getDeliverableDetail,
  getDeliverableFile,
  listDeliverableWorkers,
  listDeliverables,
  parseCsvRows,
  parseJsonRows,
  rowsFor,
  slugifyFilename,
} from "@/server/queries/deliverables";
import { EVALUATION_GRACE_MS, activeTimeMs, getRunDetail, getRunLiveView, isEvaluationPending, isRunStatus, listRunWorkers, listRuns } from "@/server/queries/runs";
import { buildDataTableModel } from "@/lib/cell-format";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;
type Hired = Awaited<ReturnType<typeof createHiredWorker>>;

const expectNotFound = async (p: Promise<unknown>) => {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === "NOT_FOUND");
};

/** A hand-written terminal run (no executor) for the evaluationPending / listing cases. */
async function createRun(t: TestOrg, hired: Hired, opts: { status?: "SUCCEEDED" | "FAILED" | "CANCELLED" | "QUEUED"; finishedAt?: Date | null; simulated?: boolean } = {}) {
  const status = opts.status ?? "SUCCEEDED";
  const terminal = status !== "QUEUED";
  const finishedAt = opts.finishedAt === undefined ? (terminal ? new Date() : null) : opts.finishedAt;
  return db.run.create({
    data: {
      organizationId: t.organization.id,
      jobId: hired.job.id,
      workerId: hired.worker.id,
      workerVersionId: hired.version.id,
      status,
      trigger: "MANUAL",
      simulated: opts.simulated ?? true,
      costUsd: 0.1234,
      inputTokens: 1200,
      outputTokens: 300,
      durationMs: terminal ? 4_200 : null,
      startedAt: terminal ? new Date(Date.now() - 10_000) : null,
      finishedAt,
      input: toJson({ instructions: ["Focus on seed rounds"], params: {} }),
    },
  });
}

describe("pages/runs: pure helpers", () => {
  it("isEvaluationPending: SUCCEEDED + no automated verdict + recent → true; otherwise false", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const recent = new Date(now.getTime() - 30_000);
    const old = new Date(now.getTime() - EVALUATION_GRACE_MS - 1);
    expect(isEvaluationPending("SUCCEEDED", recent, [], now)).toBe(true);
    expect(isEvaluationPending("SUCCEEDED", recent, [{ type: "USER_FEEDBACK" }], now)).toBe(true);
    expect(isEvaluationPending("SUCCEEDED", recent, [{ type: "DETERMINISTIC" }], now)).toBe(false);
    expect(isEvaluationPending("SUCCEEDED", recent, [{ type: "LLM_JUDGE" }], now)).toBe(false);
    expect(isEvaluationPending("SUCCEEDED", old, [], now)).toBe(false);
    expect(isEvaluationPending("SUCCEEDED", null, [], now)).toBe(false);
    expect(isEvaluationPending("RUNNING", recent, [], now)).toBe(false);
    expect(isEvaluationPending("FAILED", recent, [], now)).toBe(false);
    expect(isEvaluationPending("CANCELLED", recent, [], now)).toBe(false);
  });

  it("isRunStatus guards search params", () => {
    expect(isRunStatus("RUNNING")).toBe(true);
    expect(isRunStatus("WAITING_FOR_APPROVAL")).toBe(true);
    expect(isRunStatus("nope")).toBe(false);
    expect(isRunStatus(undefined)).toBe(false);
  });

  it("deliverable rows: CSV and JSON text become records; stored data wins; markdown has no rows", () => {
    expect(parseCsvRows("company,amount\nAcme,10\nBeta,20\n")).toEqual([
      { company: "Acme", amount: 10 },
      { company: "Beta", amount: 20 },
    ]);
    expect(parseCsvRows("   ")).toBeNull();
    expect(parseJsonRows('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseJsonRows('{"records":[{"a":1}]}')).toEqual([{ a: 1 }]);
    expect(parseJsonRows('{"a":1}')).toBeNull();
    expect(parseJsonRows("not json")).toBeNull();
    expect(rowsFor("CSV", "x,y\n1,2", [{ stored: true }])).toEqual([{ stored: true }]);
    expect(rowsFor("CSV", "x,y\n1,2", null)).toEqual([{ x: 1, y: 2 }]);
    expect(rowsFor("MARKDOWN", "# Report", null)).toBeNull();
    expect(rowsFor("JSON", "[]", null)).toBeNull();
  });

  it("activeTimeMs: the final duration wins; otherwise the checkpoint's running total, read defensively", () => {
    expect(activeTimeMs(4_200, { counters: { activeMs: 9_999 } })).toBe(4_200);
    expect(activeTimeMs(0, null)).toBe(0);
    expect(activeTimeMs(null, { counters: { activeMs: 1_234.6 } })).toBe(1_235);
    // Nothing done yet, or nothing usable to read → still unknown.
    expect(activeTimeMs(null, { counters: { activeMs: 0 } })).toBeNull();
    expect(activeTimeMs(null, null)).toBeNull();
    expect(activeTimeMs(null, undefined)).toBeNull();
    expect(activeTimeMs(null, "garbage")).toBeNull();
    expect(activeTimeMs(null, { counters: null })).toBeNull();
    expect(activeTimeMs(null, { counters: { activeMs: "12" } })).toBeNull();
    expect(activeTimeMs(null, { counters: { activeMs: Number.NaN } })).toBeNull();
    expect(activeTimeMs(null, { version: 1 })).toBeNull();
  });

  it("columnsFor: CSV header, JSON text order or spec fields — never the jsonb key order of stored records", () => {
    // Stored records as Postgres jsonb hands them back: shorter keys first, then alphabetical.
    const jsonbRow = { hq: "Austin, TX", rank: 1, stage: "Series B", company: "Halcyon", category: "GPU Cloud", amount_usd: 85_000_000, source_url: "https://x.example" };
    const csv = "rank,company,category,stage,amount_usd,hq,source_url\n1,Halcyon,GPU Cloud,Series B,85000000,\"Austin, TX\",https://x.example\n";
    expect(csvHeader(csv)).toEqual(["rank", "company", "category", "stage", "amount_usd", "hq", "source_url"]);
    expect(csvHeader("  \n")).toEqual([]);
    expect(columnsFor("CSV", csv, [jsonbRow])).toEqual(["rank", "company", "category", "stage", "amount_usd", "hq", "source_url"]);

    // Markdown: the spec's field order, with the ranking the worker added up front and unknown extras at the end.
    const spec = ["company", "category", "stage", "amount_usd", "lead_investor", "source_url"];
    expect(columnsFor("MARKDOWN", "# Report", [jsonbRow], spec)).toEqual(["rank", "company", "category", "stage", "amount_usd", "source_url", "hq"]);
    // A spec that names `rank` itself keeps it where the spec put it.
    expect(columnsFor("MARKDOWN", "# Report", [jsonbRow], ["company", "rank"])).toEqual(["company", "rank", "hq", "stage", "category", "amount_usd", "source_url"]);

    // JSON: key order as written in the content (JSON.parse keeps it), stored order ignored.
    const json = JSON.stringify([{ company: "Halcyon", stage: "Series B", rank: 1 }]);
    expect(columnsFor("JSON", json, [{ rank: 1, stage: "Series B", company: "Halcyon" }])).toEqual(["company", "stage", "rank"]);
    expect(columnsFor("JSON", JSON.stringify({ records: [{ b: 1, a: 2 }] }), [{ a: 2, b: 1 }])).toEqual(["b", "a"]);

    // A CSV header that doesn't match the records falls back to the spec; keys missing from every row are dropped.
    expect(columnsFor("CSV", "Company,Stage\nA,B", [{ stage: "B", company: "A" }], ["company", "stage", "amount_usd"])).toEqual(["company", "stage"]);
    // Nothing to go on: first-seen order, still rank first.
    expect(columnsFor("MARKDOWN", "", [{ hq: "x", rank: 2 }, { hq: "y", rank: 1, extra: true }])).toEqual(["rank", "hq", "extra"]);
    expect(columnsFor("MARKDOWN", "", [])).toEqual([]);
  });

  it("slugifyFilename produces safe ASCII filenames", () => {
    expect(slugifyFilename("Weekly AI Infra Funding Report — 2026-09-17")).toBe("weekly-ai-infra-funding-report-2026-09-17");
    expect(slugifyFilename("Café résumé!")).toBe("cafe-resume");
    expect(slugifyFilename("!!!")).toBe("deliverable");
  });
});

describe("pages/runs: live view + detail over a real run", () => {
  let t: TestOrg;
  let other: TestOrg;
  let hired: Hired;
  let runId: string;
  let approvalId: string;

  beforeAll(async () => {
    t = await createTestOrg("pages-runs");
    other = await createTestOrg("pages-runs-other");
    hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    const queued = await enqueueRun({ organizationId: t.organization.id, workerId: hired.worker.id, trigger: "MANUAL", input: { instructions: ["Keep it to the top 5"] }, requestedById: t.user.id });
    runId = queued.runId;
    const outcome = await executeRun(runId);
    expect(outcome.status).toBe("WAITING_FOR_APPROVAL");
    if (outcome.status !== "WAITING_FOR_APPROVAL") throw new Error("unreachable");
    approvalId = outcome.approvalIds[0]!;
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("org scoping: another organization cannot see the run or its deliverable", async () => {
    await expectNotFound(getRunLiveView(other.organization.id, runId));
    await expectNotFound(getRunDetail(other.organization.id, runId));
    const deliverable = await db.deliverable.findFirstOrThrow({ where: { runId }, select: { id: true } });
    await expectNotFound(getDeliverableDetail(other.organization.id, deliverable.id));
    await expectNotFound(getDeliverableFile(other.organization.id, deliverable.id));
    await expectNotFound(getRunLiveView(t.organization.id, "does-not-exist"));
    expect(await listRuns(other.organization.id)).toEqual([]);
    expect(await listDeliverables(other.organization.id)).toEqual([]);
  });

  it("WAITING_FOR_APPROVAL: the live view exposes the pending approval and the detail attaches it to its step", async () => {
    const live = await getRunLiveView(t.organization.id, runId);
    expect(live.run).toMatchObject({ id: runId, status: "WAITING_FOR_APPROVAL", trigger: "MANUAL", simulated: true, attempt: 1 });
    expect(typeof live.run.costUsd).toBe("number");
    expect(live.run.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(live.evaluationPending).toBe(false);
    expect(live.deliverableIds).toHaveLength(1);
    expect(live.pendingApprovals).toHaveLength(1);
    expect(live.pendingApprovals[0]).toMatchObject({ id: approvalId, toolName: "send_notification" });
    expect(live.pendingApprovals[0]!.payload).toMatchObject({ channel: "email" });
    // Steps are ordered by index and carry only the light fields the poller needs.
    expect(live.steps.map((s) => s.index)).toEqual([...live.steps.map((s) => s.index)].sort((a, b) => a - b));
    const waiting = live.steps.find((s) => s.kind === "APPROVAL");
    expect(waiting).toMatchObject({ status: "WAITING" });
    expect(waiting).not.toHaveProperty("input");
    expect(live.steps.some((s) => s.kind === "DELIVERABLE" && s.status === "SUCCEEDED")).toBe(true);
    // Paused, so Run.durationMs isn't written yet — the page shows the checkpoint's active time so far.
    const stored = await db.run.findUniqueOrThrow({ where: { id: runId }, select: { durationMs: true, checkpoint: true } });
    expect(stored.durationMs).toBeNull();
    const activeMs = (stored.checkpoint as { counters: { activeMs: number } }).counters.activeMs;
    expect(activeMs).toBeGreaterThan(0);
    expect(live.run.durationMs).toBe(Math.round(activeMs));
    expect((await listRuns(t.organization.id)).find((r) => r.id === runId)?.durationMs).toBe(Math.round(activeMs));

    const detail = await getRunDetail(t.organization.id, runId);
    expect(detail.live).toEqual(live);
    expect(detail.worker).toMatchObject({ id: hired.worker.id, name: hired.worker.name, avatarColor: hired.worker.avatarColor });
    expect(detail.job).toMatchObject({ id: hired.job.id, title: hired.job.title });
    expect(detail.version).toMatchObject({ id: hired.version.id, version: 1, status: "ACTIVE" });
    expect(detail.requestedByName).toBe(t.user.name);
    expect(detail.input.instructions).toEqual(["Keep it to the top 5"]);
    expect(detail.output).toBeNull();
    expect(detail.score).toBeNull();
    expect(detail.evaluations).toEqual([]);
    expect(detail.approvals).toHaveLength(1);
    expect(detail.approvals[0]).toMatchObject({ id: approvalId, status: "PENDING", decidedByName: null, decidedAt: null });

    const approvalStep = detail.steps.find((s) => s.kind === "APPROVAL");
    expect(approvalStep?.approval?.id).toBe(approvalId);
    const modelSteps = detail.steps.filter((s) => s.kind === "MODEL_CALL");
    expect(modelSteps.length).toBeGreaterThan(0);
    expect(modelSteps.every((s) => s.modelCalls.length === 1)).toBe(true);
    expect(modelSteps[0]!.modelCalls[0]).toMatchObject({ purpose: "agent.turn", simulated: true });
    expect(typeof modelSteps[0]!.modelCalls[0]!.costUsd).toBe("number");
    const toolSteps = detail.steps.filter((s) => s.kind === "TOOL_CALL");
    expect(toolSteps.length).toBeGreaterThan(0);
    expect(toolSteps.every((s) => s.toolCalls.length === 1)).toBe(true);
    const pendingCall = toolSteps.flatMap((s) => s.toolCalls).find((c) => c.toolName === "send_notification");
    expect(pendingCall).toMatchObject({ status: "PENDING_APPROVAL" });
    const deterministic = detail.steps.filter((s) => s.kind === "DETERMINISTIC");
    expect(deterministic.length).toBeGreaterThan(0);
    expect(deterministic.some((s) => typeof (s.output as { before?: unknown })?.before === "number")).toBe(true);
    expect(detail.usage.modelCalls).toBe(detail.steps.reduce((n, s) => n + s.modelCalls.length, 0));
    expect(detail.usage.toolCalls).toBe(detail.steps.reduce((n, s) => n + s.toolCalls.length, 0));
    expect(detail.deliverables).toHaveLength(1);
    expect(detail.deliverables[0]).toMatchObject({ status: "PENDING_REVIEW", format: "MARKDOWN" });
    expect(detail.deliverables[0]!.recordCount).toBeGreaterThan(0);
    expect(detail.checkpoint).toMatchObject({ version: 1 });
    expect(detail.queue.lockedBy).toBeNull();
  });

  it("after approve + resume: SUCCEEDED, evaluations attached, score computed, approvals no longer pending", async () => {
    await decideApproval({ organizationId: t.organization.id, approvalId, userId: t.user.id, decision: "approve", note: "Go ahead" });
    const queued = await getRunLiveView(t.organization.id, runId);
    expect(queued.run.status).toBe("QUEUED");
    expect(queued.pendingApprovals).toEqual([]);

    const resumed = await executeRun(runId);
    expect(resumed.status).toBe("SUCCEEDED");

    const live = await getRunLiveView(t.organization.id, runId);
    expect(live.run.status).toBe("SUCCEEDED");
    expect(live.run.finishedAt).not.toBeNull();
    expect(live.run.durationMs).not.toBeNull();
    expect(live.evaluationPending).toBe(false);
    expect(live.pendingApprovals).toEqual([]);

    const detail = await getRunDetail(t.organization.id, runId);
    expect(detail.output).not.toBeNull();
    expect(detail.output?.deliverableIds).toEqual(live.deliverableIds);
    expect(detail.evaluations.map((e) => e.type).sort()).toEqual(["DETERMINISTIC", "LLM_JUDGE"]);
    const checks = detail.evaluations.find((e) => e.type === "DETERMINISTIC");
    expect(checks?.details?.kind).toBe("deterministic");
    expect(checks?.details?.kind === "deterministic" ? checks.details.checks.length : 0).toBeGreaterThan(0);
    const judge = detail.evaluations.find((e) => e.type === "LLM_JUDGE");
    expect(judge?.details?.kind).toBe("llm_judge");
    expect(detail.score).not.toBeNull();
    expect(detail.score!).toBeGreaterThanOrEqual(0);
    expect(detail.score!).toBeLessThanOrEqual(100);
    expect(detail.approvals[0]).toMatchObject({ status: "APPROVED", decidedByName: t.user.name, decisionNote: "Go ahead" });
    expect(detail.approvals[0]!.decidedAt).not.toBeNull();
    const approvalStep = detail.steps.find((s) => s.kind === "APPROVAL");
    expect(approvalStep).toMatchObject({ status: "SUCCEEDED" });
    expect(approvalStep?.approval?.status).toBe("APPROVED");
    const sendCall = detail.steps.flatMap((s) => s.toolCalls).find((c) => c.toolName === "send_notification");
    expect(sendCall).toMatchObject({ status: "SUCCEEDED", simulated: true });
    expect(sendCall?.output).toMatchObject({ delivered: true });
    expect(detail.steps.some((s) => s.kind === "EVALUATION" && s.status === "SUCCEEDED")).toBe(true);
    expect(detail.usage.costUsd).toBe(live.run.costUsd);
  });

  it("deliverable detail: content, rows from stored data, run/worker context, then feedback shows up", async () => {
    const id = (await db.deliverable.findFirstOrThrow({ where: { runId }, select: { id: true } })).id;
    const before = await getDeliverableDetail(t.organization.id, id);
    expect(before).toMatchObject({ id, format: "MARKDOWN", status: "PENDING_REVIEW", feedback: null, reviewedByName: null, reviewedAt: null });
    expect(before.content.length).toBeGreaterThan(50);
    expect(before.rows?.length).toBeGreaterThan(0);
    expect(before.recordCount).toBe(before.rows?.length);
    // Markdown report: the underlying-records table follows the spec's field order (rank first), not jsonb's.
    const specFields = hired.spec.deliverable.fields.map((f) => f.name);
    const keys = new Set(before.rows!.flatMap((r) => Object.keys(r)));
    const expectedLead = [...(keys.has("rank") ? ["rank"] : []), ...specFields.filter((f) => keys.has(f))];
    expect(before.columns?.slice(0, expectedLead.length)).toEqual(expectedLead);
    expect([...before.columns!].sort()).toEqual([...keys].sort());
    expect(before.worker).toMatchObject({ id: hired.worker.id, name: hired.worker.name });
    expect(before.run).toMatchObject({ id: runId, status: "SUCCEEDED", simulated: true });
    expect(before.version).toMatchObject({ id: hired.version.id, version: 1 });
    expect(before.evaluations.map((e) => e.type).sort()).toEqual(["DETERMINISTIC", "LLM_JUDGE"]);

    await recordDeliverableFeedback(t.session, { deliverableId: id, decision: "reject", feedback: "Missing the seed rounds" });
    const after = await getDeliverableDetail(t.organization.id, id);
    expect(after).toMatchObject({ status: "REJECTED", feedback: "Missing the seed rounds", reviewedByName: t.user.name });
    expect(after.reviewedAt).not.toBeNull();
    const user = after.evaluations.find((e) => e.type === "USER_FEEDBACK");
    expect(user?.details).toMatchObject({ kind: "user_feedback", decision: "rejected", feedback: "Missing the seed rounds" });

    // The run page shows the user verdict too, and the run score now blends all three.
    const detail = await getRunDetail(t.organization.id, runId);
    expect(detail.evaluations.map((e) => e.type).sort()).toEqual(["DETERMINISTIC", "LLM_JUDGE", "USER_FEEDBACK"]);
    expect(detail.deliverables[0]).toMatchObject({ status: "REJECTED" });

    const file = await getDeliverableFile(t.organization.id, id);
    expect(file.filename).toMatch(/^weekly-ai-infra-funding-report-\d{4}-\d{2}-\d{2}\.md$/);
    expect(file.contentType).toContain("text/markdown");
    expect(file.content).toBe(before.content);
  });

  it("indexes: runs and deliverables list with filters, worker options and counts (org-scoped)", async () => {
    const failed = await createRun(t, hired, { status: "FAILED" });
    const runs = await listRuns(t.organization.id);
    expect(runs.map((r) => r.id)).toContain(runId);
    expect(runs.map((r) => r.id)).toContain(failed.id);
    expect(runs.find((r) => r.id === runId)?.deliverable).not.toBeNull();
    expect(runs.find((r) => r.id === failed.id)?.deliverable).toBeNull();
    expect(await listRuns(t.organization.id, { status: "FAILED" })).toHaveLength(1);
    expect((await listRuns(t.organization.id, { workerId: hired.worker.id })).length).toBe(runs.length);
    expect(await listRuns(t.organization.id, { workerId: "nope" })).toEqual([]);
    expect(await listRunWorkers(t.organization.id)).toEqual([{ id: hired.worker.id, name: hired.worker.name, title: hired.worker.title, avatarColor: hired.worker.avatarColor }]);
    expect(await listRunWorkers(other.organization.id)).toEqual([]);

    const deliverables = await listDeliverables(t.organization.id);
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]).toMatchObject({ status: "REJECTED", format: "MARKDOWN", worker: { id: hired.worker.id }, run: { id: runId, simulated: true } });
    expect(deliverables[0]!.score).not.toBeNull();
    expect(await listDeliverables(t.organization.id, { status: "ACCEPTED" })).toEqual([]);
    expect(await listDeliverables(t.organization.id, { workerId: hired.worker.id })).toHaveLength(1);
    expect(await listDeliverableWorkers(t.organization.id)).toEqual([{ id: hired.worker.id, name: hired.worker.name, title: hired.worker.title, avatarColor: hired.worker.avatarColor }]);
    expect(await countDeliverables(t.organization.id)).toEqual({ total: 1, pendingReview: 0, accepted: 0, rejected: 1 });
    expect(await countDeliverables(other.organization.id)).toEqual({ total: 0, pendingReview: 0, accepted: 0, rejected: 0 });
  });
});

describe("pages/runs: evaluationPending on hand-written runs", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("pages-runs-eval");
    hired = await createHiredWorker(t.organization.id);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("a freshly SUCCEEDED run without an automated verdict keeps the page polling; an old one does not", async () => {
    const fresh = await createRun(t, hired, { status: "SUCCEEDED", finishedAt: new Date() });
    expect((await getRunLiveView(t.organization.id, fresh.id)).evaluationPending).toBe(true);
    expect((await getRunDetail(t.organization.id, fresh.id)).live.evaluationPending).toBe(true);

    const stale = await createRun(t, hired, { status: "SUCCEEDED", finishedAt: new Date(Date.now() - EVALUATION_GRACE_MS - 5_000) });
    expect((await getRunLiveView(t.organization.id, stale.id)).evaluationPending).toBe(false);

    const failed = await createRun(t, hired, { status: "FAILED" });
    expect((await getRunLiveView(t.organization.id, failed.id)).evaluationPending).toBe(false);

    const queued = await createRun(t, hired, { status: "QUEUED" });
    const live = await getRunLiveView(t.organization.id, queued.id);
    expect(live.evaluationPending).toBe(false);
    expect(live.run).toMatchObject({ status: "QUEUED", startedAt: null, finishedAt: null, durationMs: null });
    expect(live.steps).toEqual([]);
  });

  it("once an automated evaluation exists the run stops being pending; a user-only verdict does not count", async () => {
    const run = await createRun(t, hired, { status: "SUCCEEDED", finishedAt: new Date() });
    const deliverable = await db.deliverable.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        runId: run.id,
        title: "Report",
        format: "CSV",
        content: "company,amount\nAcme,10\n",
      },
    });
    await recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "accept" });
    expect((await getRunLiveView(t.organization.id, run.id)).evaluationPending).toBe(true);

    await db.evaluation.create({
      data: {
        organizationId: t.organization.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        runId: run.id,
        deliverableId: deliverable.id,
        type: "DETERMINISTIC",
        score: 0.75,
        passed: true,
        details: toJson({ kind: "deterministic", checks: [] }),
      },
    });
    const live = await getRunLiveView(t.organization.id, run.id);
    expect(live.evaluationPending).toBe(false);
    expect(live.deliverableIds).toEqual([deliverable.id]);

    // CSV without stored data is parsed into rows for the table; the file keeps the raw text.
    const detail = await getDeliverableDetail(t.organization.id, deliverable.id);
    expect(detail.rows).toEqual([{ company: "Acme", amount: 10 }]);
    expect(detail.columns).toEqual(["company", "amount"]);
    expect(detail.status).toBe("ACCEPTED");
    const file = await getDeliverableFile(t.organization.id, deliverable.id);
    expect(file).toMatchObject({ filename: "report.csv", content: "company,amount\nAcme,10\n" });
    expect(file.contentType).toContain("text/csv");

    // Per-deliverable score on the index blends only the automated verdicts.
    const listed = await listDeliverables(t.organization.id, { status: "ACCEPTED" });
    expect(listed.find((d) => d.id === deliverable.id)?.score).toBe(75);
  });

  it("a CSV deliverable with stored records shows its columns in the CSV's order, not jsonb's", async () => {
    const run = await createRun(t, hired, { status: "SUCCEEDED" });
    const records = [
      { rank: 1, company: "Ridgeline GPU", category: "GPU Cloud", stage: "Series C", amount_usd: 210_000_000, hq: "Denver, CO", source_url: "https://news.example/a" },
      { rank: 2, company: "Latchkey AI", category: "Inference", stage: "Series B", amount_usd: 72_000_000, hq: "San Francisco, CA", source_url: "https://news.example/b" },
    ];
    const header = "rank,company,category,stage,amount_usd,hq,source_url";
    const deliverable = await db.deliverable.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        runId: run.id,
        title: "Funding rounds",
        format: "CSV",
        content: `${header}\n1,Ridgeline GPU,GPU Cloud,Series C,210000000,"Denver, CO",https://news.example/a\n2,Latchkey AI,Inference,Series B,72000000,"San Francisco, CA",https://news.example/b\n`,
        data: toJson(records),
      },
    });
    const detail = await getDeliverableDetail(t.organization.id, deliverable.id);
    // The round trip through jsonb really does scramble the keys — which is why the order must come from elsewhere.
    expect(Object.keys(detail.rows![0]!)).not.toEqual(header.split(","));
    expect(detail.columns).toEqual(header.split(","));
    expect(detail.recordCount).toBe(2);

    // What the page's DataTable renders: the records number themselves, so no competing "#" column, and the
    // headers keep their acronyms.
    const table = buildDataTableModel({ rows: detail.rows, columns: detail.columns, showIndex: !detail.columns?.includes("rank") });
    expect(table.headers.map((h) => h.label)).toEqual(["Rank", "Company", "Category", "Stage", "Amount USD", "HQ", "Source URL"]);
  });

  it("an unranked deliverable keeps the table's own row numbers", async () => {
    const run = await createRun(t, hired, { status: "SUCCEEDED" });
    const deliverable = await db.deliverable.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        runId: run.id,
        title: "Vendors",
        format: "CSV",
        content: "vendor_name,hq,crm_id\nAcme,Austin,CRM-1\n",
      },
    });
    const detail = await getDeliverableDetail(t.organization.id, deliverable.id);
    expect(detail.columns).toEqual(["vendor_name", "hq", "crm_id"]);
    const table = buildDataTableModel({ rows: detail.rows, columns: detail.columns, showIndex: !detail.columns?.includes("rank") });
    expect(table.headers.map((h) => h.label)).toEqual(["#", "Vendor name", "HQ", "CRM ID"]);
  });

  it("a paused hand-written run reports the checkpoint's active time so far; one that hasn't worked yet reports none", async () => {
    const run = await db.run.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        status: "WAITING_FOR_APPROVAL",
        trigger: "MANUAL",
        simulated: true,
        startedAt: new Date(Date.now() - 60_000),
        checkpoint: toJson({ version: 1, componentIndex: 2, context: {}, nextStepIndex: 3, counters: { modelCalls: 2, toolCalls: 1, costUsd: 0.01, activeMs: 12_345 } }),
      },
    });
    const live = await getRunLiveView(t.organization.id, run.id);
    expect(live.run).toMatchObject({ status: "WAITING_FOR_APPROVAL", durationMs: 12_345, finishedAt: null });
    expect((await getRunDetail(t.organization.id, run.id)).live.run.durationMs).toBe(12_345);
    expect((await listRuns(t.organization.id, { status: "WAITING_FOR_APPROVAL" })).find((r) => r.id === run.id)?.durationMs).toBe(12_345);

    const fresh = await db.run.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        status: "RUNNING",
        trigger: "MANUAL",
        simulated: true,
        startedAt: new Date(),
        checkpoint: toJson({ version: 1, counters: { modelCalls: 0, toolCalls: 0, costUsd: 0, activeMs: 0 } }),
      },
    });
    expect((await getRunLiveView(t.organization.id, fresh.id)).run.durationMs).toBeNull();
    // Terminal runs keep their final Run.durationMs, whatever the checkpoint says.
    const done = await createRun(t, hired, { status: "SUCCEEDED" });
    await db.run.update({ where: { id: done.id }, data: { checkpoint: toJson({ version: 1, counters: { modelCalls: 0, toolCalls: 0, costUsd: 0, activeMs: 99_999 } }) } });
    expect((await getRunLiveView(t.organization.id, done.id)).run.durationMs).toBe(4_200);
  });

  it("a hand-written WAITING run whose APPROVAL step has no approvalId still pairs the step with its request", async () => {
    const run = await db.run.create({
      data: {
        organizationId: t.organization.id,
        jobId: hired.job.id,
        workerId: hired.worker.id,
        workerVersionId: hired.version.id,
        status: "WAITING_FOR_APPROVAL",
        trigger: "SCHEDULED",
        simulated: true,
        startedAt: new Date(Date.now() - 60_000),
      },
    });
    const toolStep = await db.runStep.create({
      data: { runId: run.id, index: 0, kind: "TOOL_CALL", status: "RUNNING", title: "Sending the report by email" },
    });
    const toolCall = await db.toolCall.create({
      data: { runId: run.id, runStepId: toolStep.id, workerId: hired.worker.id, toolName: "send_notification", input: toJson({ channel: "email" }), status: "PENDING_APPROVAL", simulated: true },
    });
    const approval = await db.approval.create({
      data: {
        organizationId: t.organization.id,
        runId: run.id,
        workerId: hired.worker.id,
        toolCallId: toolCall.id,
        toolName: "send_notification",
        title: "Send the weekly report",
        payload: toJson({ channel: "email", to: ["team@acme.example"] }),
      },
    });
    // No `input.approvalId` on purpose — the seed / fixtures may not set it.
    await db.runStep.create({ data: { runId: run.id, index: 1, kind: "APPROVAL", status: "WAITING", title: "Waiting for your approval" } });

    const live = await getRunLiveView(t.organization.id, run.id);
    expect(live.pendingApprovals.map((a) => a.id)).toEqual([approval.id]);
    const detail = await getRunDetail(t.organization.id, run.id);
    const step = detail.steps.find((s) => s.kind === "APPROVAL");
    expect(step?.approval?.id).toBe(approval.id);
    expect(step?.approval?.status).toBe("PENDING");
    expect(detail.steps.find((s) => s.kind === "TOOL_CALL")?.toolCalls[0]).toMatchObject({ id: toolCall.id, status: "PENDING_APPROVAL" });
  });
});
