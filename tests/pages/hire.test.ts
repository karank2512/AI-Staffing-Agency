import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { getHireView, getHiredWorkerSummary, listOpenHireJobs, toolMetaMap } from "@/server/queries/hire";
import { approveJobSpec, buildJobSpec, hireWorker, proposeWorker, scopeJob, updateJobSpec } from "@/server/staffing";
import { tools } from "@/server/tools";
import {
  EXAMPLE_JOBS,
  ScopeJobInputSchema,
  SpecPatchSchema,
  formatKpiTarget,
  hourLabel,
  operationLabel,
  parseResponsibilityLines,
  stepKeyFor,
  toSpecPatch,
} from "@/app/(app)/hire/schema";
import { createTestOrg } from "../helpers/factory";

/**
 * /hire is a server-rendered flow; the page itself is not unit-tested. What IS tested: the read model the page
 * renders from (`queries/hire.ts`) and the pure helpers the actions and client leaves share (`schema.ts`).
 */

const DESCRIPTION =
  "Track newly funded AI infrastructure startups every week. For each round capture the company, stage, amount, lead investor and a source link, rank the biggest rounds and write a short market research report on what changed.";

async function expectNotFound(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    expect.unreachable("expected AppError(NOT_FOUND)");
  } catch (e) {
    expect(isAppError(e) ? e.code : e).toBe("NOT_FOUND");
  }
}

describe("hire page: pure helpers", () => {
  it("maps the server step onto the stepper, with no jobId meaning Describe", () => {
    expect(stepKeyFor(null)).toBe("describe");
    expect(stepKeyFor("questions")).toBe("clarify");
    expect(stepKeyFor("spec")).toBe("spec");
    expect(stepKeyFor("proposal")).toBe("proposal");
  });

  it("normalizes and bounds the job description", () => {
    expect(ScopeJobInputSchema.parse("  Find funded startups every week.\r\n ")).toBe("Find funded startups every week.");
    expect(ScopeJobInputSchema.safeParse("too short").success).toBe(false);
    expect(ScopeJobInputSchema.safeParse("x".repeat(5_001)).success).toBe(false);
  });

  it("splits responsibilities one per line and strips bullets and blanks", () => {
    expect(parseResponsibilityLines("- Search the web\n\n* Rank results  \n3. Write the report\n•  Email it")).toEqual([
      "Search the web",
      "Rank results",
      "Write the report",
      "Email it",
    ]);
  });

  it("builds a nested JobSpec patch from the flat form and lets null clear the target", () => {
    const patch = SpecPatchSchema.parse({ title: "  Funding tracker ", targetCount: null, cadence: { kind: "daily", hour: 8 } });
    expect(toSpecPatch(patch)).toEqual({ title: "Funding tracker", cadence: { kind: "daily", hour: 8 }, deliverable: { targetCount: undefined } });
    expect(toSpecPatch({})).toEqual({});
    expect(toSpecPatch({ targetCount: 25 })).toEqual({ deliverable: { targetCount: 25 } });
    expect(SpecPatchSchema.safeParse({ targetCount: 0 }).success).toBe(false);
    expect(SpecPatchSchema.safeParse({ responsibilities: [] }).success).toBe(false);
  });

  it("formats KPI targets in their display unit", () => {
    expect(formatKpiTarget({ target: 0.9, unit: "%", direction: "higher_is_better" })).toBe("≥ 90%");
    expect(formatKpiTarget({ target: 0.5, unit: "$", direction: "lower_is_better" })).toBe("≤ $0.50");
    expect(formatKpiTarget({ target: 300, unit: "sec", direction: "lower_is_better" })).toBe("≤ 300 s");
    expect(formatKpiTarget({ target: 12, unit: "records", direction: "higher_is_better" })).toBe("≥ 12 records");
  });

  it("labels pipeline operations and hours for humans", () => {
    expect(operationLabel("validate_records")).toBe("Check required fields");
    expect(operationLabel("something_new")).toBe("something new");
    expect(hourLabel(0)).toBe("12:00 AM");
    expect(hourLabel(9)).toBe("9:00 AM");
    expect(hourLabel(13)).toBe("1:00 PM");
  });
});

