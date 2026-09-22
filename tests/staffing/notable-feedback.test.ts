import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { parseBlueprint, type AgentComponent, type JobSpec, type ReportSection, type WorkerBlueprint } from "@/server/domain";
import { enqueueRun, executeRun } from "@/server/runtime";
import { runDeterministic, type ReportMeta } from "@/server/runtime/deterministic";
import { approveJobSpec, buildJobSpec, designBlueprint, draftFromTemplate, hireWorker, proposeWorker, scopeJob } from "@/server/staffing";
import { feedbackTableColumns, NOTABLE_KEY, NOTABLE_ROWS } from "@/server/staffing/notable-feedback";
import { createTestOrg } from "../helpers/factory";
import { DESCRIPTIONS, specFor } from "./helpers";

/**
 * The "Notable feedback" table of a feedback report is a severity-ordered shortlist (at most 10 rows, high first,
 * readable columns, never the verbatim text) while `records` — the deliverable's data — stays complete.
 */

const READABLE = ["id", "customer", "category", "sentiment", "severity", "summary", "suggested_action"];
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const META: ReportMeta = { personaName: "Jordan", now: new Date("2026-09-21T09:00:00Z"), pipeline: [], toolUsage: [], recordTrail: [] };

const ids = (bp: WorkerBlueprint) => bp.components.map((c) => c.id);
const agentById = (bp: WorkerBlueprint, id: string) => bp.components.find((c): c is AgentComponent => c.type === "agent" && c.id === id);

function withFields(spec: JobSpec, fields: JobSpec["deliverable"]["fields"], extra: Partial<JobSpec["deliverable"]> = {}): JobSpec {
  return { ...spec, deliverable: { ...spec.deliverable, fields, ...extra } };
}

function tableOf(bp: WorkerBlueprint): ReportSection {
  const report = bp.components.find((c) => c.type === "deterministic" && c.operation === "compile_report");
  if (report?.type !== "deterministic" || report.operation !== "compile_report") throw new Error("no report");
  const table = report.config.sections.find((s) => s.as === "table");
  if (!table) throw new Error("no table section");
  return table;
}

/** The rows of the markdown table under `## <heading>` as header → cell maps. */
function tableRows(markdown: string, heading: string): { header: string[]; rows: Array<Record<string, string>> } {
  const section = markdown.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";
  const lines = section.split("\n").filter((l) => l.startsWith("| "));
  const cells = (line: string) => line.slice(2, -2).split(" | ");
  const header = lines.length > 0 ? cells(lines[0]) : [];
  return { header, rows: lines.slice(2).map((line) => Object.fromEntries(cells(line).map((cell, i) => [header[i], cell]))) };
}

/** Replays the designed pipeline with the agents' outputs supplied, exactly as the runtime feeds deterministic steps. */
function replay(bp: WorkerBlueprint, records: Array<Record<string, unknown>>): Record<string, unknown> {
  const context: Record<string, unknown> = { job_brief: "brief", instructions: [] };
  for (const c of bp.components) {
    if (c.type === "agent") {
      context[c.outputKey] = c.outputKey === "records" ? records : "The analyst's prose.";
      continue;
    }
    context[c.outputKey] = runDeterministic(c, context, META).value;
  }
  return context;
}

const LONG_TEXT = "The export to our BI tool fails every Monday morning and our analysts lose half a day re-running it by hand, which is why we are evaluating alternatives.";
function feedbackItem(n: number, severity: string): Record<string, unknown> {
  return {
    id: `FB-${2000 + n}`,
    customer: `Customer ${n}`,
    plan: "Pro",
    channel: "support",
    text: `${LONG_TEXT} (item ${n})`,
    category: n % 2 === 0 ? "reporting" : "reliability",
    sentiment: n % 3 === 0 ? "positive" : "negative",
    severity,
    summary: `Summary ${n}`,
    suggested_action: `Action ${n}`,
  };
}

