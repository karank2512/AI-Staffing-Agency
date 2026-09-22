import { describe, expect, it } from "vitest";
import { constraintMisses, countryOfLocation, parseConstraints, sectorOfText } from "@/server/simulation/constraints";
import { makeJobSpec } from "../helpers/fixtures";
import { componentOf, driveAgent, parseRecords, sim } from "./helpers";

/**
 * Briefs that restrict WHICH companies count ("15 Series A fintech companies in Europe") must be honoured by the
 * simulated web and the mock brain — and the simulated judge must notice when they are not (evaluation suite).
 */

const KAI_BRIEF =
  "Every weekday morning, research 15 Series A fintech companies in Europe that are hiring engineers. Give me a CSV with company, website, funding stage, headcount and a one-line reason each is a good fit for our developer tools.";

const EUROPE = new Set(["United Kingdom", "Germany", "France", "Netherlands", "Sweden", "Spain", "Ireland", "Switzerland", "Italy", "Portugal", "Denmark", "Poland", "Austria", "Estonia"]);

describe("constraints: parsing a brief", () => {
  it("reads stage, region and sector from the target phrase", () => {
    expect(parseConstraints(KAI_BRIEF)).toEqual({
      stages: ["Series A"],
      regions: ["Europe"],
      countries: [],
      sector: "fintech",
      labels: ["Series A", "Europe", "fintech"],
    });
    expect(parseConstraints("Build a weekly lead list of Series A fintech companies as a CSV.")).toMatchObject({ stages: ["Series A"], regions: [], sector: "fintech" });
  });

  it("expands stage ranges and lists", () => {
    expect(parseConstraints("AI infrastructure — compute, inference; seed to Series C").stages).toEqual(["Seed", "Series A", "Series B", "Series C"]);
    expect(parseConstraints("Series A–B fintechs").stages).toEqual(["Series A", "Series B"]);
    expect(parseConstraints("Series A or B payments startups").stages).toEqual(["Series A", "Series B"]);
    expect(parseConstraints("early-stage startups").stages).toEqual(["Pre-seed", "Seed", "Series A"]);
  });

  it("ignores the customer's own descriptions, pronouns and look-alikes", () => {
    // "our developer tools", "our European customers", "send us", "Amounts in USD", "seed data".
    const c = parseConstraints("Send us a list of startups. It should suit our developer tools and our European customers. Amounts in USD. Use the seed data.");
    expect(c).toMatchObject({ stages: [], regions: [], sector: null });
    // Upper-case US is the country; it also works as "US-based".
    expect(parseConstraints("Find US-based Series A payments startups")).toMatchObject({ countries: ["United States"], regions: ["North America"], sector: "fintech" });
    expect(parseConstraints("UK fintechs")).toMatchObject({ countries: ["United Kingdom"], regions: ["Europe"] });
  });

  it("matches a subject only on what it states", () => {
    const c = parseConstraints("15 Series A fintech companies in Europe");
    expect(constraintMisses({ stage: "Series C", location: "Denver, CO", sector: "ai_infrastructure" }, c)).toEqual(["stage", "region", "sector"]);
    expect(constraintMisses({ stage: "Series A round", location: "Berlin, Germany", sector: "fintech" }, c)).toEqual([]);
    expect(constraintMisses({}, c)).toEqual([]);
    expect(countryOfLocation("Austin, TX")).toBe("United States");
    expect(countryOfLocation("London, UK")).toBe("United Kingdom");
    expect(countryOfLocation("Singapore")).toBe("Singapore");
    expect(sectorOfText("Payments Infrastructure")).toBe("fintech");
    expect(sectorOfText("GPU Cloud")).toBe("ai_infrastructure");
    // Category beats incidental prose: labeling for clinical text with compliance workflows is AI data work.
    expect(sectorOfText("Data Labeling · medical imaging and clinical text")).toBe("ai_infrastructure");
  });
});

