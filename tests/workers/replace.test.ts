import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { ReplacementAnalysis, ReplacementPlan } from "@/server/domain";
import { recordDeliverableFeedback } from "@/server/evaluation";
import { applyReplacementPlan, getVersionComparison, hireReplacement, listVersions, proposeReplacement } from "@/server/workers";
import { createTestOrg } from "../helpers/factory";
import { createHiredWorker, makeBlueprint, makeJobSpec } from "../helpers/fixtures";
import { activityOf, createDeliverable, createJudgeEvaluation, createRun, daysAgo, grantsOf, loadVersionRow, loadWorkerRow, records, type Hired, type TestOrg } from "./helpers";

const basePlan: ReplacementPlan = {
  summary: "Upgrade the researcher and clean the records.",
  failurePatterns: [{ pattern: "Incomplete records", evidence: "3 of 6 runs short", occurrences: 3, severity: "high" }],
  rootCauses: ["Fast tier skips fields"],
  changes: [{ area: "model", description: "Standard tier", rationale: "Reliability" }],
  instructionRewrites: [],
  tierChanges: [],
  addValidationStep: false,
  addDedupeStep: false,
  estimatedDeltas: { qualityPct: 20, costPct: 25, latencyPct: 10 },
};

describe("applyReplacementPlan", () => {
  const spec = makeJobSpec();

  it("applies tier changes and instruction rewrites to agent components only", () => {
    const current = makeBlueprint({ collectorTier: "fast" });
    const next = applyReplacementPlan(current, spec, {
      ...basePlan,
      tierChanges: [
        { componentId: "collector", modelTier: "standard" },
        { componentId: "rank", modelTier: "reasoning" },
        { componentId: "ghost", modelTier: "reasoning" },
      ],
      instructionRewrites: [
        { componentId: "analyst", instructions: "Write three sharp paragraphs with numbers." },
        { componentId: "dedupe", instructions: "ignored" },
      ],
    });
    const collector = next.components.find((c) => c.id === "collector");
    const analyst = next.components.find((c) => c.id === "analyst");
    expect(collector?.type === "agent" && collector.modelTier).toBe("standard");
    expect(analyst?.type === "agent" && analyst.instructions).toBe("Write three sharp paragraphs with numbers.");
    expect(next.components.map((c) => c.id)).toEqual(current.components.map((c) => c.id));
    expect(next.costEstimate.perRunUsd).toBeGreaterThan(0);
    expect(next.costEstimate.perRunUsd).not.toBe(current.costEstimate.perRunUsd);
    // PURE: the input is untouched.
    const original = current.components.find((c) => c.id === "collector");
    expect(original?.type === "agent" && original.modelTier).toBe("fast");
  });

  it("inserts validation then dedupe right after the collector and appends the matching checks", () => {
    const current = makeBlueprint({ withCleaning: false });
    current.evaluation.deterministicChecks = current.evaluation.deterministicChecks.filter((c) => c.type !== "required_fields" && c.type !== "no_duplicates");
    const next = applyReplacementPlan(current, spec, { ...basePlan, addValidationStep: true, addDedupeStep: true });

    expect(next.components.map((c) => c.id)).toEqual(["collector", "validate_records", "dedupe", "rank", "analyst", "compile_report"]);
    const validate = next.components[1];
    const dedupe = next.components[2];
    expect(validate.type === "deterministic" && validate.operation === "validate_records" && validate.config).toEqual({
      requiredFields: ["company", "stage", "amount_usd", "source_url"],
      dropInvalid: true,
    });
    expect(dedupe.type === "deterministic" && dedupe.operation === "dedupe" && dedupe.config).toEqual({ keyFields: ["company"] });
    expect(validate.inputKeys).toEqual(["records"]);
    expect(validate.outputKey).toBe("records");
    const types = next.evaluation.deterministicChecks.map((c) => c.type);
    expect(types).toContain("required_fields");
    expect(types).toContain("no_duplicates");
  });

  it("does not duplicate existing steps and skips them when the spec has no required fields", () => {
    const current = makeBlueprint();
    const same = applyReplacementPlan(current, spec, { ...basePlan, addValidationStep: true, addDedupeStep: true });
    expect(same.components.filter((c) => c.type === "deterministic" && c.operation === "validate_records")).toHaveLength(1);
    expect(same.components.filter((c) => c.type === "deterministic" && c.operation === "dedupe")).toHaveLength(1);

    const noRequired = makeJobSpec({ deliverable: { ...spec.deliverable, fields: spec.deliverable.fields.map((f) => ({ ...f, required: false })) } });
    const bare = makeBlueprint({ withCleaning: false });
    const unchanged = applyReplacementPlan(bare, noRequired, { ...basePlan, addValidationStep: true, addDedupeStep: true });
    expect(unchanged.components.map((c) => c.id)).toEqual(bare.components.map((c) => c.id));
  });
});

