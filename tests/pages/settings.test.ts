import { format, subDays } from "date-fns";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SetCredentialInputSchema } from "@/app/(app)/settings/schema";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getSettingsPage } from "@/server/queries/settings";
import { DEFAULT_USAGE_RANGE, getUsagePage, parseUsageRange } from "@/server/queries/usage";
import { KNOWN_CREDENTIALS, deleteCredential, setCredential } from "@/server/secrets";
import { recordUsage } from "@/server/usage";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker } from "../helpers/fixtures";
import { asRole, rejection, withEnv } from "../platform/helpers";

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;
type Hired = Awaited<ReturnType<typeof createHiredWorker>>;

const TAVILY = "TAVILY_API_KEY";

/**
 * Query-level tests for /settings and /usage. The server actions are thin wrappers (requireSession → these
 * calls → revalidatePath), so the vault calls they make are exercised directly with a SessionContext.
 */

describe("settings: getSettingsPage", () => {
  let t: TestOrg;
  let other: TestOrg;
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    t = await createTestOrg("pages-settings");
    other = await createTestOrg("pages-settings-other");
    await db.user.create({
      data: { organizationId: t.organization.id, email: `member-${t.organization.slug}@example.test`, name: "Ada Member", passwordHash: "x", role: "MEMBER" },
    });
  });
  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("describes the workspace: org name, members sorted owners-first, and the signed-in user's row", async () => {
    const page = await getSettingsPage(t.organization.id);
    expect(page.workspace.organizationName).toBe(t.organization.name);
    expect(page.workspace.organizationSlug).toBe(t.organization.slug);
    expect(page.workspace.memberCount).toBe(2);
    expect(page.workspace.members.map((m) => m.role)).toEqual(["OWNER", "MEMBER"]);
    expect(page.workspace.members[0]).toMatchObject({ id: t.user.id, email: t.user.email, name: t.user.name });
    // Serializable: ISO string, not a Date.
    expect(typeof page.workspace.createdAt).toBe("string");
    expect(new Date(page.workspace.createdAt).getTime()).not.toBeNaN();
  });

  it("reports Simulated mode with every tier routed to the mock provider and env var names for each live provider", async () => {
    const page = await getSettingsPage(t.organization.id);
    expect(page.providers.mode).toBe("simulated");
    expect(page.providers.forceSimulated).toBe(true); // tests/setup/env.ts
    expect(page.providers.providers.map((p) => p.id)).toEqual(["anthropic", "openai", "google", "mock"]);
    expect(page.providers.providers.find((p) => p.id === "anthropic")).toMatchObject({ envVar: "ANTHROPIC_API_KEY", available: false });
    expect(page.providers.providers.find((p) => p.id === "mock")).toMatchObject({ envVar: null, available: true });
    expect(page.providers.tiers.map((r) => r.tier)).toEqual(["fast", "standard", "reasoning"]);
    for (const route of page.providers.tiers) {
      expect(route).toMatchObject({ provider: "mock", simulated: true, providerLabel: "Simulated (built-in)" });
      expect(route.model).toBe(`mock-${route.tier}`);
      expect(route.overrideEnvVar).toBe(`MODEL_TIER_${route.tier.toUpperCase()}`);
    }
    expect(page.executor).toMatchObject({ enabled: false, pollMs: 1000, concurrency: 2 });
    expect(page.billing.marginMultiplier).toBeGreaterThan(0);
  });

  it("lists every known credential as unset by default, with the tools it powers", async () => {
    restores.push(withEnv({ [TAVILY]: undefined }));
    const page = await getSettingsPage(t.organization.id);
    expect(page.credentials.map((c) => c.name)).toEqual(KNOWN_CREDENTIALS.map((c) => c.name));
    const tavily = page.credentials.find((c) => c.name === TAVILY);
    expect(tavily).toMatchObject({ label: "Tavily API key", source: null, effective: "simulated", stored: null });
    expect(tavily?.usedBy).toEqual([{ name: "web_search", displayName: "Web search" }]);
    expect(tavily?.docsUrl).toMatch(/^https:\/\//);
  });

  it("shows a vault key as stored for the workspace — metadata only, never the value", async () => {
    restores.push(withEnv({ [TAVILY]: undefined }));
    await setCredential(t.session, { name: TAVILY, value: "tvly-abcdefghijklmnop1234", label: "  Team key  " });

    const page = await getSettingsPage(t.organization.id);
    const tavily = page.credentials.find((c) => c.name === TAVILY)!;
    expect(tavily.source).toBe("workspace");
    // A valid tool key does not make the tool live while the platform itself is simulated.
    expect(tavily.effective).toBe("simulated");
    expect(tavily.stored).toMatchObject({ last4: "1234", label: "Team key", lastUsedAt: null });
    expect(typeof tavily.stored?.setAt).toBe("string");
    expect(JSON.stringify(page)).not.toContain("tvly-abcdefghijklmnop");

    // Other workspaces do not see it.
    const otherPage = await getSettingsPage(other.organization.id);
    expect(otherPage.credentials.find((c) => c.name === TAVILY)?.stored).toBeNull();

    await deleteCredential(t.session, TAVILY);
    const after = await getSettingsPage(t.organization.id);
    expect(after.credentials.find((c) => c.name === TAVILY)).toMatchObject({ source: null, stored: null });
  });

  it("falls back to the server's .env when the vault has no row, without touching lastUsedAt", async () => {
    restores.push(withEnv({ [TAVILY]: "tvly-from-env-000000000" }));
    const page = await getSettingsPage(t.organization.id);
    expect(page.credentials.find((c) => c.name === TAVILY)).toMatchObject({ source: "environment", effective: "simulated", stored: null });

    restores.push(withEnv({ [TAVILY]: "   " }));
    const blank = await getSettingsPage(t.organization.id);
    expect(blank.credentials.find((c) => c.name === TAVILY)?.source).toBeNull();
  });

  it("refuses credential changes from members, and reports a missing key on delete", async () => {
    const member = asRole(t.session, "MEMBER");
    const set = (await rejection(setCredential(member, { name: TAVILY, value: "tvly-member-attempt-0000" }))) as AppError;
    expect(set).toBeInstanceOf(AppError);
    expect(set.code).toBe("FORBIDDEN");

    const del = (await rejection(deleteCredential(member, TAVILY))) as AppError;
    expect(del.code).toBe("FORBIDDEN");

    const missing = (await rejection(deleteCredential(t.session, TAVILY))) as AppError;
    expect(missing.code).toBe("NOT_FOUND");

    const unknown = (await rejection(setCredential(t.session, { name: "OPENAI_API_KEY", value: "sk-not-a-tool-key-000" }))) as AppError;
    expect(unknown.code).toBe("VALIDATION");
  });

  it("validates the action input before it reaches the vault", () => {
    expect(SetCredentialInputSchema.safeParse({ name: TAVILY, value: "   " }).success).toBe(false);
    expect(SetCredentialInputSchema.safeParse({ name: "", value: "tvly-x" }).success).toBe(false);
    const parsed = SetCredentialInputSchema.parse({ name: TAVILY, value: "  tvly-abc  ", label: "   " });
    expect(parsed).toEqual({ name: TAVILY, value: "tvly-abc", label: undefined });
    expect(SetCredentialInputSchema.safeParse({ name: TAVILY, value: "x".repeat(5000) }).success).toBe(false);
  });
});

