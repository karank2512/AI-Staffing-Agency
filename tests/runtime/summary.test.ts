import { describe, expect, it } from "vitest";
import { deliverableSummary, narrativeSummary, recordsSummary } from "@/server/runtime/summary";
import { makeBlueprint, makeJobSpec } from "../helpers/fixtures";

const rounds = [
  { rank: 1, company: "Ridgeline GPU", stage: "Series C", amount_usd: 210_000_000, source_url: "https://news.example/a" },
  { rank: 2, company: "Parallax Serve", stage: "Series C", amount_usd: 150_000_000, source_url: "https://news.example/b" },
  { rank: 3, company: "Halcyon Compute", stage: "Series B", amount_usd: 85_000_000, source_url: "https://news.example/c" },
  { rank: 4, company: "Stratacore", stage: "Seed", amount_usd: 7_500_000, source_url: "https://news.example/d" },
];
const csv = "rank,company,stage,amount_usd,source_url\n1,Ridgeline GPU,Series C,210000000,https://news.example/a\n";

describe("runtime: deliverable summary", () => {
  const spec = makeJobSpec();

  it("never uses CSV text as the summary: a CSV deliverable is summarized from its records", () => {
    const blueprint = makeBlueprint({ overrides: { deliverable: { titleTemplate: "Rounds — {{date}}", format: "csv", contentKey: "report", dataKey: "records" } } });
    const summary = deliverableSummary({ blueprint, spec, contentValue: csv, content: csv, records: rounds });
    expect(summary).toBe("4 funding rounds, ranked by amount — top: Ridgeline GPU ($210M), Parallax Serve ($150M), Halcyon Compute ($85M).");
    expect(summary).not.toContain("amountusd");
    expect(summary).not.toContain("rank,company");
  });

  it("falls back to the CSV's shape when there are no records to describe", () => {
    const blueprint = makeBlueprint({ overrides: { deliverable: { titleTemplate: "Rounds", format: "csv", contentKey: "report" } } });
    expect(deliverableSummary({ blueprint, spec, contentValue: csv, content: csv, records: null })).toBe("1 row × 5 columns.");
  });

  it("says plainly when a data deliverable came out empty", () => {
    const blueprint = makeBlueprint({ overrides: { deliverable: { titleTemplate: "Rounds", format: "json", contentKey: "records", dataKey: "records" } } });
    expect(deliverableSummary({ blueprint, spec, contentValue: [], content: "[]", records: [] })).toBe("No funding rounds made it into this deliverable.");
  });

  it("does not claim a ranking the records do not have yet", () => {
    const unranked = rounds.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "rank")));
    expect(recordsSummary(unranked, makeBlueprint(), spec)).toBe("4 funding rounds, including Ridgeline GPU, Parallax Serve and Halcyon Compute.");
  });

  it("names the first records when nothing ranks them", () => {
    const blueprint = makeBlueprint({ overrides: { components: makeBlueprint().components.filter((c) => c.id !== "rank") } });
    const leads = makeJobSpec({ jobFamily: "lead_research" });
    expect(recordsSummary(rounds.slice(0, 2), blueprint, leads)).toBe("2 leads, including Ridgeline GPU and Parallax Serve.");
  });

  it("keeps the narrative opening for markdown reports", () => {
    const blueprint = makeBlueprint();
    const md = "# Report\n\n## Summary\n\nThis run covered **24 items** in `amount_usd` terms.";
    expect(deliverableSummary({ blueprint, spec, contentValue: md, content: md, records: rounds })).toBe("This run covered 24 items in amount_usd terms.");
    expect(narrativeSummary("# Only a heading\n\n| a |\n| --- |")).toBe("");
    // No prose at all: the records speak instead.
    expect(deliverableSummary({ blueprint, spec, contentValue: "# Title", content: "# Title", records: rounds })).toMatch(/^4 funding rounds, ranked by amount/);
  });
});
