import { describe, expect, it } from "vitest";
import type { AgentComponent } from "@/server/domain/blueprint";
import type { JobSpec } from "@/server/domain/job-spec";
import { canonicalField } from "@/server/simulation/fields";
import { isMonthlyUnit } from "@/server/simulation/fixtures/pricing";
import { extractVendorNames, specVendorNames } from "@/server/simulation/vendors";
import { TOOL_INPUT_SCHEMAS, type ToolName } from "@/server/tools/schemas";
import { makeJobSpec } from "../helpers/fixtures";
import { componentOf, driveAgent, parseRecords, sim } from "./helpers";

const COMPETITORS = ["Notion", "Coda", "Airtable", "ClickUp", "Monday"];

/** The spec the simulated scoper writes for "check the pricing pages of our five main competitors (…)". */
function competitorSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return makeJobSpec({
    title: "Competitor Pricing Tracker",
    jobFamily: "market_analysis",
    summary: "Checks competitor pricing pages every week and flags what moved.",
    objective: "Every week, check the pricing pages of our five main competitors (Notion, Coda, Airtable, ClickUp, Monday). Capture plan name, monthly price, seat minimum and any change since last week.",
    responsibilities: ["Check each competitor's pricing page", "Capture the plan name, the monthly price, the seat minimum and any change since the last run"],
    inputs: [
      { name: "Competitor list", description: "Notion, Coda, Airtable, ClickUp, Monday", source: "user_instruction", required: true },
      { name: "Vendor websites", description: "Pricing and product pages", source: "web", required: true },
    ],
    constraints: ["Use list prices from vendor pages, not negotiated quotes", "Coverage: Notion, Coda, Airtable, ClickUp, Monday"],
    deliverable: {
      title: "Weekly Competitor Pricing",
      description: "One row per competitor plan.",
      format: "csv",
      fields: [
        { name: "competitor", description: "Competitor", required: true },
        { name: "plan_name", description: "Plan", required: true },
        { name: "monthly_price_usd", description: "Monthly list price", required: false },
        { name: "seat_minimum", description: "Seat minimum", required: false },
        { name: "change_since_last", description: "What changed", required: false },
        { name: "source_url", description: "Source", required: true },
      ],
      sections: [],
      targetCount: 15,
    },
    ...overrides,
  });
}

function expectValidCalls(calls: ReturnType<typeof driveAgent>["calls"], component: AgentComponent) {
  for (const call of calls) {
    expect(component.tools).toContain(call.name);
    expect(TOOL_INPUT_SCHEMAS[call.name as ToolName].safeParse(call.input).success).toBe(true);
  }
}

