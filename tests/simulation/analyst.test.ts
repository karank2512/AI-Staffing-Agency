import { describe, expect, it } from "vitest";
import type { AgentComponent } from "@/server/domain/blueprint";
import type { JobSpec } from "@/server/domain/job-spec";
import { agentTurnHints } from "@/server/simulation";
import { isCriticalGroup } from "@/server/simulation/brain/analyst";
import { computeMetrics, isLowerUrgent } from "@/server/simulation/brain/analyst-metrics";
import { parseAgentInput, readStructuredInputs } from "@/server/simulation/brain/input";
import { makeBlueprint, makeJobSpec } from "../helpers/fixtures";
import { agentInput, categorizerComponent, componentOf, driveAgent, feedbackSpec, parseRecords, sim } from "./helpers";

const fundingRecords = () => parseRecords(driveAgent({ component: componentOf("collector") }).final);

describe("analyst brain", () => {
  it("writes markdown insights that cite real numbers from the records it was given", () => {
    const records = fundingRecords();
    const run = driveAgent({ component: componentOf("analyst"), context: { records } });
    expect(run.turns).toBe(1);
    expect(run.calls).toHaveLength(0);
    const text = run.final ?? "";

    const total = records.reduce((s, r) => s + Number(r.amount_usd), 0);
    const largest = records.slice().sort((a, b) => Number(b.amount_usd) - Number(a.amount_usd))[0];
    // The analyst groups by the first field that actually splits the data (category when it repeats, else stage).
    const countBy = (field: string) => {
      const counts = new Map<string, number>();
      for (const r of records) counts.set(String(r[field]), (counts.get(String(r[field])) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    const groups = ["category", "stage"].map(countBy).find((g) => g.some(([, n]) => n > 1)) ?? countBy("stage");
    const [topKey, topCount] = groups[0];

    expect(text).toContain(`**${records.length} funding rounds**`);
    expect(text).toContain(`$${Math.round(total / 1e5) / 10}M`);
    expect(text).toContain(String(largest.company));
    expect(text).toContain(`**${topKey}**`);
    expect(text).toContain(`${topCount} (${Math.round((topCount / records.length) * 100)}%)`);
    expect(text).toMatch(/### Insights\n1\. .+\n2\. .+\n3\. /);
    expect(text).toContain("### What to watch");
    expect(text).not.toMatch(/\bNaN\b|undefined|\[object Object\]/);
  });

  it("is deterministic and reacts to the data (feedback records → sentiment and category numbers)", () => {
    const records = parseRecords(driveAgent({ component: categorizerComponent(), spec: feedbackSpec() }).final);
    const setup = { component: componentOf("analyst"), spec: feedbackSpec(), context: { records } };
    const a = driveAgent(setup).final ?? "";
    expect(driveAgent(setup).final).toBe(a);

    const negative = records.filter((r) => r.sentiment === "negative").length;
    expect(a).toContain(`**${records.length} feedback items**`);
    expect(a).toContain(`${negative} negative`);
    expect(a).toMatch(/\*\*negative\*\* sentiment \(\d+%\)/);
    expect(a).not.toContain("duplicate"); // ids are unique even though customers repeat
  });

  it("says what to fix first: the most painful categories, each with a fix and a verbatim", () => {
    const records = parseRecords(driveAgent({ component: categorizerComponent(), spec: feedbackSpec() }).final);
    const text = driveAgent({ component: componentOf("analyst"), spec: feedbackSpec(), context: { records } }).final ?? "";
    const block = text.split("### What to fix first\n")[1]?.split("\n\n")[0] ?? "";
    const items = block.split("\n").filter((l) => /^\d\. /.test(l));
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.length).toBeLessThanOrEqual(3);

    // The first item is the category with the most negative + high-severity items.
    const pain = new Map<string, number>();
    for (const r of records) pain.set(String(r.category), (pain.get(String(r.category)) ?? 0) + (r.sentiment === "negative" ? 1 : 0) + (r.severity === "high" ? 1 : 0));
    const worst = [...pain.entries()].sort((a, b) => b[1] - a[1])[0];
    const first = /^1\. \*\*([^*]+)\*\*/.exec(items[0])?.[1];
    expect(pain.get(first ?? "")).toBe(worst[1]);
    for (const item of items) {
      expect(item).toMatch(/\d+ negative, \d+ high-severity of \d+ feedback items\. \*\*Fix:\*\* .+\. “.+”/);
    }
  });

  it("describes ties honestly and only calls a split 'concentrated' when it is", () => {
    const row = (category: string, sentiment: string, i: number) => ({ id: `FB-${2000 + i}`, customer: `Customer ${i}`, text: `Item ${i} about ${category}.`, category, sentiment, severity: "low" });
    const plan: Array<[string, number, number]> = [
      ["onboarding", 6, 1],
      ["performance", 6, 1],
      ["reporting", 6, 1],
      ["reliability", 5, 2],
      ["support", 5, 1],
      ["pricing", 4, 1],
    ];
    const records = plan.flatMap(([category, n, negatives], k) => Array.from({ length: n }, (_, j) => row(category, j < negatives ? "negative" : "positive", k * 10 + j)));
    const text = driveAgent({ component: componentOf("analyst"), spec: feedbackSpec(), context: { records } }).final ?? "";
    expect(text).toContain("the largest are **onboarding**, **performance** and **reporting** with 6 each");
    expect(text).toContain("**onboarding**, **performance** and **reporting** are tied at 6 of 32 feedback items (19%) each.");
    expect(text).not.toMatch(/reporting is the first category behind the leaders/);
    // 2 of 7 negatives sit in reliability: the most common place, not a concentration.
    expect(text).toContain("most common in **reliability** (2 of them)");
    expect(text).not.toContain("concentrated in");
  });

  it("works from compute_stats output alone", () => {
    const stats = {
      total: 40,
      groups: [
        { key: "onboarding", count: 12, share: 0.3 },
        { key: "pricing", count: 10, share: 0.25 },
        { key: "mobile", count: 18, share: 0.45 },
      ],
      numeric: { severity_score: { sum: 80, mean: 2, max: 3, min: 1 } },
    };
    const component: AgentComponent = { ...componentOf("analyst"), inputKeys: ["job_brief", "stats"] };
    const text = driveAgent({ component, spec: feedbackSpec(), context: { stats } }).final ?? "";
    expect(text).toContain("**40 feedback items**");
    expect(text).toContain("**mobile** with 18 (45%)");
    expect(text).toContain("3 category values");
    expect(text).toContain("**80**");
  });

  it("falls back to a structured note with the spec's sections when no records are present", () => {
    const spec = makeJobSpec({
      title: "Weekly Remote Work Newsletter",
      jobFamily: "content",
      summary: "Writes a short weekly newsletter about remote work practices.",
      objective: "Draft a weekly newsletter summarizing useful writing about remote team onboarding.",
      responsibilities: ["Find useful recent writing on remote onboarding", "Summarize it in a friendly tone"],
      successCriteria: [{ id: "tone", description: "Reads like a human wrote it" }],
      constraints: [],
      deliverable: { title: "Remote Work Weekly", description: "Newsletter", format: "markdown", fields: [], sections: ["Intro", "This week's picks", "Tip of the week"] },
    });
    const writer: AgentComponent = { ...componentOf("analyst"), id: "writer", inputKeys: ["job_brief"], tools: ["web_search"], maxTurns: 3 };
    const run = driveAgent({ component: writer, spec });
    expect(run.turns).toBe(2);
    expect(run.calls.map((c) => c.name)).toEqual(["web_search"]);
    expect((run.calls[0].input as { query: string }).query).toBe("Remote Work");
    const text = run.final ?? "";
    expect(text).toContain("## Intro");
    expect(text).toContain("## This week's picks");
    expect(text).toContain("## Tip of the week");
    expect(text).toMatch(/\]\(https:\/\/[a-z]+\.example\//);

    const noTools = driveAgent({ component: { ...writer, tools: [] }, spec });
    expect(noTools.turns).toBe(1);
    expect(noTools.final).toContain("## Intro");
  });

  it("parses the runtime's input message defensively", () => {
    const records = [{ company: "Vectorloom", stage: "Series B" }];
    const exact = parseAgentInput([{ role: "user", content: `## job_brief\n# Job\n\n## records\n\`\`\`json\n${JSON.stringify(records)}\n\`\`\`` }], ["job_brief", "records"]);
    expect(readStructuredInputs(exact).records).toEqual(records);

    const loose = parseAgentInput([{ role: "user", content: `### Records:\n${JSON.stringify(records)}\n\n## stats\n{"total": 1, "groups": [{"key": "Series B", "count": 1}], "numeric": {}}` }], ["records", "stats"]);
    const parsed = readStructuredInputs(loose);
    expect(parsed.records).toEqual(records);
    expect(parsed.stats?.total).toBe(1);

    const bare = parseAgentInput([{ role: "user", content: `Here are the rows: ${JSON.stringify(records)} thanks` }], ["records"]);
    expect(readStructuredInputs(bare).records).toEqual(records);

    // A markdown report's own "## Records" heading must not be mistaken for the records input key.
    const report = parseAgentInput([{ role: "user", content: `## report\n# Weekly\n\n## Records\n\n| a |\n|---|\n\n## job_brief\nbrief` }], ["report", "job_brief"]);
    expect(report.sections.report).toContain("## Records");
    expect(report.sections.job_brief).toBe("brief");

    const truncated = parseAgentInput([{ role: "user", content: `## records\n\`\`\`json\n[{"a": 1}, {"a": 2}, {"a": ` }], ["records"]);
    expect(readStructuredInputs(truncated).records).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("routes by shape: json → collector, markdown+records → analyst, notifier when send_notification is offered", () => {
    const analyst = agentInput({ component: componentOf("analyst"), context: { records: fundingRecords().slice(0, 3) } });
    expect(sim.agentTurn(analyst).toolCalls ?? []).toHaveLength(0);
    expect(sim.agentTurn(analyst).text).toContain("### Insights");

    const notifier = agentInput({ component: componentOf("notifier", { withNotifier: true }), context: { report: "hi" } });
    expect(sim.agentTurn(notifier).toolCalls?.[0]?.name).toBe("send_notification");

    const collector = agentInput({ component: componentOf("collector") });
    expect(sim.agentTurn(collector).toolCalls?.[0]?.name).toBe("web_search");
  });
});

function ticketSpec(fields: JobSpec["deliverable"]["fields"]): JobSpec {
  return makeJobSpec({
    title: "Support Ticket Triage",
    jobFamily: "support_triage",
    summary: "Classifies and routes inbound support tickets every day.",
    objective: "Read new support tickets, classify each by category and priority, and route it to the right team.",
    responsibilities: ["Classify tickets", "Route tickets"],
    deliverable: { title: "Daily Ticket Triage", description: "Triaged tickets.", format: "markdown", fields, sections: [], targetCount: 30 },
  });
}

const TICKET_FIELDS: JobSpec["deliverable"]["fields"] = [
  { name: "ticket_id", description: "Id", required: true },
  { name: "subject", description: "Subject", required: true },
  { name: "category", description: "Category", required: true },
  { name: "priority", description: "Priority", required: true },
  { name: "sla_hours", description: "SLA", required: true },
  { name: "team", description: "Team", required: true },
  { name: "notes", description: "Anything else", required: false },
];

describe("analyst brain: urgency, critical categories and data quality", () => {
  const spec = ticketSpec(TICKET_FIELDS);
  const tickets = () => parseRecords(driveAgent({ component: { ...categorizerComponent(), tools: ["read_dataset"] }, spec }).final);

  it("reads SLA hours as lower-is-urgent: the tightest SLAs lead, never the 72-hour ticket as an 'outlier worth a closer look'", () => {
    const records = tickets();
    const text = driveAgent({ component: componentOf("analyst"), spec, context: { records } }).final ?? "";
    const loosest = records.slice().sort((a, b) => Number(b.sla_hours) - Number(a.sla_hours))[0];
    const tightest = Math.min(...records.map((r) => Number(r.sla_hours)));
    const atTightest = records.filter((r) => Number(r.sla_hours) === tightest);

    expect(Number(loosest.sla_hours)).toBe(72);
    expect(text).not.toContain("outlier");
    expect(text).not.toContain(`**${String(loosest.subject)}** — the largest`);
    expect(text).not.toMatch(/Total SLA hours/);
    // Ties at the tightest SLA read in name order, so the text is stable however the records arrive.
    const first = atTightest.map((r) => String(r.subject)).sort((a, b) => a.localeCompare(b))[0];
    expect(text).toContain(`from ${tightest} to 72; the most urgent is ${first} at ${tightest}.`);
    expect(text).toContain(`${atTightest.length} of ${records.length} tickets share the tightest SLA hours (${tightest})`);
    expect(text).toContain("the tightest SLA hours this period (1); make sure it is picked up first.");
    // The priority split talks about the most severe level present, not merely the most common bad one.
    expect(text).toMatch(/\d+ of \d+ tickets are \*\*urgent\*\* priority/);
  });

  it("never calls an outage / security category a quiet corner, but still flags a genuinely quiet one", () => {
    const records = tickets();
    const text = driveAgent({ component: componentOf("analyst"), spec, context: { records } }).final ?? "";
    expect(text).not.toMatch(/\*\*outage\*\* — only .*quiet corner/);
    expect(text).toMatch(/\*\*outage\*\* — only \d+ tickets?, but low volume is no comfort here/);

    const row = (category: string, i: number) => ({ id: `FB-${3000 + i}`, customer: `Customer ${i}`, text: `About ${category}.`, category, sentiment: "neutral" });
    const plan: Array<[string, number]> = [["onboarding", 6], ["reporting", 4], ["exports", 1]];
    const benign = plan.flatMap(([c, n], k) => Array.from({ length: n }, (_, j) => row(c, k * 10 + j)));
    const quiet = driveAgent({ component: componentOf("analyst"), spec: feedbackSpec(), context: { records: benign } }).final ?? "";
    expect(quiet).toContain("**exports** — only 1 feedback item so far; a quiet corner that may be under-reported.");

    expect(["outage", "security", "account_security", "urgent", "critical", "data_loss", "P1", "Incidents"].every((v) => isCriticalGroup("category", v))).toBe(true);
    expect(isCriticalGroup("priority", "high")).toBe(true);
    expect(["billing", "how_to", "onboarding", "feature_request"].some((v) => isCriticalGroup("category", v))).toBe(false);
    expect(isCriticalGroup("category", "high")).toBe(false);
  });

  it("treats priority ranks where 1 is most urgent the same way", () => {
    const records = ["Checkout down", "Invoice typo", "Slow export", "Login loop", "Dark mode request"].map((subject, i) => ({
      ticket_id: `TCK-${4000 + i}`,
      subject,
      category: i % 2 === 0 ? "bug" : "billing",
      priority_rank: [1, 4, 3, 1, 5][i],
    }));
    const rankSpec = ticketSpec([
      { name: "ticket_id", description: "Id", required: true },
      { name: "subject", description: "Subject", required: true },
      { name: "category", description: "Category", required: true },
      { name: "priority_rank", description: "1 = most urgent", required: true },
    ]);
    const text = driveAgent({ component: componentOf("analyst"), spec: rankSpec, context: { records } }).final ?? "";
    expect(text).toContain("2 of 5 tickets share the highest priority rank (1) — Checkout down and Login loop");
    expect(text).not.toContain("Dark mode request** — the largest");
    expect(text).not.toContain("outlier");

    // compute_stats output alone: no totals of SLA hours, and the urgent end is the low one.
    const stats = { total: 40, groups: [{ key: "bug", count: 22 }, { key: "billing", count: 18 }], numeric: { sla_hours: { sum: 900, mean: 22.5, min: 1, max: 72 } } };
    const statsOnly = driveAgent({ component: { ...componentOf("analyst"), inputKeys: ["job_brief", "stats"] }, spec, context: { stats } }).final ?? "";
    expect(statsOnly).toContain("SLA hours runs from 1 to 72 across 40 tickets (average 22.5); the lowest values are the most urgent.");
    expect(statsOnly).not.toMatch(/Total SLA hours|\b900\b/);

    expect(["sla_hours", "response_sla", "due_in_days", "days_until_renewal", "resolution_hours", "priority", "priority_rank", "hours_to_respond"].every(isLowerUrgent)).toBe(true);
    expect(["days_overdue", "age_days", "days_open", "priority_score", "amount_due", "hours_saved", "employees", "amount_usd"].some(isLowerUrgent)).toBe(false);
  });

  it("counts missing REQUIRED fields only: a blank optional column is not a data-quality problem", () => {
    const records = tickets();
    expect(records.every((r) => r.notes === null)).toBe(true); // an optional column nothing fills
    const text = driveAgent({ component: componentOf("analyst"), spec, context: { records } }).final ?? "";
    expect(text).not.toContain("missing");
    expect(text).not.toContain("Data quality");

    const broken = records.map((r, i) => (i < 3 ? { ...r, team: null } : r));
    const flagged = driveAgent({ component: componentOf("analyst"), spec, context: { records: broken } }).final ?? "";
    expect(flagged).toContain("- Data quality: 3 records with a missing field.");

    // Records that do not follow the spec at all fall back to "any blank field".
    const foreign = computeMetrics({ records: [{ a: 1, b: null }, { a: 2, b: "x" }], now: new Date(), specFields: TICKET_FIELDS });
    expect(foreign.quality.missing).toBe(1);
  });

  it("counts duplicates on the blueprint's keyFields (all of them) when the runtime passes them", () => {
    const plans = ["Free", "Plus", "Business"];
    const rows = ["Notion", "Coda"].flatMap((vendor) => plans.map((plan) => ({ vendor, plan, monthly_price_usd: plan === "Free" ? 0 : 12 })));
    const pricingSpec = makeJobSpec({
      title: "Competitor Pricing Tracker",
      jobFamily: "market_analysis",
      deliverable: {
        title: "Pricing",
        description: "Plans",
        format: "markdown",
        fields: [
          { name: "vendor", description: "Vendor", required: true },
          { name: "plan", description: "Plan", required: true },
          { name: "monthly_price_usd", description: "Monthly price", required: false },
        ],
        sections: [],
        targetCount: 6,
      },
    });
    const withDuplicate = [...rows, { ...rows[1], vendor: " notion " }];
    const hints = { keyFields: ["vendor", "plan"] };
    const keyed = driveAgent({ component: componentOf("analyst"), spec: pricingSpec, context: { records: withDuplicate }, hints }).final ?? "";
    expect(keyed).toContain("- Data quality: 1 likely duplicate.");
    const clean = driveAgent({ component: componentOf("analyst"), spec: pricingSpec, context: { records: rows }, hints }).final ?? "";
    expect(clean).not.toContain("duplicate");
    // Without the blueprint's identity the old heuristic (one row per vendor) flags every second plan.
    const guessed = driveAgent({ component: componentOf("analyst"), spec: pricingSpec, context: { records: rows } }).final ?? "";
    expect(guessed).toContain("4 likely duplicates");
  });

  it("derives the hints from the blueprint: dedupe keyFields first, then the no_duplicates check", () => {
    const blueprint = makeBlueprint();
    expect(agentTurnHints(blueprint)).toEqual({ keyFields: ["company"] });
    const noDedupe = makeBlueprint({ withCleaning: false });
    const check = { id: "dupes", type: "no_duplicates" as const, description: "d", config: { keyFields: ["company", "stage"] }, weight: 1 };
    expect(agentTurnHints({ ...noDedupe, evaluation: { ...noDedupe.evaluation, deterministicChecks: [check] } })).toEqual({ keyFields: ["company", "stage"] });
    expect(agentTurnHints({ ...noDedupe, evaluation: { ...noDedupe.evaluation, deterministicChecks: [] } })).toEqual({});
  });
});