describe("simulated web: constrained queries", () => {
  it("serves the fintech universe for fintech queries, led by a directory search that lists exactly the matches", () => {
    const results = sim.search("Series A fintech companies in Europe", { maxResults: 8 });
    expect(results[0].url).toBe("https://directory.example/fintech/search?stage=series-a&region=europe");
    const page = sim.fetchPage(results[0].url);
    const listed = page.text.split("\n").slice(1);
    expect(listed.length).toBeGreaterThanOrEqual(15);
    for (const line of listed) {
      expect(line).toContain("Series A");
      const hq = /HQ ([^·]+) ·/.exec(line)?.[1].trim() ?? "";
      expect(EUROPE.has(countryOfLocation(hq) ?? ""), hq).toBe(true);
    }
    // Every other result is a fintech page that resolves.
    for (const r of results.slice(1)) expect(sim.fetchPage(r.url).text).not.toMatch(/GPU|inference|vector database/i);
  });

  it("leaves unconstrained AI-infrastructure searches exactly as they were", () => {
    const results = sim.search("recently funded AI infrastructure startups");
    expect(results.some((r) => r.url.includes("/search?"))).toBe(false);
    expect(results[0].title).toMatch(/AI infrastructure startups that raised this month/);
  });

  it("routes spend questions to the finance ledger, not to customer reviews", () => {
    const results = sim.search("SaaS spend review", { maxResults: 6 });
    expect(results[0].url).toBe("https://finance.example/acme/saas");
    expect(results.some((r) => r.url.startsWith("https://reviews.example/"))).toBe(false);
    const page = sim.fetchPage(results[0].url);
    expect(page.text).toMatch(/TXN-\d{4} · \d{4}-\d{2}-\d{2} · /);
    expect(page.text).toContain("flag:");
    // "customer reviews" is still feedback.
    expect(sim.search("customer reviews of our app")[0].url).toMatch(/^https:\/\/reviews\.example\//);
  });
});

describe("collector brain: honours the brief", () => {
  const kaiSpec = makeJobSpec({
    title: "European Series A fintech companies hiring engineers",
    objective: KAI_BRIEF,
    constraints: ["Only announcements from the last 30 days"],
    deliverable: {
      title: "Daily fintech research",
      description: "Series A fintechs in Europe",
      format: "csv",
      fields: [
        { name: "company", description: "Company", required: true },
        { name: "stage", description: "Funding stage", required: true },
        { name: "hq", description: "Headquarters", required: true },
        { name: "category", description: "Segment", required: false },
        { name: "source_url", description: "Source", required: true },
      ],
      sections: [],
      targetCount: 15,
    },
  });

  it("delivers 15 Series A fintech companies headquartered in Europe", () => {
    const run = driveAgent({ component: componentOf("collector"), spec: kaiSpec });
    const records = parseRecords(run.final);
    expect(records).toHaveLength(15);
    for (const r of records) {
      expect(r.stage).toBe("Series A");
      expect(EUROPE.has(countryOfLocation(String(r.hq)) ?? ""), String(r.hq)).toBe(true);
      expect(sectorOfText(String(r.category))).toBe("fintech");
    }
    // It found them through the directory search a researcher would use first.
    expect(run.calls.some((c) => c.name === "fetch_url" && String((c.input as { url: string }).url).includes("/fintech/search?"))).toBe(true);
  });

  it("returns fewer records rather than padding with companies that break the brief", () => {
    const tight = makeJobSpec({ ...kaiSpec, title: "Series B insurtech companies in Singapore", objective: "Find Series B insurtech companies in Singapore." });
    const records = parseRecords(driveAgent({ component: componentOf("collector"), spec: tight }).final);
    for (const r of records) expect(r.stage).toBe("Series B");
    expect(records.length).toBeLessThan(15);
  });

  it("does not mistake 'lead investor' for sales leads when choosing its searches", () => {
    const spec = makeJobSpec({ objective: "Track newly funded AI infrastructure startups every week. For each round capture the company, stage, amount, lead investor and a source link." });
    const run = driveAgent({ component: componentOf("collector"), spec });
    const queries = run.calls.filter((c) => c.name === "web_search").map((c) => String((c.input as { query: string }).query));
    expect(queries.join(" | ")).not.toMatch(/leadership contacts/);
  });
});

describe("collector brain: finance jobs work from the spend ledger", () => {
  const financeComponent = () => ({ ...componentOf("collector"), tools: ["web_search", "fetch_url", "extract_data"] });
  const spendSpec = makeJobSpec({
    title: "SaaS Spend Review",
    jobFamily: "finance_ops",
    summary: "Monthly review of what Acme pays for software.",
    objective: "Once a month, review our SaaS spend. List every tool we pay for with vendor, monthly cost, owner and renewal date, flag anything unused or duplicated, and give me a CSV.",
    responsibilities: ["Review every software charge"],
    constraints: [],
    deliverable: {
      title: "Monthly SaaS spend review",
      description: "Every software charge with flags",
      format: "csv",
      fields: [
        { name: "transaction_id", description: "Ledger id", required: true },
        { name: "vendor", description: "Vendor", required: true },
        { name: "amount_usd", description: "Amount", required: true },
        { name: "category", description: "Category", required: true },
        { name: "status", description: "Payment status", required: true },
        { name: "owner", description: "Budget owner", required: false },
        { name: "renewal_date", description: "Next renewal", required: false },
        { name: "flag_reason", description: "Why it needs a look", required: false },
      ],
      sections: [],
      targetCount: 50,
    },
  });

  it("reads the ledger (not customer reviews) and returns complete, software-only lines with real flags", () => {
    const run = driveAgent({ component: financeComponent(), spec: spendSpec });
    const fetched = run.calls.filter((c) => c.name === "fetch_url").map((c) => String((c.input as { url: string }).url));
    expect(fetched[0]).toBe("https://finance.example/acme/saas");
    expect(fetched.some((u) => u.includes("reviews.example"))).toBe(false);
    const records = parseRecords(run.final);
    expect(records.length).toBeGreaterThanOrEqual(30);
    for (const r of records) {
      for (const f of ["transaction_id", "vendor", "amount_usd", "category", "status"]) expect(r[f], f).not.toBeNull();
      expect(String(r.transaction_id)).toMatch(/^TXN-\d{4}$/);
      expect(String(r.category)).toMatch(/^Software/);
    }
    const flags = records.map((r) => r.flag_reason).filter((f): f is string => typeof f === "string");
    expect(flags.some((f) => /duplicate/i.test(f))).toBe(true);
    expect(flags.some((f) => /seats active/i.test(f))).toBe(true);
    expect(flags.some((f) => /overlaps/i.test(f))).toBe(true);
  });
});