describe("hire page: read model", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  let other: Awaited<ReturnType<typeof createTestOrg>>;
  beforeAll(async () => {
    t = await createTestOrg("page-hire");
    other = await createTestOrg("page-hire-other");
  });
  afterAll(async () => {
    await t.cleanup();
    await other.cleanup();
  });

  it("exposes every registry tool as display metadata", () => {
    const meta = toolMetaMap();
    for (const tool of tools.list()) {
      expect(meta[tool.name]).toMatchObject({ name: tool.name, displayName: tool.displayName, humanDescription: tool.humanDescription });
    }
    expect(meta.send_notification?.defaultRequiresApproval).toBe(true);
    expect(meta.web_search?.defaultRequiresApproval).toBe(false);
  });

  it("follows the flow from questions to proposal, then points at the hired worker", async () => {
    const scoped = await scopeJob(t.session, DESCRIPTION);

    let view = await getHireView(t.organization.id, scoped.jobId);
    expect(view.kind).toBe("flow");
    if (view.kind !== "flow") return;
    expect(view.state.step).toBe("questions");
    expect(view.familyLabel).toBe("Market Research");
    expect(view.familyDescription.length).toBeGreaterThan(0);
    expect(Object.keys(view.toolMeta)).toEqual(expect.arrayContaining(["web_search", "send_notification"]));

    // Open, unstaffed jobs show up on the Describe step; someone else's never do.
    const open = await listOpenHireJobs(t.organization.id);
    expect(open.map((j) => j.id)).toContain(scoped.jobId);
    expect(open.find((j) => j.id === scoped.jobId)).toMatchObject({ status: "DRAFT", familyLabel: "Market Research" });
    expect(typeof open[0]?.updatedAt).toBe("string");
    expect((await listOpenHireJobs(other.organization.id)).map((j) => j.id)).not.toContain(scoped.jobId);

    const built = await buildJobSpec(t.session, scoped.jobId, {});
    view = await getHireView(t.organization.id, scoped.jobId);
    expect(view.kind === "flow" && view.state.step).toBe("spec");
    expect(view.kind === "flow" && view.state.jobSpecId).toBe(built.jobSpecId);

    // The flat form patch travels through updateJobSpec unchanged: cadence replaced whole, target cleared.
    const edited = await updateJobSpec(t.session, built.jobSpecId, toSpecPatch({ title: "Weekly funding tracker", targetCount: null, cadence: { kind: "daily", hour: 7 } }));
    expect(edited.title).toBe("Weekly funding tracker");
    expect(edited.cadence).toEqual({ kind: "daily", hour: 7 });
    expect(edited.deliverable.targetCount).toBeUndefined();
    expect(edited.deliverable.fields).toEqual(built.spec.deliverable.fields);

    await approveJobSpec(t.session, built.jobSpecId);
    view = await getHireView(t.organization.id, scoped.jobId);
    expect(view.kind === "flow" && view.state.step).toBe("proposal");
    expect(view.kind === "flow" && view.state.proposal).toBeNull();

    const proposal = await proposeWorker(t.session, scoped.jobId);
    view = await getHireView(t.organization.id, scoped.jobId);
    expect(view.kind === "flow" && view.state.proposal?.blueprint.persona.name).toBe(proposal.blueprint.persona.name);
    expect((await listOpenHireJobs(t.organization.id)).find((j) => j.id === scoped.jobId)?.status).toBe("SPEC_APPROVED");

    const hired = await hireWorker(t.session, scoped.jobId, { name: "Nova", startFirstRun: false });
    view = await getHireView(t.organization.id, scoped.jobId);
    expect(view).toEqual({
      kind: "staffed",
      jobId: scoped.jobId,
      status: "STAFFED",
      workerId: hired.workerId,
      permissions: { "jobs.manage": false, "workers.hire": false, "workers.manage": false },
    });
    // With a role the page passes its own capabilities through to the client (wave C hides what you cannot do).
    const asOwner = await getHireView(t.organization.id, scoped.jobId, { role: "OWNER" });
    expect(asOwner.permissions).toEqual({ "jobs.manage": true, "workers.hire": true, "workers.manage": true });
    expect((await listOpenHireJobs(t.organization.id)).map((j) => j.id)).not.toContain(scoped.jobId);

    expect(await getHiredWorkerSummary(t.organization.id, hired.workerId)).toEqual({ name: "Nova", title: proposal.blueprint.persona.title });
    expect(await getHiredWorkerSummary(other.organization.id, hired.workerId)).toBeNull();

    // A staffed job whose worker was retired is reported without a worker to redirect to.
    await db.worker.update({ where: { id: hired.workerId }, data: { status: "RETIRED", retiredAt: new Date() } });
    await db.job.update({ where: { id: scoped.jobId }, data: { status: "CLOSED" } });
    view = await getHireView(t.organization.id, scoped.jobId);
    expect(view).toEqual({
      kind: "staffed",
      jobId: scoped.jobId,
      status: "CLOSED",
      workerId: null,
      permissions: { "jobs.manage": false, "workers.hire": false, "workers.manage": false },
    });
  });

  it("scopes the three example jobs onto distinct families with clean titles and the promised formats", async () => {
    // The Describe step's chips are the demo's opening move: each must land on its own family, keep a readable
    // (unclipped) working title, and produce the deliverable shape the label promises.
    const expected: Record<string, { family: string; format: string; notifier: boolean }> = {
      "funding-tracker": { family: "market_research", format: "markdown", notifier: false },
      "feedback-digest": { family: "feedback_analysis", format: "markdown", notifier: true },
      "fintech-leads": { family: "lead_research", format: "csv", notifier: false },
    };
    for (const job of EXAMPLE_JOBS) {
      expect(ScopeJobInputSchema.safeParse(job.description).success).toBe(true);
      const scoped = await scopeJob(t.session, job.description);
      expect(scoped.questions.questions.length).toBeLessThanOrEqual(3);
      const view = await getHireView(t.organization.id, scoped.jobId);
      expect(view.kind).toBe("flow");
      if (view.kind !== "flow") return;
      expect(view.state.job.jobFamily).toBe(expected[job.id]?.family);
      expect(view.state.job.title.endsWith("…")).toBe(false);

      const { jobSpecId, spec } = await buildJobSpec(t.session, scoped.jobId, {});
      expect(spec.deliverable.format).toBe(expected[job.id]?.format);
      expect(spec.cadence.kind).toBe("weekly");

      // The proposal card needs a reason per tool, a non-empty rationale and a cost breakdown to render.
      await approveJobSpec(t.session, jobSpecId);
      const proposal = await proposeWorker(t.session, scoped.jobId);
      expect(proposal.simulated).toBe(true);
      expect(proposal.rationale.length).toBeGreaterThan(0);
      expect(proposal.blueprint.costEstimate.breakdown.length).toBeGreaterThan(0);
      for (const tool of proposal.blueprint.tools) expect(tool.reason.length).toBeGreaterThan(0);
      const notifier = proposal.blueprint.tools.find((x) => x.toolName === "send_notification");
      expect(notifier !== undefined).toBe(expected[job.id]?.notifier);
      if (notifier) expect(notifier.requiresApproval).toBe(true);
    }
  });

  it("hides jobs that are missing or belong to another organization", async () => {
    await expectNotFound(() => getHireView(t.organization.id, "job_does_not_exist"));
    const theirs = await scopeJob(other.session, DESCRIPTION);
    await expectNotFound(() => getHireView(t.organization.id, theirs.jobId));
    expect((await getHireView(other.organization.id, theirs.jobId)).kind).toBe("flow");
  });
});
