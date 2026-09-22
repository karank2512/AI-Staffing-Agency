import { describe, expect, it } from "vitest";
import type { AgentComponent } from "@/server/domain/blueprint";
import { TOOL_INPUT_SCHEMAS, type ToolName } from "@/server/tools/schemas";
import { makeJobSpec } from "../helpers/fixtures";
import { agentInput, categorizerComponent, componentOf, driveAgent, feedbackSpec, parseRecords, sim, type DriveResult } from "./helpers";

const SPEC_FIELDS = ["company", "stage", "amount_usd", "lead_investor", "category", "source_url"];
const REQUIRED = ["company", "stage", "amount_usd", "source_url"];

function expectWellFormed(run: DriveResult, component: AgentComponent) {
  expect(run.final).not.toBeNull();
  expect(run.turns).toBeLessThanOrEqual(component.maxTurns);
  const granted = new Set(component.tools);
  for (const call of run.calls) {
    expect(granted.has(call.name)).toBe(true);
    const schema = TOOL_INPUT_SCHEMAS[call.name as ToolName];
    const parsed = schema.safeParse(call.input);
    expect(parsed.success, `${call.name} input invalid: ${JSON.stringify(call.input).slice(0, 200)}`).toBe(true);
  }
}

describe("collector brain", () => {
  it("is deterministic: the same inputs produce the same conversation and final answer", () => {
    const a = driveAgent({ component: componentOf("collector") });
    const b = driveAgent({ component: componentOf("collector") });
    expect(a.calls).toEqual(b.calls);
    expect(a.final).toEqual(b.final);
    const input = agentInput({ component: componentOf("collector") });
    expect(sim.agentTurn(input)).toEqual(sim.agentTurn(input));
  });

  it("plans search → fetch (top 3–4 results) → extract and finishes with a JSON array of spec-shaped records", () => {
    const component = componentOf("collector");
    const run = driveAgent({ component });
    expectWellFormed(run, component);

    const names = run.calls.map((c) => c.name);
    expect(names.filter((n) => n === "web_search").length).toBeGreaterThanOrEqual(1);
    expect(names.filter((n) => n === "web_search").length).toBeLessThanOrEqual(2);
    expect(names.indexOf("web_search")).toBeLessThan(names.indexOf("fetch_url"));
    expect(names.indexOf("fetch_url")).toBeLessThan(names.indexOf("extract_data"));
    const fetches = run.calls.filter((c) => c.name === "fetch_url");
    expect(fetches.length).toBeGreaterThanOrEqual(3);
    expect(fetches.length).toBeLessThanOrEqual(4);
    const searched = new Set(
      run.messages.flatMap((m) => (m.role === "tool" && m.toolName === "web_search" ? (m.output as { results: Array<{ url: string }> }).results.map((r) => r.url) : [])),
    );
    for (const f of fetches) expect(searched.has((f.input as { url: string }).url)).toBe(true);
    const extract = run.calls.find((c) => c.name === "extract_data")?.input as { fields: string[]; text: string };
    expect(extract.fields).toEqual(SPEC_FIELDS);
    expect(extract.text.length).toBeGreaterThan(1000);

    const records = parseRecords(run.final);
    expect(records).toHaveLength(10); // spec targetCount
    const known = new Map(sim.companies().map((c) => [c.company, c]));
    for (const r of records) {
      expect(Object.keys(r)).toEqual(SPEC_FIELDS);
      for (const f of REQUIRED) expect(r[f], f).not.toBeNull();
      expect(known.get(String(r.company))?.stage).toBe(r.stage);
    }
    expect(new Set(records.map((r) => r.company)).size).toBe(records.length);
  });

  it("fast tier is measurably worse: missing required fields and duplicate rows", () => {
    const standard = parseRecords(driveAgent({ component: componentOf("collector") }).final);
    const fast = parseRecords(driveAgent({ component: componentOf("collector", { collectorTier: "fast" }) }).final);

    const missing = (rows: Array<Record<string, unknown>>) => rows.filter((r) => REQUIRED.some((f) => r[f] === null || r[f] === undefined)).length;
    const duplicates = (rows: Array<Record<string, unknown>>) => rows.length - new Set(rows.map((r) => r.company)).size;

    expect(missing(standard)).toBe(0);
    expect(duplicates(standard)).toBe(0);
    expect(missing(fast)).toBeGreaterThanOrEqual(2);
    expect(duplicates(fast)).toBeGreaterThanOrEqual(1);
    expect(fast.length).toBeGreaterThan(standard.length);
    // Sloppy, not useless: the identifying field survives.
    expect(fast.every((r) => typeof r.company === "string")).toBe(true);
  });

  it("vague instructions (< 120 chars) yield ~40% fewer records", () => {
    const vague = { ...componentOf("collector"), instructions: "Find funding rounds." };
    const records = parseRecords(driveAgent({ component: vague }).final);
    expect(records).toHaveLength(6);
  });

  it("honours one-off instructions: 'top 5' and a focus keyword", () => {
    const run = driveAgent({ component: componentOf("collector"), instructions: ["Focus on vector databases this week, top 5"] });
    const records = parseRecords(run.final);
    expect(records).toHaveLength(5);
    expect(records.slice(0, 4).every((r) => r.category === "Vector Database")).toBe(true);

    const strict = parseRecords(driveAgent({ component: componentOf("collector"), instructions: ["Only Series A rounds"] }).final);
    expect(strict.length).toBeGreaterThan(0);
    expect(strict.every((r) => r.stage === "Series A")).toBe(true);
  });

  it("reads one-off instructions from the message when the runtime passes none structurally", () => {
    const base = agentInput({ component: componentOf("collector"), instructions: ["top 3"] });
    const withoutStructured = { ...base, instructions: [] };
    let messages = withoutStructured.messages;
    let final: string | null = null;
    for (let i = 0; i < 8 && final === null; i++) {
      const res = sim.agentTurn({ ...withoutStructured, messages });
      if (!res.toolCalls?.length) final = res.text;
      else messages = [...messages, { role: "assistant", content: res.text, toolCalls: res.toolCalls.map((c, j) => ({ id: `t${i}_${j}`, ...c })) }, ...res.toolCalls.map((c, j) => ({ role: "tool" as const, toolCallId: `t${i}_${j}`, toolName: c.name, output: { error: "offline" }, isError: true }))];
    }
    expect(parseRecords(final)).toHaveLength(3);
  });

  it("categorizes feedback from the dataset with ground-truth labels when read_dataset is granted", () => {
    const component = categorizerComponent();
    const run = driveAgent({ component, spec: feedbackSpec() });
    expectWellFormed(run, component);
    expect(run.calls.map((c) => c.name)).toEqual(["read_dataset"]);
    expect((run.calls[0].input as { dataset: string }).dataset).toBe("customer_feedback");

    const records = parseRecords(run.final);
    expect(records).toHaveLength(40);
    const truth = new Map(sim.feedback().map((f) => [f.id, f]));
    for (const r of records) {
      expect(Object.keys(r)).toEqual(["id", "customer", "text", "category", "sentiment", "severity"]);
      const f = truth.get(String(r.id));
      expect(f).toBeDefined();
      expect(r.category).toBe(f?.category);
      expect(r.sentiment).toBe(f?.sentiment);
      expect(r.severity).toBe(f?.severity);
      expect(r.customer).toBe(f?.customer);
    }
    expect(new Set(records.map((r) => r.category)).size).toBeGreaterThanOrEqual(7);
  });

  it("prefers the dataset over the web for ticket triage and maps synonym field names", () => {
    const spec = makeJobSpec({
      title: "Support Ticket Triage",
      jobFamily: "support_triage",
      summary: "Classifies and routes inbound support tickets every day.",
      objective: "Read new support tickets, classify each by category and priority, and route it to the right team.",
      responsibilities: ["Classify tickets", "Route tickets"],
      deliverable: {
        title: "Daily Ticket Triage",
        description: "Triaged tickets.",
        format: "csv",
        fields: [
          { name: "ticket_id", description: "Id", required: true },
          { name: "subject", description: "Subject", required: true },
          { name: "category", description: "Category", required: true },
          { name: "priority", description: "Priority", required: true },
          { name: "route_to", description: "Team", required: true },
        ],
        sections: [],
        targetCount: 20,
      },
    });
    const component = { ...categorizerComponent(), tools: ["read_dataset", "web_search", "fetch_url"] };
    const run = driveAgent({ component, spec });
    expectWellFormed(run, component);
    expect(run.calls.map((c) => c.name)).toEqual(["read_dataset"]);
    const records = parseRecords(run.final);
    expect(records).toHaveLength(20);
    expect(records[0].ticket_id).toMatch(/^TCK-\d{4}$/);
    expect(["Billing", "Engineering", "Customer Success", "Security", "Integrations", "Product", "Site Reliability"]).toContain(records[0].route_to);
    expect(new Set(records.map((r) => r.category)).size).toBeGreaterThanOrEqual(5);
  });

  it("adapts to tool errors and always terminates within maxTurns", () => {
    const component = componentOf("collector");
    const searchDown = driveAgent({ component }, { failing: { web_search: "rate limited" } });
    expectWellFormed(searchDown, component);
    expect(searchDown.calls.map((c) => c.name)).toEqual(["web_search", "web_search"]);
    expect(parseRecords(searchDown.final).length).toBeGreaterThan(0);

    const fetchDown = driveAgent({ component }, { failing: { fetch_url: "timeout" } });
    expectWellFormed(fetchDown, component);
    expect(fetchDown.calls.filter((c) => c.name === "fetch_url").length).toBeGreaterThan(0);
    expect(fetchDown.calls.some((c) => c.name === "extract_data")).toBe(true); // falls back to snippets
    expect(parseRecords(fetchDown.final).length).toBe(10);

    const allDown = driveAgent({ component }, { failing: { web_search: "x", fetch_url: "y", extract_data: "z" } });
    expectWellFormed(allDown, component);
    expect(allDown.turns).toBe(2);
    expect(parseRecords(allDown.final).length).toBe(10);

    const datasetDown = driveAgent({ component: { ...component, tools: ["read_dataset", "web_search", "fetch_url", "extract_data"] } }, { failing: { read_dataset: "missing" } });
    expect(datasetDown.calls.map((c) => c.name).slice(0, 2)).toEqual(["read_dataset", "web_search"]);
    expect(parseRecords(datasetDown.final).length).toBe(10);
  });

  it("respects tight turn budgets and works with no tools at all", () => {
    const one = driveAgent({ component: { ...componentOf("collector"), maxTurns: 1 } });
    expect(one.turns).toBe(1);
    expect(one.calls).toHaveLength(0);
    expect(parseRecords(one.final)).toHaveLength(10);

    const two = driveAgent({ component: { ...componentOf("collector"), maxTurns: 2 } });
    expect(two.turns).toBe(2);
    expect(two.calls.every((c) => c.name === "web_search")).toBe(true);

    const three = driveAgent({ component: { ...componentOf("collector"), maxTurns: 3 } });
    expect(three.turns).toBe(3);
    expect(three.calls.map((c) => c.name)).not.toContain("extract_data");

    const none = driveAgent({ component: { ...componentOf("collector"), tools: [] } });
    expect(none.turns).toBe(1);
    expect(parseRecords(none.final)).toHaveLength(10);
    expect(parseRecords(none.final).every((r) => REQUIRED.every((f) => r[f] !== null))).toBe(true);
  });

  it("never calls a tool that was not offered, even if the component lists it", () => {
    const run = driveAgent({ component: componentOf("collector"), tools: ["fetch_url", "extract_data"] });
    expect(run.calls).toHaveLength(0);
    expect(parseRecords(run.final).length).toBeGreaterThan(0);
  });

  it("builds lead lists with fictional contacts from company pages", () => {
    const spec = makeJobSpec({
      title: "AI Infra Lead List Builder",
      jobFamily: "lead_research",
      summary: "Builds a weekly list of recently funded AI infrastructure companies with a buyer contact.",
      objective: "Find recently funded AI infrastructure startups and identify the most likely buyer contact at each.",
      responsibilities: ["Find funded companies", "Identify the buyer"],
      deliverable: {
        title: "Weekly Lead List",
        description: "Leads",
        format: "csv",
        fields: [
          { name: "company", description: "Company", required: true },
          { name: "website", description: "Website", required: true },
          { name: "contact_name", description: "Contact", required: true },
          { name: "title", description: "Title", required: false },
          { name: "email", description: "Email", required: true },
          { name: "why_now", description: "Reason", required: false },
        ],
        sections: [],
        targetCount: 8,
      },
    });
    const component = componentOf("collector");
    const run = driveAgent({ component, spec });
    expectWellFormed(run, component);
    const records = parseRecords(run.final);
    expect(records).toHaveLength(8);
    for (const r of records) {
      expect(String(r.email)).toMatch(/^[a-z.]+@[a-z0-9-]+\.example$/);
      expect(String(r.website)).toMatch(/^https:\/\/[a-z0-9-]+\.example$/);
      expect(String(r.contact_name)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(String(r.why_now)).toMatch(/Raised a \$/);
    }
  });

  it("expands pricing specs that ask for a plan column into one row per company × plan", () => {
    const spec = makeJobSpec({
      title: "Vector Database Pricing Monitor",
      jobFamily: "market_analysis",
      summary: "Tracks competitor pricing for vector databases.",
      objective: "Compare the public pricing of vector database vendors and flag changes.",
      responsibilities: ["Compare pricing pages"],
      deliverable: {
        title: "Vector DB Pricing Comparison",
        description: "Pricing",
        format: "csv",
        fields: [
          { name: "vendor", description: "Vendor", required: true },
          { name: "plan", description: "Plan", required: true },
          { name: "price_usd", description: "Price", required: false },
          { name: "pricing_url", description: "URL", required: true },
        ],
        sections: [],
        targetCount: 12,
      },
    });
    const component = componentOf("collector");
    const run = driveAgent({ component, spec });
    expectWellFormed(run, component);
    const records = parseRecords(run.final);
    expect(records).toHaveLength(12);
    expect(new Set(records.map((r) => r.vendor)).size).toBe(4);
    expect(records.every((r) => String(r.pricing_url).endsWith("/pricing"))).toBe(true);
    expect(records.some((r) => r.plan === "Enterprise")).toBe(true);
  });

  it("still produces spec-shaped, non-empty records for jobs outside the fixture universe", () => {
    const spec = makeJobSpec({
      title: "Invoice Categorizer",
      jobFamily: "finance_ops",
      summary: "Categorizes vendor invoices for the finance team every week.",
      objective: "Categorize incoming vendor invoices by spend category and flag anomalies.",
      responsibilities: ["Categorize each invoice"],
      successCriteria: [{ id: "coverage", description: "Every invoice is categorized" }],
      constraints: [],
      deliverable: {
        title: "Weekly Invoice Summary",
        description: "Invoices",
        format: "csv",
        fields: [
          { name: "invoice_id", description: "Id", required: true },
          { name: "vendor", description: "Vendor", required: true },
          { name: "amount", description: "Amount", required: true },
          { name: "spend_category", description: "Category", required: false },
        ],
        sections: [],
      },
    });
    const component = componentOf("collector");
    const run = driveAgent({ component, spec });
    expectWellFormed(run, component);
    const records = parseRecords(run.final);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(Object.keys(r)).toEqual(["invoice_id", "vendor", "amount", "spend_category"]);
      expect(r.invoice_id).toMatch(/^INV-\d+$/);
      expect(typeof r.amount).toBe("number");
      expect(typeof r.spend_category).toBe("string");
    }
  });
});
