import { describe, expect, it } from "vitest";
import type { DeterministicComponent } from "@/server/domain/blueprint";
import {
  compileReport,
  computeStats,
  dedupe,
  filter,
  formatColumnCell,
  formatUsdCompact,
  humanizeHeader,
  isMoneyColumn,
  isUrlColumn,
  isMissing,
  matches,
  rank,
  renderTable,
  runDeterministic,
  toCsv,
  toNumber,
  validateRecords,
  type ReportMeta,
} from "@/server/runtime/deterministic";

const records = [
  { company: "Vectorloom", stage: "Series B", amount_usd: "$12.5M", lead_investor: "Ridge Capital", category: "vector db" },
  { company: "vectorloom ", stage: "Series B", amount_usd: 12_500_000, lead_investor: "Ridge Capital", category: "vector db" },
  { company: "Tensorbay", stage: "Seed", amount_usd: "3,000,000", lead_investor: "", category: "training" },
  { company: "Gradient Forge", stage: "Series A", amount_usd: null, lead_investor: "Northwind", category: "training" },
  { company: "", stage: "Seed", amount_usd: "1.2M", category: "serving" },
  { company: "Latchkey AI", stage: "Series C", amount_usd: "$40M", lead_investor: "Summit", category: "serving" },
];

describe("deterministic: record helpers", () => {
  it.each([
    ["$12.5M", 12_500_000],
    ["12,500,000", 12_500_000],
    ["3,000,000", 3_000_000],
    ["1.2M", 1_200_000],
    ["€2.5bn", 2_500_000_000],
    ["40k", 40_000],
    ["18%", 18],
    ["(1,200)", -1200],
    ["-7.5", -7.5],
    [42, 42],
    ["n/a", undefined],
    ["", undefined],
    [null, undefined],
    [true, undefined],
    [Number.NaN, undefined],
  ])("toNumber(%j) → %j", (input, expected) => {
    expect(toNumber(input)).toBe(expected);
  });

  it("treats null / undefined / blank strings as missing, but not false or 0", () => {
    expect(isMissing(null)).toBe(true);
    expect(isMissing(undefined)).toBe(true);
    expect(isMissing("")).toBe(true);
    expect(isMissing("   ")).toBe(true);
    expect(isMissing(false)).toBe(false);
    expect(isMissing(0)).toBe(false);
  });

  it("humanizes headers", () => {
    expect(humanizeHeader("amount_usd")).toBe("Amount USD");
    expect(humanizeHeader("source_url")).toBe("Source URL");
    expect(humanizeHeader("leadInvestor")).toBe("Lead investor");
    expect(humanizeHeader("company")).toBe("Company");
  });
});

describe("deterministic: dedupe", () => {
  it("is case- and whitespace-insensitive on the key fields and keeps the first occurrence", () => {
    const r = dedupe(records, { keyFields: ["company"] });
    expect(r.value.map((x) => x.company)).toEqual(["Vectorloom", "Tensorbay", "Gradient Forge", "", "Latchkey AI"]);
    expect(r.summary).toMatchObject({ before: 6, after: 5, removed: 1 });
    expect(r.detail).toBe("6 → 5 records (1 duplicate removed)");
  });

  it("uses all key fields together and never collapses records whose key is entirely missing", () => {
    const r = dedupe(
      [
        { company: "A", stage: "Seed" },
        { company: "a", stage: "Series A" },
        { company: null, stage: null },
        { company: "", stage: "" },
      ],
      { keyFields: ["company", "stage"] },
    );
    expect(r.value).toHaveLength(4);
  });

  it("tolerates non-array input", () => {
    expect(dedupe(undefined, { keyFields: ["x"] }).value).toEqual([]);
    expect(dedupe({ records: [{ x: 1 }, { x: 1 }] }, { keyFields: ["x"] }).value).toEqual([{ x: 1 }]);
    expect(dedupe([1, "two", null, { x: 1 }], { keyFields: ["x"] }).value).toEqual([{ x: 1 }]);
  });
});

describe("deterministic: validate_records", () => {
  it("drops records missing any required field and reports the gaps", () => {
    const r = validateRecords(records, { requiredFields: ["company", "amount_usd"], dropInvalid: true });
    expect(r.value.map((x) => x.company)).toEqual(["Vectorloom", "vectorloom ", "Tensorbay", "Latchkey AI"]);
    expect(r.summary).toMatchObject({ before: 6, after: 4, invalid: 2, dropped: 2, missingByField: [{ field: "amount_usd", missing: 1 }, { field: "company", missing: 1 }] });
    expect(r.detail).toContain("6 → 4 records");
  });

  it("keeps everything when dropInvalid is false", () => {
    // Tensorbay has "" and the nameless record has no key at all; both count as missing.
    const r = validateRecords(records, { requiredFields: ["lead_investor"], dropInvalid: false });
    expect(r.value).toHaveLength(6);
    expect(r.summary).toMatchObject({ invalid: 2, dropped: 0 });
    expect(r.detail).toBe("2 of 6 records incomplete (kept)");
  });
});

