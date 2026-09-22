import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as downloadRoute } from "@/app/(app)/deliverables/[deliverableId]/download/route";
import { GET as runRoute } from "@/app/api/runs/[runId]/route";
import { getSession } from "@/server/auth";
import { notFound } from "@/server/errors";
import { getDeliverableFile } from "@/server/queries/deliverables";
import { getRunLiveView } from "@/server/queries/runs";
import { RATE_RULES, resetLimit } from "@/server/security";

vi.mock("@/server/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/server/queries/deliverables", () => ({ getDeliverableFile: vi.fn() }));
vi.mock("@/server/queries/runs", () => ({ getRunLiveView: vi.fn() }));

const session = { userId: "user_1", organizationId: "org_1", organizationName: "Acme", role: "OWNER", name: "A", email: "a@b.test" };
const signedIn = () => vi.mocked(getSession).mockResolvedValue(session as never);

const ENV_FLAG = process.env.RATE_LIMIT_DISABLED;
beforeAll(() => {
  delete process.env.RATE_LIMIT_DISABLED;
});
afterAll(() => {
  if (ENV_FLAG !== undefined) process.env.RATE_LIMIT_DISABLED = ENV_FLAG;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /deliverables/[id]/download", () => {
  const call = (deliverableId = "d1") =>
    downloadRoute(new Request("http://localhost/deliverables/d1/download"), { params: Promise.resolve({ deliverableId }) });

  it("serves the file inert: nosniff, a deny-all CSP and no caching", async () => {
    signedIn();
    vi.mocked(getDeliverableFile).mockResolvedValue({
      filename: "weekly-ai-infra-funding-report.md",
      contentType: "text/markdown; charset=utf-8",
      content: "# Report",
    });

    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("# Report");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="weekly-ai-infra-funding-report.md"; filename*=UTF-8''weekly-ai-infra-funding-report.md`,
    );
  });

  it("cannot have its Content-Disposition broken by a hostile title", async () => {
    signedIn();
    vi.mocked(getDeliverableFile).mockResolvedValue({
      filename: 'répo"rt\r\nX-Evil: 1/../../etc/passwd.csv',
      contentType: "text/csv; charset=utf-8",
      content: "a,b",
    });

    const disposition = (await call()).headers.get("Content-Disposition") ?? "";
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(disposition).not.toMatch(/filename="[^"]*"[^;]/);
    expect(disposition).toContain("filename*=UTF-8''");
    // The ASCII fallback keeps no quotes, slashes or control characters.
    const ascii = /filename="([^"]*)"/.exec(disposition)?.[1] ?? "";
    expect(ascii).not.toMatch(/["\\/:*?<>|]/);
  });

  it("401s when signed out and 404s a foreign id", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await call()).status).toBe(401);

    signedIn();
    vi.mocked(getDeliverableFile).mockRejectedValue(notFound("Deliverable"));
    const missing = await call("d-someone-elses");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Deliverable not found", code: "NOT_FOUND" });
  });

  it("answers an unexpected failure with a reference, never the internals", async () => {
    signedIn();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getDeliverableFile).mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

    const response = await call();
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; ref: string };
    expect(body.error).toBe("Something went wrong");
    expect(body.ref).toMatch(/^[0-9a-f]{6}$/);
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    log.mockRestore();
  });
});

describe("GET /api/runs/[runId]", () => {
  const call = (runId = "run_1") =>
    runRoute(new Request("http://localhost/api/runs/run_1"), { params: Promise.resolve({ runId }) });

  afterEach(async () => {
    await resetLimit(RATE_RULES.pollUser, session.userId);
  });

  it("returns the live view with no-store", async () => {
    signedIn();
    vi.mocked(getRunLiveView).mockResolvedValue({ id: "run_1", status: "RUNNING" } as never);
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: "run_1" });
  });

  it("answers 429 with Retry-After once the poll limit is passed", async () => {
    signedIn();
    vi.mocked(getRunLiveView).mockResolvedValue({ id: "run_1", status: "RUNNING" } as never);

    const responses = [];
    for (let i = 0; i < RATE_RULES.pollUser.limit + 2; i++) responses.push(await call());
    const blocked = responses.filter((r) => r.status === 429);
    expect(blocked).toHaveLength(2);
    expect(Number(blocked[0].headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked[0].headers.get("Cache-Control")).toBe("no-store");
    expect(await blocked[0].json()).toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("401s when signed out and 404s a foreign id", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await call()).status).toBe(401);

    signedIn();
    vi.mocked(getRunLiveView).mockRejectedValue(notFound("Run"));
    const missing = await call("run-someone-elses");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Run not found", code: "NOT_FOUND" });
  });
});
