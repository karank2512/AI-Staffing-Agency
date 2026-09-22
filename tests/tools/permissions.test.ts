import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, toJson } from "@/server/db";
import { tools } from "@/server/tools";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeBlueprint } from "../helpers/fixtures";
import { createApproval, createRun, createToolCall, ctxFor, NOTIFICATION_INPUT, type Hired } from "./helpers";

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

const SEARCH_INPUT = { query: "AI infrastructure funding rounds", maxResults: 3 };

describe("tools.authorize", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("tools-authorize");
    hired = await createHiredWorker(t.organization.id, { withNotifier: true });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const authorize = (toolName: string, extra: { runId?: string; attempt?: number; workerVersionId?: string; organizationId?: string } = {}) =>
    tools.authorize({ workerId: hired.worker.id, workerVersionId: extra.workerVersionId ?? hired.version.id, toolName, ...extra });

  it("allows a granted tool listed in the blueprint and reports its approval setting", async () => {
    const grant = await db.workerToolGrant.findUniqueOrThrow({ where: { workerId_toolName: { workerId: hired.worker.id, toolName: "web_search" } } });
    expect(await authorize("web_search")).toEqual({ allowed: true, requiresApproval: false, grantId: grant.id });
    const notifier = await db.workerToolGrant.findUniqueOrThrow({ where: { workerId_toolName: { workerId: hired.worker.id, toolName: "send_notification" } } });
    expect(await authorize("send_notification")).toEqual({ allowed: true, requiresApproval: true, grantId: notifier.id });
  });

  it("denies unknown tools", async () => {
    expect(await authorize("teleport")).toMatchObject({ allowed: false, reason: "unknown_tool" });
    expect(await authorize("constructor")).toMatchObject({ allowed: false, reason: "unknown_tool" });
  });

  it("denies tools that are not in the version's blueprint even when a grant exists", async () => {
    await db.workerToolGrant.create({ data: { workerId: hired.worker.id, toolName: "calculator", requiresApproval: false } });
    expect(await authorize("calculator")).toMatchObject({ allowed: false, reason: "not_in_blueprint" });
  });

  it("denies when the version does not belong to the worker or the organization", async () => {
    const other = await createTestOrg("tools-authorize-other");
    try {
      const otherHired = await createHiredWorker(other.organization.id);
      expect(await authorize("web_search", { workerVersionId: otherHired.version.id })).toMatchObject({ allowed: false, reason: "not_in_blueprint" });
      expect(await authorize("web_search", { organizationId: other.organization.id })).toMatchObject({ allowed: false, reason: "not_in_blueprint" });
      expect(await authorize("web_search", { organizationId: t.organization.id })).toMatchObject({ allowed: true });
    } finally {
      await other.cleanup();
    }
  });

  it("denies a blueprint tool without a grant, and a revoked grant", async () => {
    const withoutGrant = await createHiredWorker(t.organization.id);
    await db.workerToolGrant.delete({ where: { workerId_toolName: { workerId: withoutGrant.worker.id, toolName: "fetch_url" } } });
    await db.workerToolGrant.update({
      where: { workerId_toolName: { workerId: withoutGrant.worker.id, toolName: "extract_data" } },
      data: { revokedAt: new Date() },
    });
    const auth = (toolName: string) => tools.authorize({ workerId: withoutGrant.worker.id, workerVersionId: withoutGrant.version.id, toolName });
    expect(await auth("fetch_url")).toMatchObject({ allowed: false, reason: "no_grant" });
    expect(await auth("extract_data")).toMatchObject({ allowed: false, reason: "grant_revoked" });
    expect(await auth("web_search")).toMatchObject({ allowed: true });
  });

  it("enforces grant.config.maxCallsPerRun over the current attempt only (current row counts)", async () => {
    const limited = await createHiredWorker(t.organization.id);
    await db.workerToolGrant.update({
      where: { workerId_toolName: { workerId: limited.worker.id, toolName: "web_search" } },
      data: { config: toJson({ maxCallsPerRun: 2 }) },
    });
    const run = await createRun(t.organization.id, limited, { attempt: 2 });
    const auth = (attempt?: number) => tools.authorize({ workerId: limited.worker.id, workerVersionId: limited.version.id, toolName: "web_search", runId: run.id, attempt });

    // Rows from a previous attempt and non-executed statuses never count.
    await createToolCall(run.id, limited, "web_search", SEARCH_INPUT, { attempt: 1, status: "SUCCEEDED" });
    await createToolCall(run.id, limited, "web_search", SEARCH_INPUT, { attempt: 2, status: "DENIED" });
    await createToolCall(run.id, limited, "web_search", SEARCH_INPUT, { attempt: 2, status: "PENDING_APPROVAL" });
    await createToolCall(run.id, limited, "fetch_url", { url: "https://news.example/a" }, { attempt: 2, status: "SUCCEEDED" });

    await createToolCall(run.id, limited, "web_search", SEARCH_INPUT, { attempt: 2, status: "SUCCEEDED" });
    await createToolCall(run.id, limited, "web_search", SEARCH_INPUT, { attempt: 2, status: "RUNNING" }); // the current call
    expect(await auth(2)).toMatchObject({ allowed: true });

    await createToolCall(run.id, limited, "web_search", SEARCH_INPUT, { attempt: 2, status: "FAILED" });
    expect(await auth(2)).toMatchObject({ allowed: false, reason: "call_limit", message: expect.stringContaining("2 times per run") });
    // attempt omitted → read from the run (attempt 2) → same verdict; other attempts are unaffected.
    expect(await auth()).toMatchObject({ allowed: false, reason: "call_limit" });
    expect(await auth(3)).toMatchObject({ allowed: true });
    // Without a run there is nothing to count against.
    expect(await tools.authorize({ workerId: limited.worker.id, workerVersionId: limited.version.id, toolName: "web_search" })).toMatchObject({ allowed: true });
  });
});