describe("deterministic: rank", () => {
  it("sorts numerically across messy formats, puts missing values last, limits and stamps rank", () => {
    const r = rank(records, { by: "amount_usd", direction: "desc", limit: 4 });
    expect(r.value.map((x) => [x.rank, x.company])).toEqual([
      [1, "Latchkey AI"],
      [2, "Vectorloom"],
      [3, "vectorloom "],
      [4, "Tensorbay"],
    ]);
    expect(r.summary).toMatchObject({ before: 6, after: 4, numericValues: 5 });
  });

  it("sorts ascending and keeps ties stable", () => {
    const r = rank(records, { by: "amount_usd", direction: "asc" });
    expect(r.value.map((x) => x.company)).toEqual(["", "Tensorbay", "Vectorloom", "vectorloom ", "Latchkey AI", "Gradient Forge"]);
    expect(r.value.at(-1)?.rank).toBe(6);
  });

  it("falls back to text ordering for non-numeric fields", () => {
    const r = rank(records, { by: "stage", direction: "asc" });
    expect(r.value.map((x) => x.stage)).toEqual(["Seed", "Seed", "Series A", "Series B", "Series B", "Series C"]);
  });
});

describe("deterministic: filter", () => {
  it.each<[Parameters<typeof matches>[1], string[]]>([
    [{ field: "amount_usd", op: "gt", value: "10M" }, ["Vectorloom", "vectorloom ", "Latchkey AI"]],
    [{ field: "amount_usd", op: "gte", value: 12_500_000 }, ["Vectorloom", "vectorloom ", "Latchkey AI"]],
    [{ field: "amount_usd", op: "lt", value: 5_000_000 }, ["Tensorbay", ""]],
    [{ field: "amount_usd", op: "lte", value: "1.2M" }, [""]],
    [{ field: "stage", op: "eq", value: "series b" }, ["Vectorloom", "vectorloom "]],
    [{ field: "stage", op: "neq", value: "Seed" }, ["Vectorloom", "vectorloom ", "Gradient Forge", "Latchkey AI"]],
    [{ field: "category", op: "contains", value: "TRAIN" }, ["Tensorbay", "Gradient Forge"]],
    [{ field: "lead_investor", op: "exists" }, ["Vectorloom", "vectorloom ", "Gradient Forge", "Latchkey AI"]],
    [{ field: "amount_usd", op: "gt" }, []],
  ])("filter %j", (config, expected) => {
    const r = filter(records, config);
    expect(r.value.map((x) => x.company)).toEqual(expected);
    expect(r.summary).toMatchObject({ before: 6, after: expected.length });
  });
});

describe("deterministic: compute_stats", () => {
  it("counts by group with shares and summarizes numeric fields with coercion", () => {
    const r = computeStats(records, { groupBy: "category", numericFields: ["amount_usd", "employees"] });
    expect(r.value.total).toBe(6);
    // Ties on count fall back to alphabetical order.
    expect(r.value.groups).toEqual([
      { key: "serving", count: 2, share: 0.3333 },
      { key: "training", count: 2, share: 0.3333 },
      { key: "vector db", count: 2, share: 0.3333 },
    ]);
    expect(r.value.numeric.amount_usd).toEqual({ count: 5, sum: 69_200_000, mean: 13_840_000, min: 1_200_000, max: 40_000_000, median: 12_500_000 });
    expect(r.value.numeric.employees).toBeUndefined();
    expect(r.detail).toBe("6 records · 3 category groups · summaries for amount_usd");
  });

  it("labels missing group values as unknown and handles empty input", () => {
    expect(computeStats([{ category: null }, { category: "" }, {}], { groupBy: "category", numericFields: [] }).value.groups).toEqual([{ key: "unknown", count: 3, share: 1 }]);
    expect(computeStats([], { groupBy: "category", numericFields: ["x"] }).value).toEqual({ total: 0, groups: [], numeric: {} });
  });
});

describe("deterministic: to_csv", () => {
  it("serializes with explicit or discovered columns, escaping as needed", () => {
    const r = toCsv(
      [
        { company: "Acme, Inc", amount_usd: 1200, note: 'said "hi"' },
        { company: "=SUM(A1)", amount_usd: null, extra: true },
      ],
      { columns: ["company", "amount_usd"] },
    );
    // Formula-looking cells are neutralised with a leading apostrophe (and quoted, as papaparse does).
    expect(r.value.split("\n")).toEqual(["company,amount_usd", '"Acme, Inc",1200', "\"'=SUM(A1)\","]);
    expect(r.summary).toMatchObject({ rows: 2, columns: ["company", "amount_usd"] });

    const discovered = toCsv([{ a: 1 }, { b: { nested: true } }], {});
    expect(discovered.value.split("\n")).toEqual(["a,b", "1,", ',"{""nested"":true}"']);
    expect(toCsv([], {}).value).toBe("");
  });
});

