import { describe, expect, it } from "vitest";
import { buildRoundups } from "@/server/simulation/catalog";
import { companyEntities } from "@/server/simulation/fixtures/companies";
import { SearchResultSchema } from "@/server/tools/schemas";
import { FIXED_NOW, sim } from "./helpers";

describe("simulation.search", () => {
  it("routes by keywords: funding → news, feedback → reviews, pricing → comparisons, anything else → generic", () => {
    const funding = sim.search("recently funded AI infrastructure startups");
    expect(funding.length).toBe(6);
    expect(funding.every((r) => r.url.startsWith("https://news.example/"))).toBe(true);
    expect(funding[0].title).toMatch(/AI infrastructure startups that raised this month/);

    const feedback = sim.search("customer feedback reviews about pricing");
    expect(feedback.some((r) => r.url === "https://reviews.example/acme/pricing")).toBe(true);
    expect(feedback.every((r) => r.url.startsWith("https://reviews.example/"))).toBe(true);

    const pricing = sim.search("vector database pricing comparison");
    expect(pricing[0].url).toMatch(/^https:\/\/compare\.example\/pricing\//);
    expect(pricing.some((r) => /\.example\/pricing$/.test(r.url))).toBe(true);

    const generic = sim.search("how to onboard remote employees");
    expect(generic.length).toBe(6);
    expect(generic.every((r) => r.url.endsWith(".example") || /\.example\//.test(r.url))).toBe(true);
    expect(generic.every((r) => !r.url.includes("news.example"))).toBe(true);
  });

  it("is deterministic, respects maxResults, and returns results that validate against SearchResultSchema", () => {
    expect(sim.search("AI infra funding")).toEqual(sim.search("AI infra funding"));
    expect(sim.search("AI infra funding", { maxResults: 3 })).toHaveLength(3);
    expect(sim.search("AI infra funding", { maxResults: 50 })).toHaveLength(10);
    for (const r of sim.search("AI infra funding", { maxResults: 10 })) {
      expect(SearchResultSchema.safeParse(r).success).toBe(true);
      expect(r.url).toMatch(/\.example/);
    }
  });

  it("surfaces the companies a specific query is about", () => {
    const results = sim.search("vector database startups that raised a Series A");
    const text = results.map((r) => `${r.title} ${r.snippet}`).join(" ");
    expect(text).toMatch(/Vectorloom|Nearside DB|Cosinebase|Embedwell/);
  });
});

describe("simulation.fetchPage", () => {
  it("serves every URL that search returns, with substantial text", () => {
    const queries = ["AI infrastructure funding this month", "customer feedback about onboarding", "GPU cloud pricing comparison", "leads at recently funded AI companies", "remote team onboarding"];
    for (const q of queries) {
      for (const r of sim.search(q, { maxResults: 10 })) {
        const page = sim.fetchPage(r.url);
        expect(page.url).toBe(r.url);
        expect(page.title.length).toBeGreaterThan(0);
        expect(page.text.length).toBeGreaterThan(200);
      }
    }
  });

  it("gives every company an article page stating its facts and a place in 1–2 roundup pages", () => {
    const companies = companyEntities(FIXED_NOW);
    const roundups = buildRoundups(companies);
    for (const c of companies) {
      const article = sim.fetchPage(c.source_url);
      expect(article.text).toContain(c.company);
      expect(article.text).toContain(c.stage);
      expect(article.text).toContain(c.lead_investor);
      expect(article.text).toContain(`USD ${c.amount_usd}`);
      expect(article.text).toContain(c.hq);
      const appearances = roundups.filter((r) => sim.fetchPage(r.url).text.includes(c.company)).length;
      expect(appearances).toBeGreaterThanOrEqual(1);
      expect(appearances).toBeLessThanOrEqual(2);
    }
  });

  it("never throws: unknown URLs and garbage get a plausible generic page", () => {
    const page = sim.fetchPage("https://unknown-site.example/blog/quarterly-planning-tips");
    expect(page.url).toBe("https://unknown-site.example/blog/quarterly-planning-tips");
    expect(page.title.toLowerCase()).toContain("quarterly planning tips");
    expect(page.text.length).toBeGreaterThan(200);
    expect(sim.fetchPage("not a url at all").text.length).toBeGreaterThan(0);
    expect(sim.fetchPage("")).toEqual(sim.fetchPage(""));
  });
});

describe("simulation.extractRecords", () => {
  it("search → fetch → extract recovers at least 8 companies with the required fields", () => {
    const results = sim.search("AI infrastructure startups funding", { maxResults: 8 });
    const text = results.slice(0, 4).map((r) => sim.fetchPage(r.url).text).join("\n\n");
    const records = sim.extractRecords(text, ["company", "stage", "amount_usd", "lead_investor", "source_url", "hq", "made_up_field"]);
    expect(records.length).toBeGreaterThanOrEqual(8);
    const known = new Map(sim.companies().map((c) => [c.company, c]));
    for (const r of records) {
      expect(Object.keys(r)).toEqual(["company", "stage", "amount_usd", "lead_investor", "source_url", "hq", "made_up_field"]);
      const c = known.get(String(r.company));
      expect(c).toBeDefined();
      expect(r.stage).toBe(c?.stage);
      expect(r.amount_usd).toBe(c?.amount_usd);
      expect(r.source_url).toBe(c?.source_url);
      expect(r.made_up_field).toBeNull();
    }
    expect(new Set(records.map((r) => r.company)).size).toBe(records.length);
  });

  it("maps field-name synonyms onto the same facts", () => {
    const text = sim.fetchPage("https://news.example/funding/vectorloom").text;
    const [r] = sim.extractRecords(text, ["name", "round", "round_size", "investor", "url", "location", "summary", "sector", "website"]);
    expect(r.name).toBe("Vectorloom");
    expect(r.round).toBe("Series B");
    expect(r.round_size).toBe(58_000_000);
    expect(r.investor).toBe("Foundry Lane Capital");
    expect(r.url).toBe("https://news.example/funding/vectorloom");
    expect(r.location).toBe("San Francisco, CA");
    expect(r.sector).toBe("Vector Database");
    expect(r.website).toBe("https://vectorloom.example");
    expect(typeof r.summary).toBe("string");
  });

  it("extracts feedback items (with ground-truth labels) from a reviews page", () => {
    const text = sim.fetchPage("https://reviews.example/acme/pricing").text;
    const records = sim.extractRecords(text, ["id", "customer", "category", "sentiment", "severity"]);
    expect(records.length).toBeGreaterThanOrEqual(5);
    expect(records.every((r) => r.category === "pricing")).toBe(true);
    expect(records.every((r) => typeof r.sentiment === "string")).toBe(true);
  });

  it("falls back to best-effort generic rows for unknown text, and respects maxRecords", () => {
    const text = sim.fetchPage("https://insights.example/articles/remote-team-rituals-1").text;
    const records = sim.extractRecords(text, ["title", "summary", "url"], { maxRecords: 2 });
    expect(records).toHaveLength(2);
    expect(typeof records[0].title).toBe("string");
    expect(typeof records[0].summary).toBe("string");
    expect(sim.extractRecords("", ["company"])).toEqual([]);
  });
});