describe("staffing: the feedback report's Notable feedback table", () => {
  const spec = specFor("feedback_analysis");

  it("is a severity shortlist on its own key, with readable columns and at most 10 rows", () => {
    const bp = designBlueprint(spec, draftFromTemplate(spec));
    expect(tableOf(bp)).toEqual({ heading: "Notable feedback", sourceKey: NOTABLE_KEY, as: "table", columns: READABLE, maxRows: NOTABLE_ROWS });
    expect(tableOf(bp).columns).not.toContain("text");

    const shortlist = bp.components.find((c) => c.id === "notable_shortlist");
    const rank = bp.components.find((c) => c.id === "notable_rank");
    expect(shortlist).toMatchObject({ operation: "filter", config: { field: "severity", op: "neq", value: "low" }, inputKeys: ["records"], outputKey: NOTABLE_KEY });
    expect(rank).toMatchObject({ operation: "rank", config: { by: "severity", direction: "asc", limit: NOTABLE_ROWS }, inputKeys: [NOTABLE_KEY], outputKey: NOTABLE_KEY });
    // After the record steps and the breakdown (which read the full set), before the prose and the report.
    const order = ids(bp);
    expect(order.indexOf("compute_stats")).toBeLessThan(order.indexOf("notable_shortlist"));
    expect(order.indexOf("notable_rank")).toBeLessThan(order.indexOf("analyst"));
    const report = bp.components.find((c) => c.id === "compile_report");
    expect(report?.inputKeys).toEqual(["insights", "records", "stats", NOTABLE_KEY]);
    expect(bp.deliverable).toMatchObject({ contentKey: "report", dataKey: "records" });

    // The ordering relies on the vocabulary, so the collector is told it; the analyst knows what the table holds.
    expect(agentById(bp, "collector")!.instructions).toContain("severity is exactly one of high / medium / low");
    expect(agentById(bp, "analyst")!.instructions).toContain(`The "Notable feedback" table (the ${NOTABLE_ROWS} highest-severity items, most severe first)`);
  });

  it("orders high → medium, sets low aside, and leaves the records untouched", () => {
    const bp = designBlueprint(spec, draftFromTemplate(spec));
    const severities = ["low", "medium", "high", "Low", "medium", "HIGH", "low", "medium", "high", "medium", "low", "high", "medium", "high", "medium", "low"];
    const records = severities.map((s, i) => feedbackItem(i + 1, s));
    const context = replay(bp, records);

    expect(context.records).toHaveLength(records.length);
    expect((context.records as Array<Record<string, unknown>>).map((r) => r.id)).toEqual(records.map((r) => r.id));
    expect((context.records as Array<Record<string, unknown>>).some((r) => "rank" in r)).toBe(false);

    const report = String(context.report);
    const { header, rows } = tableRows(report, "Notable feedback");
    expect(header).toEqual(["ID", "Customer", "Category", "Sentiment", "Severity", "Summary", "Suggested action"]);
    expect(rows).toHaveLength(NOTABLE_ROWS);
    const ranks = rows.map((r) => SEVERITY_ORDER[r.Severity.toLowerCase()]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(rows.slice(0, 5).map((r) => r.Severity.toLowerCase())).toEqual(Array(5).fill("high"));
    expect(rows.slice(5).every((r) => r.Severity === "medium")).toBe(true);
    // Ties keep the collector's order.
    expect(rows.slice(0, 5).map((r) => r.ID)).toEqual(["FB-2003", "FB-2006", "FB-2009", "FB-2012", "FB-2014"]);
    expect(report).not.toContain(LONG_TEXT);
  });

  it("shows fewer rows when fewer items are notable, and never pads with low severity", () => {
    const bp = designBlueprint(spec, draftFromTemplate(spec));
    const records = ["low", "high", "low", "medium", "low", "high"].map((s, i) => feedbackItem(i + 1, s));
    const { rows } = tableRows(String(replay(bp, records).report), "Notable feedback");
    expect(rows.map((r) => [r.ID, r.Severity])).toEqual([
      ["FB-2002", "high"],
      ["FB-2006", "high"],
      ["FB-2004", "medium"],
    ]);
  });

  it("drops the verbatim text instead of showing it when the spec has no summary field", () => {
    const fields = spec.deliverable.fields.filter((f) => f.name !== "summary");
    const bp = designBlueprint(withFields(spec, fields), draftFromTemplate(withFields(spec, fields)));
    expect(tableOf(bp).columns).toEqual(["id", "customer", "category", "sentiment", "severity", "suggested_action"]);

    // Too few familiar names: the spec's own order, still without the verbatim.
    const custom = [
      { name: "quote", description: "What the customer said", required: true },
      { name: "product", description: "Product area", required: true },
      { name: "tone", description: "positive / neutral / negative", required: false },
    ];
    expect(feedbackTableColumns(custom)).toEqual(["product", "tone"]);
    expect(feedbackTableColumns([{ name: "text", description: "The feedback", required: true }])).toBeUndefined();
  });

  it("uses a numeric severity score directly, and needs no extra step when records are already ranked by it", () => {
    const fields = [
      ...spec.deliverable.fields.filter((f) => f.name !== "severity"),
      { name: "severity_score", description: "1–5 business impact", required: true },
    ];
    const scored = withFields(spec, fields);
    const draft = draftFromTemplate(scored);
    expect(draft.rankBy).toBe("severity_score");
    const bp = designBlueprint(scored, draft);
    expect(ids(bp).filter((id) => id.startsWith("notable_"))).toEqual([]);
    expect(tableOf(bp)).toMatchObject({ sourceKey: "records", maxRows: NOTABLE_ROWS });
    expect(agentById(bp, "collector")!.instructions).not.toContain("exactly one of high / medium / low");

    const unranked = designBlueprint(scored, { ...draft, steps: { ...draft.steps, rank: false } });
    expect(unranked.components.find((c) => c.id === "notable_rank")).toMatchObject({
      config: { by: "severity_score", direction: "desc", limit: NOTABLE_ROWS },
      inputKeys: ["records"],
      outputKey: NOTABLE_KEY,
    });
    expect(tableOf(unranked).sourceKey).toBe(NOTABLE_KEY);
  });

  it("keeps every row, still without the verbatim, when the customer asks for the full list", () => {
    const full = withFields(spec, spec.deliverable.fields, { sections: ["Summary", "Themes by volume", "All feedback"] });
    const bp = designBlueprint(full, draftFromTemplate(full));
    expect(ids(bp).filter((id) => id.startsWith("notable_"))).toEqual([]);
    expect(tableOf(bp)).toEqual({ heading: "All feedback", sourceKey: "records", as: "table", columns: READABLE, maxRows: 60 });
    expect(agentById(bp, "analyst")!.instructions).toContain("The full records table and the breakdown are appended");

    const top = withFields(spec, spec.deliverable.fields, { sections: ["Summary", "Themes by volume", "Top complaints across all channels"] });
    expect(tableOf(designBlueprint(top, draftFromTemplate(top)))).toMatchObject({ heading: "Top complaints across all channels", sourceKey: NOTABLE_KEY, maxRows: NOTABLE_ROWS });
  });

  it("names the table Notable feedback when the customer named no list section", () => {
    const unnamed = withFields(spec, spec.deliverable.fields, { sections: ["Summary", "Themes by volume"] });
    const bp = designBlueprint(unnamed, draftFromTemplate(unnamed));
    expect(tableOf(bp)).toMatchObject({ heading: "Notable feedback", sourceKey: NOTABLE_KEY, maxRows: NOTABLE_ROWS });
  });

  it("leaves other families' report tables on the full records", () => {
    for (const family of ["market_research", "support_triage", "finance_ops", "general"] as const) {
      const base = specFor(family);
      const other = withFields(base, base.deliverable.fields, { format: "markdown", sections: base.deliverable.sections.length > 0 ? base.deliverable.sections : ["Summary"] });
      const bp = designBlueprint(other, draftFromTemplate(other));
      expect(tableOf(bp).sourceKey).toBe("records");
      expect(ids(bp).some((id) => id.startsWith("notable_"))).toBe(false);
      expect(agentById(bp, "analyst")!.instructions).toContain("The full records table");
    }
  });
});

describe("staffing: a hired feedback worker's first report (simulated run)", () => {
  let t: Awaited<ReturnType<typeof createTestOrg>>;
  beforeAll(async () => {
    t = await createTestOrg("staffing-notable");
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("delivers a 10-row, severity-first Notable feedback table and the complete records as data", async () => {
    const scoped = await scopeJob(t.session, DESCRIPTIONS.feedback_analysis);
    const built = await buildJobSpec(t.session, scoped.jobId, {});
    await approveJobSpec(t.session, built.jobSpecId);
    await proposeWorker(t.session, scoped.jobId);
    const hired = await hireWorker(t.session, scoped.jobId, { startFirstRun: false });
    const version = await db.workerVersion.findUniqueOrThrow({ where: { id: hired.versionId } });
    expect(ids(parseBlueprint(version.blueprint))).toEqual(expect.arrayContaining(["notable_shortlist", "notable_rank"]));

    const { runId } = await enqueueRun({ organizationId: t.organization.id, workerId: hired.workerId, trigger: "MANUAL", requestedById: t.user.id });
    const outcome = await executeRun(runId);
    expect(outcome.status).toBe("SUCCEEDED");
    if (outcome.status !== "SUCCEEDED") throw new Error("unreachable");
    const deliverable = await db.deliverable.findUniqueOrThrow({ where: { id: outcome.deliverableIds[0] } });

    const records = deliverable.data as Array<Record<string, unknown>>;
    expect(records.length).toBeGreaterThan(NOTABLE_ROWS);
    const { header, rows } = tableRows(deliverable.content, "Notable feedback");
    expect(header).toEqual(["ID", "Customer", "Category", "Sentiment", "Severity", "Summary", "Suggested action"]);
    const notable = records.filter((r) => String(r.severity).toLowerCase() !== "low");
    expect(rows).toHaveLength(Math.min(NOTABLE_ROWS, notable.length));
    const ranks = rows.map((r) => SEVERITY_ORDER[r.Severity.toLowerCase()]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const highs = records.filter((r) => r.severity === "high").length;
    expect(rows.filter((r) => r.Severity === "high")).toHaveLength(Math.min(highs, NOTABLE_ROWS));

    // Verbatims longer than their one-line summary never reach the table.
    const tableText = rows.map((r) => Object.values(r).join(" ")).join("\n");
    const longOnes = records.filter((r) => String(r.text).length > String(r.summary).length + 10);
    expect(longOnes.length).toBeGreaterThan(0);
    for (const r of longOnes) expect(tableText).not.toContain(String(r.text));
    expect(deliverable.content).toContain("## Themes by volume");
  });
});