describe("deterministic: compile_report", () => {
  const meta: ReportMeta = {
    personaName: "Alex",
    now: new Date("2026-09-18T10:00:00Z"),
    pipeline: ["Researcher", "Validate records", "Remove duplicates", "Compile report"],
    toolUsage: [
      { label: "Web search", count: 2 },
      { label: "Read web page", count: 4 },
    ],
    recordTrail: [
      { label: "Validate records", before: 14, after: 12 },
      { label: "Remove duplicates", before: 12, after: 11 },
    ],
  };
  const many = Array.from({ length: 30 }, (_, i) => ({ rank: i + 1, company: `Company ${i + 1}`, amount_usd: (30 - i) * 1_000_000, stage: "Seed" }));
  const context = {
    insights: "## Highlights\n\nSerious money went to **vector databases** this week.\n\n- Vectorloom raised $12.5M",
    records: many,
    stats: computeStats(records, { groupBy: "category", numericFields: ["amount_usd"] }).value,
    bullets: ["Category A", "Category B"],
  };

  it("renders every section type, the GFM table with humanized headers and maxRows, and the methodology footer", () => {
    const r = compileReport(
      context,
      {
        title: "Weekly AI Infra Funding Report",
        sections: [
          { heading: "Summary", sourceKey: "insights", as: "markdown" },
          { heading: "Top rounds", sourceKey: "records", as: "table", columns: ["rank", "company", "amount_usd"], maxRows: 10 },
          { heading: "By category", sourceKey: "stats", as: "stats" },
          { heading: "Themes", sourceKey: "bullets", as: "bullets" },
        ],
        includeMethodology: true,
      },
      meta,
    );
    const md = r.value;
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Weekly AI Infra Funding Report");
    for (const heading of ["## Summary", "## Top rounds", "## By category", "## Themes", "## Methodology"]) expect(lines).toContain(heading);
    // Markdown sections are inserted as-is.
    expect(md).toContain("Serious money went to **vector databases** this week.");
    // Table: header + separator + 10 rows (money as compact dollars), then the "showing" note.
    expect(lines).toContain("| Rank | Company | Amount USD |");
    const tableRows = lines.filter((l) => /^\| \d+ \| Company \d+ \| \$\d+M \|$/.test(l));
    expect(tableRows).toHaveLength(10);
    expect(tableRows[0]).toBe("| 1 | Company 1 | $30M |");
    expect(md).toContain("_Showing 10 of 30 records._");
    // Stats: counts by group with shares + numeric summary.
    expect(md).toContain("**6 records** in total.");
    expect(md).toContain("| vector db | 2 | 33% |");
    // Money summaries are dollars too; the count is not.
    expect(md).toContain("| Amount USD | 5 | $69.2M | $13.8M | $1.2M | $40M |");
    // Bullets.
    expect(md).toContain("- Category A\n- Category B");
    // Methodology.
    expect(md).toContain("- Pipeline: Researcher → Validate records → Remove duplicates → Compile report.");
    expect(md).toContain("- Tools used: Web search ×2, Read web page ×4.");
    expect(md).toContain("- Records: 14 collected → 12 after validate records → 11 after remove duplicates.");
    expect(md).toContain("- Generated by Alex · 2026-09-18");
    expect(md.endsWith("\n")).toBe(true);
    expect(r.summary).toMatchObject({ sections: ["Summary (markdown)", "Top rounds (table)", "By category (stats)", "Themes (bullets)"] });
  });

  it("defaults to 25 rows and at most 8 auto-detected columns, and degrades gracefully on missing sources", () => {
    const wide = [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }];
    expect(renderTable(wide)[0]).toBe("| A | B | C | D | E | F | G | H |");
    expect(renderTable(many).filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(25);
    expect(renderTable([])).toEqual(["_No records._"]);

    const r = compileReport({}, { title: "Empty", sections: [{ heading: "Nothing", sourceKey: "missing", as: "markdown" }, { heading: "Rows", sourceKey: "missing", as: "table" }], includeMethodology: false }, meta);
    expect(r.value).toBe("# Empty\n\n## Nothing\n\n_No content._\n\n## Rows\n\n_No records._\n");
    expect(r.value).not.toContain("Methodology");
  });

  it("escapes pipes and newlines inside cells so the table stays intact", () => {
    const [, , row] = renderTable([{ name: "A | B", note: "line one\nline two" }]);
    expect(row).toBe("| A \\| B | line one line two |");
  });

  it("formats money columns as compact dollars and URL columns as host-labelled links, leaving the records untouched", () => {
    const rows = [
      {
        vendor: "Vectorloom",
        amount_usd: 85_000_000,
        price: "1,240",
        cost_per_seat: 94,
        monthly_price_usd: 19.5,
        source_url: "https://www.news.example/funding/vectorloom?utm=x",
        website: "vectorloom.example",
      },
    ];
    const before = structuredClone(rows);
    const [header, , row] = renderTable(rows);
    expect(header).toBe("| Vendor | Amount USD | Price | Cost per seat | Monthly price USD | Source URL | Website |");
    expect(row).toBe(
      "| Vectorloom | $85M | $1.2K | $94 | $19.50 | [news.example](https://www.news.example/funding/vectorloom?utm=x) | [vectorloom.example](https://vectorloom.example/) |",
    );
    // Only the rendering changes: Deliverable.data and the CSV keep the raw values.
    const report = compileReport({ records: rows }, { title: "T", sections: [{ heading: "Rows", sourceKey: "records", as: "table" }], includeMethodology: false }, meta);
    expect(report.value).toContain("$85M");
    expect(rows).toEqual(before);
    expect(toCsv(rows, {}).value.split("\n")[1]).toContain("85000000");
  });

  it("formats compact dollars at every scale and leaves values it cannot read as dollars alone", () => {
    expect([0, 0.0042, 0.42, 7, 94, 999, 1_000, 1_240, 999_949, 999_999, 7_500_000, 1_200_000_000, -1_500].map(formatUsdCompact)).toEqual([
      "$0", "$0.0042", "$0.42", "$7", "$94", "$999", "$1K", "$1.2K", "$999.9K", "$1M", "$7.5M", "$1.2B", "-$1.5K",
    ]);
    expect(formatColumnCell("$12.5M", "amount_usd")).toBe("$12.5M");
    expect(formatColumnCell("Contact sales", "monthly_price_usd")).toBe("Contact sales");
    expect(formatColumnCell("18%", "price")).toBe("18%");
    expect(formatColumnCell("€40", "price")).toBe("€40");
    expect(formatColumnCell(null, "price")).toBe("");
    expect(formatColumnCell("javascript:alert(1)", "source_url")).toBe("javascript:alert(1)");
    expect(formatColumnCell("n/a", "website")).toBe("n/a");
    expect(formatColumnCell("https://a.example/x (1)|y", "url")).toBe("[a.example](https://a.example/x%20%281%29%7Cy)");
    // Column vocabulary: shares, changes and other currencies are not dollars; plain counts are not money at all.
    expect(["amount_usd", "amount", "price", "unit_price", "cost", "monthlyPriceUsd", "arr_usd"].every(isMoneyColumn)).toBe(true);
    expect(["price_change_pct", "amount_eur", "seat_count", "employees", "rank", "change_since_last"].some(isMoneyColumn)).toBe(false);
    expect(["source_url", "url", "website", "pricing_url", "homepage", "linkedin_url"].every(isUrlColumn)).toBe(true);
    expect(isUrlColumn("company")).toBe(false);
    expect(formatColumnCell(12, "employees")).toBe("12");
  });
});

