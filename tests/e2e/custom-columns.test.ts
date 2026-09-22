import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { parseBlueprint } from "@/server/domain";
import { enqueueRun, executeRun } from "@/server/runtime";
import { approveJobSpec, buildJobSpec, hireWorker, proposeWorker, scopeJob } from "@/server/staffing";
import { createTestOrg } from "../helpers/factory";

/**
 * A customer who types their own job — their own columns, their own targeting — gets exactly that, end to end
 * in Simulated mode: the scoped spec, the designed worker, and the records its first run delivers.
 */

type TestOrg = Awaited<ReturnType<typeof createTestOrg>>;

const KAI =
  "Every weekday morning, research 15 Series A fintech companies in Europe that are hiring engineers. Give me a CSV with company, website, funding stage, headcount and a one-line reason each is a good fit for our developer tools.";
const PRICING =
  "Every week, check the pricing pages of our five main competitors (Notion, Coda, Airtable, ClickUp, Monday). Capture plan name, monthly price, seat minimum and any change since last week, and flag anything that moved.";

async function hireAndRun(t: TestOrg, description: string) {
  const scoped = await scopeJob(t.session, description);
  const answers = Object.fromEntries(scoped.questions.questions.map((q) => [q.id, q.suggestions[0] ?? ""]));
  const built = await buildJobSpec(t.session, scoped.jobId, answers);
  await approveJobSpec(t.session, built.jobSpecId);
  await proposeWorker(t.session, scoped.jobId);
  const hired = await hireWorker(t.session, scoped.jobId, { startFirstRun: false });
  const { runId } = await enqueueRun({ organizationId: t.organization.id, workerId: hired.workerId, trigger: "MANUAL", requestedById: t.user.id });
  const outcome = await executeRun(runId);
  expect(outcome.status).toBe("SUCCEEDED");
  if (outcome.status !== "SUCCEEDED") throw new Error("unreachable");
  const deliverable = await db.deliverable.findUniqueOrThrow({ where: { id: outcome.deliverableIds[0] } });
  const job = await db.job.findUniqueOrThrow({ where: { id: scoped.jobId } });
  const version = await db.workerVersion.findUniqueOrThrow({ where: { id: hired.versionId } });
  return { scoped, spec: built.spec, job, deliverable, blueprint: parseBlueprint(version.blueprint), records: deliverable.data as Array<Record<string, unknown>> };
}

describe("e2e: a customer's own columns flow from the description to the deliverable", () => {
  let t: TestOrg;
  beforeAll(async () => {
    t = await createTestOrg("e2e-columns");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("delivers the lead-list CSV the customer described, with every requested column filled", async () => {
    const run = await hireAndRun(t, KAI);
    const columns = ["company", "website", "funding_stage", "headcount", "fit_reason", "source_url"];

    expect(run.scoped.questions).toMatchObject({ jobFamily: "lead_research", draftTitle: "European Series A Fintech Lead List" });
    expect(run.scoped.questions.questions.map((q) => q.id)).toEqual(["recipients"]); // nothing it already said is asked again
    expect(run.job.title).toBe("European Series A Fintech Lead List");
    expect(run.spec.deliverable).toMatchObject({ format: "csv", targetCount: 15 });
    expect(run.spec.deliverable.fields.map((f) => f.name)).toEqual(columns);
    expect(run.spec.responsibilities.join(" ")).toContain("Series A fintech companies in Europe that are hiring engineers");

    expect(run.deliverable.format).toBe("CSV");
    expect(run.deliverable.content.split("\n")[0]).toBe(columns.join(","));
    expect(run.records.length).toBeGreaterThan(0);
    for (const record of run.records) {
      // Deliverable.data is jsonb, which does not keep key order; the CSV header above does.
      expect(Object.keys(record).sort()).toEqual([...columns].sort());
      for (const column of columns) expect(record[column], `${column} in ${JSON.stringify(record)}`).not.toBeNull();
      expect(typeof record.fit_reason === "string" && record.fit_reason.length).toBeGreaterThan(10);
    }
    expect(new Set(run.records.map((r) => r.company)).size).toBe(run.records.length);
  });

  it("turns a competitor pricing monitor into plan-level pricing rows, not a funding report", async () => {
    const run = await hireAndRun(t, PRICING);
    expect(run.scoped.questions.jobFamily).toBe("market_analysis");
    expect(run.job.title).toBe("Competitor Pricing Tracker");
    const fields = run.spec.deliverable.fields.map((f) => f.name);
    expect(fields).toEqual(["competitor", "plan_name", "monthly_price_usd", "seat_minimum", "change_since_last", "source_url", "pricing_model"]);
    expect(fields).not.toContain("amount_usd");

    expect(run.deliverable.format).toBe("MARKDOWN");
    expect(run.deliverable.content).not.toMatch(/Top rounds|funding rounds/i);
    expect(run.records.length).toBeGreaterThan(0);
    for (const record of run.records) {
      expect(Object.keys(record).sort()).toEqual([...fields, "rank"].sort()); // ranked by monthly price, cheapest first
      for (const column of ["competitor", "plan_name", "source_url"]) expect(record[column], column).not.toBeNull();
    }
    // One row per competitor × plan: the same competitor appears once per plan, never twice for one plan.
    const keys = run.records.map((r) => `${String(r.competitor)}|${String(r.plan_name)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(run.records.some((r) => typeof r.monthly_price_usd === "number")).toBe(true);
  });
});