describe("proposeReplacement / hireReplacement", () => {
  let t: TestOrg;
  let hired: Hired;

  beforeEach(async () => {
    t = await createTestOrg("workers-replace");
    hired = await createHiredWorker(t.organization.id, { userId: t.user.id, collectorTier: "fast", withCleaning: false });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  async function seedPoorRecord() {
    await createRun(hired, { status: "FAILED", createdAt: daysAgo(12), error: "Collector produced no JSON array" });
    await createRun(hired, { status: "FAILED", createdAt: daysAgo(8), error: "Collector produced no JSON array" });
    const good = await createRun(hired, { status: "SUCCEEDED", createdAt: daysAgo(5) });
    const deliverable = await createDeliverable(hired, good.id, { title: "Weekly AI Infra Funding Report — Sep 13", data: records(4) });
    await createJudgeEvaluation(hired, { runId: good.id, deliverableId: deliverable.id, score: 0.45, reasoning: "Half the rounds lack an amount and two companies repeat." });
    await recordDeliverableFeedback(t.session, { deliverableId: deliverable.id, decision: "reject", feedback: "Only 4 rounds and two of them are duplicates; I need the amounts." });
    return deliverable;
  }

  it("proposes an evidence-driven replacement version", async () => {
    await seedPoorRecord();
    const { versionId } = await proposeReplacement(t.session, hired.worker.id);

    const version = await loadVersionRow(versionId);
    expect(version.status).toBe("PROPOSED");
    expect(version.version).toBe(2);
    expect(version.changeReason).toBe("REPLACEMENT");
    expect(version.parentVersionId).toBe(hired.version.id);
    expect(version.changeSummary).toContain("standard tier");

    const comparison = await getVersionComparison(t.organization.id, versionId);
    expect(comparison.canDecide).toBe(true);
    expect(comparison.base?.id).toBe(hired.version.id);
    expect(comparison.target.id).toBe(versionId);
    expect(comparison.base?.runCount).toBe(3);
    expect(comparison.base?.metrics?.failed).toBe(2);
    expect(comparison.target.runCount).toBe(0);
    expect(comparison.target.metrics).toBeNull();

    const bp = comparison.target.blueprint;
    const collector = bp.components.find((c) => c.id === "collector");
    expect(collector?.type === "agent" && collector.modelTier).toBe("standard");
    expect(collector?.type === "agent" && collector.instructions).toContain("Only 4 rounds and two of them are duplicates");
    expect(bp.components.map((c) => c.id).slice(0, 3)).toEqual(["collector", "validate_records", "dedupe"]);
    expect(bp.evaluation.deterministicChecks.map((c) => c.type)).toEqual(expect.arrayContaining(["required_fields", "no_duplicates"]));

    const analysis = comparison.analysis as ReplacementAnalysis;
    expect(analysis).not.toBeNull();
    expect(analysis.simulated).toBe(true);
    expect(analysis.failurePatterns.length).toBeGreaterThan(0);
    expect(analysis.failurePatterns.map((p) => p.pattern)).toEqual(
      expect.arrayContaining([expect.stringContaining("2 of 3 runs failed"), expect.stringContaining("1 deliverable rejected")]),
    );
    expect(analysis.basedOn).toEqual({ runs: 3, failedRuns: 2, evaluations: 2, rejectedDeliverables: 1, windowDays: 30 });
    expect(analysis.changes.map((c) => c.area)).toEqual(expect.arrayContaining(["model", "pipeline", "instructions"]));
    expect(analysis.estimatedDeltas.costPct).toBeGreaterThan(0);
    expect(analysis.estimatedDeltas.qualityPct).toBeGreaterThanOrEqual(15);

    const tier = comparison.diff.entries.find((e) => e.path === "components.collector.modelTier");
    expect(tier).toMatchObject({ label: "Researcher · model tier", before: "fast", after: "standard" });
    expect(comparison.diff.entries.some((e) => e.path === "components.validate_records" && e.kind === "added")).toBe(true);

    const versions = await listVersions(t.organization.id, hired.worker.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[1].score.score).not.toBeNull();
    expect(versions[1].locked).toBe(false);
  });

  it("hires the replacement: activates it and queues the first run", async () => {
    await seedPoorRecord();
    const { versionId } = await proposeReplacement(t.session, hired.worker.id);
    const { runId } = await hireReplacement(t.session, versionId, { startFirstRun: true });
    expect(runId).toBeDefined();

    const run = await db.run.findUniqueOrThrow({ where: { id: runId! } });
    expect(run.trigger).toBe("HIRE");
    expect(run.status).toBe("QUEUED");
    expect(run.workerVersionId).toBe(versionId);

    const worker = await loadWorkerRow(hired.worker.id);
    expect(worker.currentVersionId).toBe(versionId);
    expect(worker.score).toBeNull();
    expect(worker.health).toBe("UNKNOWN");
    expect((await loadVersionRow(hired.version.id)).status).toBe("REPLACED");
    expect((await loadVersionRow(versionId)).lockedAt).not.toBeNull();
    expect((await grantsOf(hired.worker.id)).get("web_search")?.revokedAt).toBeNull();

    const after = await getVersionComparison(t.organization.id, versionId);
    expect(after.canDecide).toBe(false);
    expect(after.base?.id).toBe(hired.version.id);
    expect(after.target.status).toBe("ACTIVE");
    expect(after.target.locked).toBe(true);
    expect(after.target.runCount).toBe(1);

    const events = await activityOf(t.organization.id, hired.worker.id, "WORKER_REPLACED");
    expect(events).toHaveLength(1);
    expect(events[0].title).toContain("hired a replacement for Alex");

    // Comparing against an explicit base works and is org-scoped.
    const explicit = await getVersionComparison(t.organization.id, versionId, hired.version.id);
    expect(explicit.base?.id).toBe(hired.version.id);
    await expect(getVersionComparison(t.organization.id, versionId, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await createTestOrg("workers-replace-other");
    try {
      await expect(getVersionComparison(other.organization.id, versionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await other.cleanup();
    }
  });

  it("skips the first run when asked, and refuses to hire a non-proposed version", async () => {
    const { versionId } = await proposeReplacement(t.session, hired.worker.id);
    const result = await hireReplacement(t.session, versionId, { startFirstRun: false, newName: "Sam" });
    expect(result.runId).toBeUndefined();
    expect(await db.run.count({ where: { workerId: hired.worker.id } })).toBe(0);
    expect((await loadWorkerRow(hired.worker.id)).name).toBe("Sam");
    await expect(hireReplacement(t.session, versionId)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