describe("simulation: vendors named in the spec", () => {
  it("reads vendor names from lists and cues, not from Title-Case titles, verbs or lone weekdays", () => {
    expect(extractVendorNames("check the pricing pages of our five main competitors (Notion, Coda, Airtable, ClickUp, Monday).")).toEqual(COMPETITORS);
    expect(extractVendorNames("Notion vs Coda Pricing Tracker")).toEqual(["Notion", "Coda"]);
    expect(extractVendorNames("Compare Hugging Face and Monday.com pricing")).toEqual(["Hugging Face", "Monday.com"]);
    expect(extractVendorNames("Track competitors like Linear on a weekly basis")).toEqual(["Linear"]);
    expect(extractVendorNames("compare Pinecone pricing plans")).toEqual(["Pinecone"]);
    // Not vendors: job titles, sentence-initial verbs, weekdays, departments, plan tiers, regions and categories.
    expect(extractVendorNames("Competitor Pricing Tracker")).toEqual([]);
    expect(extractVendorNames("Weekly Market Analysis Brief. Every Monday, analyze the pricing pages.")).toEqual([]);
    expect(extractVendorNames("Send it to Sales, Marketing and Finance.")).toEqual([]);
    expect(extractVendorNames("Compare the Free, Pro and Enterprise plans.")).toEqual([]);
    expect(extractVendorNames("Vendors in Germany, France and Spain")).toEqual([]);
    expect(extractVendorNames("Compare GPU Cloud, Vector Database and Edge AI vendors")).toEqual([]);
    expect(specVendorNames(competitorSpec())).toEqual(COMPETITORS);
  });

  it("searches for the named vendors first and reads their pricing pages before anything else", () => {
    const component = componentOf("collector");
    const run = driveAgent({ component, spec: competitorSpec() });
    expectValidCalls(run.calls, component);
    const searches = run.calls.filter((c) => c.name === "web_search").map((c) => (c.input as { query: string }).query);
    expect(searches[0]).toBe("compare Notion, Coda, Airtable, ClickUp and Monday pricing plans");
    const fetched = run.calls.filter((c) => c.name === "fetch_url").map((c) => (c.input as { url: string }).url);
    expect(fetched).toEqual(["https://notion.example/pricing", "https://coda.example/pricing", "https://airtable.example/pricing", "https://clickup.example/pricing"]);
  });

  it("delivers plan rows for EVERY named competitor, first, in the customer's spelling — deterministically", () => {
    const component = componentOf("collector");
    const run = driveAgent({ component, spec: competitorSpec() });
    const records = parseRecords(run.final);
    expect(driveAgent({ component, spec: competitorSpec() }).final).toBe(run.final);

    const competitors = [...new Set(records.map((r) => r.competitor))];
    expect(competitors.slice(0, 5)).toEqual(COMPETITORS);
    for (const name of COMPETITORS) {
      const plans = records.filter((r) => r.competitor === name);
      expect(plans.map((r) => r.plan_name)).toEqual(["Free", "Plus", "Business", "Enterprise"]);
      for (const r of plans) {
        expect(r.source_url).toBe(`https://${name.toLowerCase()}.example/pricing`);
        expect(typeof r.seat_minimum).toBe("number");
        expect(r.change_since_last).toMatch(/^(No change|Price (up|down) \d+%|New plan since last check|Free tier .+|Now requires an annual contract)$/);
      }
      expect(plans.find((r) => r.plan_name === "Free")?.monthly_price_usd).toBe(0);
      expect(typeof plans.find((r) => r.plan_name === "Plus")?.monthly_price_usd).toBe("number");
      expect(plans.find((r) => r.plan_name === "Enterprise")?.monthly_price_usd).toBeNull();
      // Free and contact-sales plans never "change price".
      expect(plans.filter((r) => r.plan_name === "Free" || r.plan_name === "Enterprise").some((r) => /^Price /.test(String(r.change_since_last)))).toBe(false);
    }
    // All five competitors fit even though 5 × 4 plans is more than the ~15 rows the spec expects.
    expect(records.length).toBeGreaterThanOrEqual(20);
  });

  it("serves an honest, clearly illustrative pricing page for a named vendor that extraction can read", () => {
    const results = sim.search("compare Notion, Coda and Airtable pricing plans");
    expect(results.slice(0, 3).map((r) => r.url)).toEqual(["https://notion.example/pricing", "https://coda.example/pricing", "https://airtable.example/pricing"]);
    expect(results.length).toBe(6);

    const page = sim.fetchPage("https://notion.example/pricing");
    expect(page.title).toBe("Pricing — Notion");
    expect(page.text).toContain("illustrative list prices");
    expect(page.text).toContain("Notion Plus plan: $");
    const rows = sim.extractRecords(page.text, ["vendor", "plan", "monthly_price_usd", "seat_minimum"]);
    expect(rows.map((r) => r.plan)).toEqual(["Free", "Plus", "Business", "Enterprise"]);
    expect(rows.every((r) => r.vendor === "Notion")).toBe(true);
    expect(sim.fetchPage("https://notion.example/pricing")).toEqual(page);
  });

  it("puts named fixture vendors first too, as themselves", () => {
    const spec = competitorSpec({
      objective: "Compare the public pricing of our competitors (Vectorloom, Halcyon Compute) every week.",
      constraints: [],
      inputs: [],
      responsibilities: ["Compare pricing pages"],
    });
    const records = parseRecords(driveAgent({ component: componentOf("collector"), spec }).final);
    expect([...new Set(records.map((r) => r.competitor))].slice(0, 2)).toEqual(["Vectorloom", "Halcyon Compute"]);
    expect(records.find((r) => r.competitor === "Vectorloom")?.source_url).toBe("https://vectorloom.example/pricing");
  });
});