describe("deterministic: runDeterministic dispatch", () => {
  const meta: ReportMeta = { personaName: "Alex", now: new Date(), pipeline: [], toolUsage: [], recordTrail: [] };
  const base = { type: "deterministic" as const, name: "step", description: "d", inputKeys: ["records"], outputKey: "records" };

  it("routes every operation to its implementation over the primary input key", () => {
    const ctx = { records, other: [] };
    const run = (c: DeterministicComponent) => runDeterministic(c, ctx, meta).value;
    expect(run({ ...base, id: "a", operation: "dedupe", config: { keyFields: ["company"] } })).toHaveLength(5);
    expect(run({ ...base, id: "b", operation: "validate_records", config: { requiredFields: ["company"], dropInvalid: true } })).toHaveLength(5);
    expect(run({ ...base, id: "c", operation: "rank", config: { by: "amount_usd", direction: "desc", limit: 2 } })).toHaveLength(2);
    expect(run({ ...base, id: "d", operation: "filter", config: { field: "stage", op: "eq", value: "Seed" } })).toHaveLength(2);
    expect(run({ ...base, id: "e", operation: "compute_stats", config: { groupBy: "stage", numericFields: [] } })).toMatchObject({ total: 6 });
    expect(String(run({ ...base, id: "f", operation: "to_csv", config: {} }))).toMatch(/^company,stage,amount_usd/);
    expect(String(run({ ...base, id: "g", operation: "compile_report", config: { title: "T", sections: [{ heading: "H", sourceKey: "records", as: "table" }], includeMethodology: false } }))).toMatch(/^# T\n\n## H\n/);
  });
});