describe("usage: getUsagePage", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeAll(async () => {
    t = await createTestOrg("pages-usage");
    hired = await createHiredWorker(t.organization.id, { name: "Alex" });
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("parses the range param defensively", () => {
    expect(parseUsageRange("7")).toBe(7);
    expect(parseUsageRange("90")).toBe(90);
    expect(parseUsageRange(["30", "7"])).toBe(30);
    expect(parseUsageRange("14")).toBe(DEFAULT_USAGE_RANGE);
    expect(parseUsageRange("abc")).toBe(DEFAULT_USAGE_RANGE);
    expect(parseUsageRange(undefined)).toBe(DEFAULT_USAGE_RANGE);
  });

  it("returns an empty, zero-filled window when nothing has been used", async () => {
    const page = await getUsagePage(t.organization.id, 7);
    expect(page.hasUsage).toBe(false);
    expect(page.days).toBe(7);
    expect(page.simulatedMode).toBe(true);
    expect(page.byDay).toHaveLength(7);
    expect(page.byDay.at(-1)?.date).toBe(format(new Date(), "yyyy-MM-dd"));
    expect(page.totals).toMatchObject({ costUsd: 0, billableUsd: 0, modelCalls: 0, toolCalls: 0, runs: 0, simulatedShare: null });
    expect(page.byWorker).toEqual([]);
    expect(page.byModel).toEqual([]);
    expect(page.byTool).toEqual([]);
  });

  it("aggregates the ledger with links, per-run cost, human labels and the margin from config", async () => {
    const run = await db.run.create({
      data: { organizationId: t.organization.id, jobId: hired.job.id, workerId: hired.worker.id, workerVersionId: hired.version.id, status: "SUCCEEDED", simulated: true },
    });
    const base = { organizationId: t.organization.id, workerId: hired.worker.id, jobId: hired.job.id, runId: run.id, simulated: true };
    await recordUsage({ ...base, kind: "MODEL", provider: "mock", resource: "mock-standard", inputTokens: 2000, outputTokens: 500, costUsd: 0.02 });
    await recordUsage({ ...base, kind: "MODEL", provider: "mock", resource: "mock-standard", inputTokens: 1000, outputTokens: 250, costUsd: 0.01 });
    await recordUsage({ ...base, kind: "TOOL", provider: "tool", resource: "web_search", costUsd: 0.008 });
    await recordUsage({ ...base, kind: "TOOL", provider: "tool", resource: "calculator", costUsd: 0 });
    // Platform work (scoping) has no worker; a removed worker's rows keep their id but get no link.
    await recordUsage({ organizationId: t.organization.id, kind: "MODEL", provider: "mock", resource: "mock-fast", inputTokens: 300, outputTokens: 50, costUsd: 0.002, simulated: true });
    await db.usageRecord.create({
      data: { organizationId: t.organization.id, workerId: "worker_gone", kind: "MODEL", provider: "mock", resource: "mock-fast", costUsd: 0.001, billableUsd: 0.0014, simulated: true },
    });
    // Outside the window: must not count.
    await db.usageRecord.create({
      data: { organizationId: t.organization.id, workerId: hired.worker.id, kind: "TOOL", provider: "tool", resource: "web_search", costUsd: 5, billableUsd: 7, simulated: true, occurredAt: subDays(new Date(), 40) },
    });

    const page = await getUsagePage(t.organization.id, 30);
    expect(page.hasUsage).toBe(true);
    expect(page.totals.modelCalls).toBe(4);
    expect(page.totals.toolCalls).toBe(2);
    expect(page.totals.costUsd).toBeCloseTo(0.041, 6);
    expect(page.totals.modelCostUsd).toBeCloseTo(0.033, 6);
    expect(page.totals.toolCostUsd).toBeCloseTo(0.008, 6);
    expect(page.totals.simulatedShare).toBe(1);
    expect(page.totals.runs).toBe(1);
    expect(page.totals.inputTokens).toBe(3300);
    expect(page.marginMultiplier).toBeGreaterThan(0);
    expect(page.totals.billableUsd).toBeCloseTo(page.totals.costUsd * page.marginMultiplier, 4);

    const alex = page.byWorker.find((w) => w.workerId === hired.worker.id)!;
    expect(alex).toMatchObject({ workerName: "Alex", href: `/workers/${hired.worker.id}`, runs: 1 });
    expect(alex.costPerRunUsd).toBeCloseTo(0.038, 6);
    expect(page.byWorker.find((w) => w.workerId === null)).toMatchObject({ href: null, runs: 0, costPerRunUsd: null });
    expect(page.byWorker.find((w) => w.workerId === "worker_gone")).toMatchObject({ href: null });
    expect(page.byWorker[0].workerId).toBe(hired.worker.id); // sorted by cost desc

    expect(page.byModel[0]).toMatchObject({ provider: "mock", providerLabel: "Simulated (built-in)", model: "mock-standard", calls: 2, inputTokens: 3000, simulated: true });
    expect(page.byTool.map((tool) => tool.toolName)).toEqual(["web_search", "calculator"]);
    expect(page.byTool[0]).toMatchObject({ displayName: "Web search", calls: 1, costPerCallUsd: 0.008 });
    expect(page.byTool[1]).toMatchObject({ displayName: "Calculator", costPerCallUsd: 0 });

    const today = page.byDay.at(-1)!;
    expect(today.modelCostUsd).toBeCloseTo(0.033, 6);
    expect(today.toolCostUsd).toBeCloseTo(0.008, 6);
    expect(page.byDay).toHaveLength(30);

    // A shorter window still sees today's rows; the 40-day-old row never appears.
    const week = await getUsagePage(t.organization.id, 7);
    expect(week.totals.costUsd).toBeCloseTo(0.041, 6);
    const quarter = await getUsagePage(t.organization.id, 90);
    expect(quarter.totals.costUsd).toBeCloseTo(5.041, 6);
  });

  it("is scoped to the organization", async () => {
    const other = await createTestOrg("pages-usage-other");
    try {
      const page = await getUsagePage(other.organization.id, 90);
      expect(page.hasUsage).toBe(false);
      expect(page.byWorker).toEqual([]);
    } finally {
      await other.cleanup();
    }
  });
});