describe("simulation: pricing facts", () => {
  it("never puts a per-GPU-hour or per-token price in a monthly column; the unit goes in the notes instead", () => {
    const spec = makeJobSpec({
      title: "GPU Cloud Pricing Monitor",
      jobFamily: "market_analysis",
      summary: "Tracks GPU cloud pricing.",
      objective: "Compare the public pricing of GPU cloud vendors.",
      responsibilities: ["Compare pricing pages"],
      deliverable: {
        title: "GPU pricing",
        description: "Pricing",
        format: "csv",
        fields: [
          { name: "vendor", description: "Vendor", required: true },
          { name: "plan", description: "Plan", required: true },
          { name: "monthly_price_usd", description: "Monthly", required: false },
          { name: "price_unit", description: "Unit", required: false },
          { name: "notes", description: "Notes", required: false },
        ],
        sections: [],
        targetCount: 12,
      },
    });
    const records = parseRecords(driveAgent({ component: componentOf("collector"), spec }).final);
    const hourly = records.filter((r) => /GPU-hour|tokens|requests|labeled item|annotator hour|run-hour|fine-tuning run|transaction/.test(String(r.price_unit)));
    expect(hourly.length).toBeGreaterThan(0);
    for (const r of hourly) {
      expect(r.monthly_price_usd).toBeNull();
      expect(String(r.notes)).toMatch(/^Usage-based: \$[\d.,]+ .+; no monthly list price\.$/);
    }
    for (const r of records.filter((x) => typeof x.monthly_price_usd === "number")) expect(isMonthlyUnit(String(r.price_unit))).toBe(true);

    // Vendor-level rows: the monthly column is the cheapest MONTHLY paid plan, or empty with the unit noted.
    const vendorLevel = sim.extractRecords(sim.fetchPage("https://compare.example/pricing/compute").text, ["vendor", "monthly_price_usd", "notes"]);
    expect(vendorLevel.length).toBeGreaterThan(3);
    const gpu = vendorLevel.find((r) => r.vendor === "Halcyon Compute");
    expect(gpu?.monthly_price_usd).toBeNull();
    expect(String(gpu?.notes)).toMatch(/per H100 GPU-hour; no monthly list price/);
    const orchestration = vendorLevel.find((r) => typeof r.monthly_price_usd === "number");
    expect(orchestration).toBeDefined();
  });

  it("answers seat-minimum, change and open-roles columns under their usual names, deterministically", () => {
    for (const name of ["seat_minimum", "minimum_seats", "min_seats"]) expect(canonicalField("company", name)).toBe("seat_minimum");
    for (const name of ["change_since_last", "change", "changes", "what_changed"]) expect(canonicalField("company", name)).toBe("change_since_last");
    for (const name of ["open_roles", "open_positions", "job_openings", "company_open_roles"]) expect(canonicalField("company", name)).toBe("open_roles");
    for (const name of ["monthly_price_usd", "price_per_month", "monthly_subscription_price", "cost_per_month_usd"]) expect(canonicalField("company", name)).toBe("monthly_price_usd");
    expect(canonicalField("company", "price_usd")).toBe("starting_price_usd");

    const text = sim.fetchPage("https://news.example/funding/halcyoncompute").text;
    const fields = ["company", "employees", "open_roles", "seat_minimum", "change", "what_changed", "min_seats"];
    const [row] = sim.extractRecords(text, fields);
    expect(row.company).toBe("Halcyon Compute");
    expect(Number.isInteger(row.open_roles) && Number(row.open_roles) >= 1 && Number(row.open_roles) < Number(row.employees)).toBe(true);
    expect(typeof row.seat_minimum).toBe("number");
    expect(row.min_seats).toBe(row.seat_minimum);
    expect(typeof row.change).toBe("string");
    expect(row.what_changed).toBe(row.change);
    expect(sim.extractRecords(text, fields)[0]).toEqual(row);
  });
});