describe("tools.invoke", () => {
  let t: TestOrg;
  let hired: Hired;
  let runId: string;

  beforeAll(async () => {
    t = await createTestOrg("tools-invoke");
    hired = await createHiredWorker(t.organization.id, { withNotifier: true });
    runId = (await createRun(t.organization.id, hired)).id;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const invoke = (toolName: string, input: unknown, toolCallId = "tc_missing") =>
    tools.invoke({ toolName, input, ctx: ctxFor(t.organization.id, hired, runId), toolCallId });

  it("executes an allowed, non-gated tool and writes a TOOL usage record with the flat cost", async () => {
    const call = await createToolCall(runId, hired, "web_search", SEARCH_INPUT);
    const result = await invoke("web_search", SEARCH_INPUT, call.id);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.simulated).toBe(true);
    expect(result.costUsd).toBe(tools.get("web_search")?.costPerCallUsd);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect((result.output as { results: unknown[] }).results).toHaveLength(3);

    const usage = await db.usageRecord.findMany({ where: { runId, kind: "TOOL" } });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      organizationId: t.organization.id,
      provider: "tool",
      resource: "web_search",
      simulated: true,
      workerId: hired.worker.id,
      jobId: hired.job.id,
    });
    expect(Number(usage[0].costUsd)).toBeCloseTo(0.008, 6);
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(Number(run.costUsd)).toBeCloseTo(0.008, 6);
  });

  it("denies unknown tools, tools outside the blueprint, and tools with no grant", async () => {
    expect(await invoke("teleport", {})).toEqual({ status: "denied", reason: "unknown_tool", message: expect.any(String) });
    expect(await invoke("calculator", { expression: "1+1" })).toMatchObject({ status: "denied", reason: "not_in_blueprint" });
    await db.workerToolGrant.delete({ where: { workerId_toolName: { workerId: hired.worker.id, toolName: "extract_data" } } });
    expect(await invoke("extract_data", { text: "x", fields: ["a"] })).toMatchObject({ status: "denied", reason: "no_grant" });
    await db.workerToolGrant.update({
      where: { workerId_toolName: { workerId: hired.worker.id, toolName: "fetch_url" } },
      data: { revokedAt: new Date() },
    });
    expect(await invoke("fetch_url", { url: "https://news.example/a" })).toMatchObject({ status: "denied", reason: "grant_revoked" });
    expect(await db.usageRecord.count({ where: { runId, resource: { in: ["calculator", "extract_data", "fetch_url"] } } })).toBe(0);
  });

  it("rejects invalid input BEFORE any approval is considered", async () => {
    const result = await invoke("send_notification", { channel: "pigeon", recipients: [], subject: "", body: "x" });
    expect(result.status).toBe("invalid_input");
    if (result.status === "invalid_input") expect(result.message).toMatch(/channel|recipients|subject/);
    expect(await invoke("web_search", { query: "a" })).toMatchObject({ status: "invalid_input" });
    expect(await invoke("web_search", "not an object")).toMatchObject({ status: "invalid_input" });
    expect(await db.approval.count({ where: { runId } })).toBe(0);
  });

  it("requires approval for an approval-gated grant with no Approval row or a PENDING one", async () => {
    const grant = await db.workerToolGrant.findUniqueOrThrow({ where: { workerId_toolName: { workerId: hired.worker.id, toolName: "send_notification" } } });
    const call = await createToolCall(runId, hired, "send_notification", NOTIFICATION_INPUT);
    expect(await invoke("send_notification", NOTIFICATION_INPUT, call.id)).toEqual({ status: "approval_required", grantId: grant.id });

    await createApproval(t.organization.id, runId, hired, call.id, "send_notification", "PENDING");
    expect(await invoke("send_notification", NOTIFICATION_INPUT, call.id)).toEqual({ status: "approval_required", grantId: grant.id });
    expect(await db.usageRecord.count({ where: { runId, resource: "send_notification" } })).toBe(0);
  });

  it("executes once the Approval is APPROVED", async () => {
    const call = await createToolCall(runId, hired, "send_notification", NOTIFICATION_INPUT, { status: "APPROVED" });
    await createApproval(t.organization.id, runId, hired, call.id, "send_notification", "APPROVED");
    const result = await invoke("send_notification", NOTIFICATION_INPUT, call.id);
    expect(result).toMatchObject({
      status: "ok",
      simulated: true,
      output: { delivered: true, simulated: true, channel: "email", recipients: 2 },
      costUsd: tools.get("send_notification")?.costPerCallUsd,
    });
    expect(await db.usageRecord.count({ where: { runId, resource: "send_notification" } })).toBe(1);
  });

  it("returns rejected for REJECTED and EXPIRED approvals", async () => {
    const rejectedCall = await createToolCall(runId, hired, "send_notification", NOTIFICATION_INPUT, { status: "DENIED" });
    await createApproval(t.organization.id, runId, hired, rejectedCall.id, "send_notification", "REJECTED");
    expect(await invoke("send_notification", NOTIFICATION_INPUT, rejectedCall.id)).toEqual({ status: "rejected", message: expect.stringContaining("declined") });

    const expiredCall = await createToolCall(runId, hired, "send_notification", NOTIFICATION_INPUT, { status: "DENIED" });
    await createApproval(t.organization.id, runId, hired, expiredCall.id, "send_notification", "EXPIRED");
    expect(await invoke("send_notification", NOTIFICATION_INPUT, expiredCall.id)).toEqual({ status: "rejected", message: expect.stringContaining("expired") });
  });

  it("ignores an APPROVED approval that belongs to another organization", async () => {
    const other = await createTestOrg("tools-invoke-other");
    try {
      const otherHired = await createHiredWorker(other.organization.id, { withNotifier: true });
      const otherRun = await createRun(other.organization.id, otherHired);
      const call = await createToolCall(otherRun.id, otherHired, "send_notification", NOTIFICATION_INPUT, { status: "APPROVED" });
      await createApproval(other.organization.id, otherRun.id, otherHired, call.id, "send_notification", "APPROVED");
      expect(await invoke("send_notification", NOTIFICATION_INPUT, call.id)).toMatchObject({ status: "approval_required" });
    } finally {
      await other.cleanup();
    }
  });

  it("denies with call_limit once maxCallsPerRun is exceeded (current row included)", async () => {
    await db.workerToolGrant.update({
      where: { workerId_toolName: { workerId: hired.worker.id, toolName: "web_search" } },
      data: { config: toJson({ maxCallsPerRun: 1 }) },
    });
    const run = await createRun(t.organization.id, hired);
    const first = await createToolCall(run.id, hired, "web_search", SEARCH_INPUT);
    const ctx = ctxFor(t.organization.id, hired, run.id);
    expect(await tools.invoke({ toolName: "web_search", input: SEARCH_INPUT, ctx, toolCallId: first.id })).toMatchObject({ status: "ok" });

    const second = await createToolCall(run.id, hired, "web_search", SEARCH_INPUT);
    expect(await tools.invoke({ toolName: "web_search", input: SEARCH_INPUT, ctx, toolCallId: second.id })).toMatchObject({
      status: "denied",
      reason: "call_limit",
    });
    // A retry (next attempt) starts a fresh count.
    const retry = await createToolCall(run.id, hired, "web_search", SEARCH_INPUT, { attempt: 2 });
    expect(await tools.invoke({ toolName: "web_search", input: SEARCH_INPUT, ctx: { ...ctx, attempt: 2 }, toolCallId: retry.id })).toMatchObject({ status: "ok" });
    await db.workerToolGrant.update({
      where: { workerId_toolName: { workerId: hired.worker.id, toolName: "web_search" } },
      data: { config: toJson({}) },
    });
  });

  it("turns a tool failure into an error result (never throws) and records no usage", async () => {
    const custom = makeBlueprint({ overrides: { tools: [...makeBlueprint().tools, { toolName: "read_dataset", reason: "Read feedback", requiresApproval: false }] } });
    const reader = await createHiredWorker(t.organization.id, { blueprint: custom });
    const run = await createRun(t.organization.id, reader);
    const ctx = ctxFor(t.organization.id, reader, run.id);
    const result = await tools.invoke({ toolName: "read_dataset", input: { dataset: "crm_accounts" }, ctx, toolCallId: "tc_x" });
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining('Unknown dataset "crm_accounts"'), latencyMs: expect.any(Number) });
    expect(await db.usageRecord.count({ where: { runId: run.id } })).toBe(0);

    const ok = await tools.invoke({ toolName: "read_dataset", input: { dataset: "support_tickets", limit: 3 }, ctx, toolCallId: "tc_y" });
    expect(ok).toMatchObject({ status: "ok", simulated: true, output: { dataset: "support_tickets" } });
    expect(await db.usageRecord.count({ where: { runId: run.id, resource: "read_dataset" } })).toBe(1);
  });

  it("never throws on missing rows", async () => {
    const ctx = ctxFor(t.organization.id, hired, runId, { workerVersionId: "not-a-real-version" });
    // A missing version is a denial, not a crash …
    expect(await tools.invoke({ toolName: "web_search", input: SEARCH_INPUT, ctx, toolCallId: "tc" })).toMatchObject({ status: "denied", reason: "not_in_blueprint" });
    // … and a run id that no longer exists still yields an ok result (the usage rollup tolerates it).
    const brokenRun = ctxFor(t.organization.id, hired, "run_does_not_exist");
    const result = await tools.invoke({ toolName: "web_search", input: SEARCH_INPUT, ctx: brokenRun, toolCallId: "tc" });
    expect(result.status).toBe("ok");
  });
});
