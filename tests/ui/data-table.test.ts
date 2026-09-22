import { describe, expect, it } from "vitest";
import { buildDataTableModel, columnLabel, type DataTableHeader } from "@/lib/cell-format";

// `DataTable` renders its header row and every body row from `model.headers`, so these assertions cover the
// rendered shape without a DOM (the vitest config only compiles `.ts`, not JSX).

const labels = (headers: DataTableHeader[]) => headers.map((h) => h.label);
const fieldKeys = (headers: DataTableHeader[]) => headers.flatMap((h) => (h.kind === "field" ? [h.key] : []));

const funding = [
  { rank: 1, company: "Ridgeline GPU", hq: "Denver, CO", amount_usd: 210_000_000, source_url: "https://news.example/a" },
  { rank: 2, company: "Latchkey AI", hq: "San Francisco, CA", amount_usd: 72_000_000, source_url: "https://news.example/b" },
];

describe("DataTable model: row-number column", () => {
  it("leads with a '#' column by default", () => {
    const model = buildDataTableModel({ rows: funding });
    expect(model.headers[0]).toEqual({ kind: "index", label: "#" });
    expect(labels(model.headers)).toEqual(["#", "Rank", "Company", "HQ", "Amount USD", "Source URL"]);
    // The row-number column is chrome, not data.
    expect(model.fieldCount).toBe(5);
  });

  it("showIndex: false drops the '#' header — and with it every per-row index cell", () => {
    const model = buildDataTableModel({ rows: funding, showIndex: false });
    expect(model.headers.some((h) => h.kind === "index")).toBe(false);
    expect(labels(model.headers)).toEqual(["Rank", "Company", "HQ", "Amount USD", "Source URL"]);
    expect(model.fieldCount).toBe(5);
    expect(model.visibleRows).toHaveLength(2);
  });

  it("showIndex: true is the same as leaving it out", () => {
    expect(buildDataTableModel({ rows: funding, showIndex: true })).toEqual(buildDataTableModel({ rows: funding }));
  });

  it("the deliverable page's rule: hide '#' exactly when the columns include `rank`", () => {
    const showIndexFor = (columns: string[] | null) => !columns?.includes("rank");
    const ranked = ["rank", "company", "hq"];
    const unranked = ["company", "hq"];
    expect(buildDataTableModel({ rows: funding, columns: ranked, showIndex: showIndexFor(ranked) }).headers[0]).toMatchObject({ kind: "field", key: "rank" });
    expect(buildDataTableModel({ rows: funding, columns: unranked, showIndex: showIndexFor(unranked) }).headers[0]).toEqual({ kind: "index", label: "#" });
    expect(showIndexFor(null)).toBe(true);
  });

  it("an empty table has no headers at all, index or not", () => {
    expect(buildDataTableModel({ rows: [] }).headers).toEqual([]);
    expect(buildDataTableModel({ rows: [{}] }).headers).toEqual([]);
    expect(buildDataTableModel({ rows: [], columns: [] }).totalRows).toBe(0);
  });
});

describe("DataTable model: headers", () => {
  it("humanizes keys with acronyms kept upper-case", () => {
    const rows = [{ id: 7, ceo: "Dana Ruiz", cto: "Sam Lee", arr: 1_200_000, mrr: 100_000, nps: 61, sla: "4h", api: "REST", crm: "HubSpot", icp_score: 0.8, csv_url: "https://x.example/a.csv" }];
    expect(labels(buildDataTableModel({ rows, showIndex: false }).headers)).toEqual([
      "ID", "CEO", "CTO", "ARR", "MRR", "NPS", "SLA", "API", "CRM", "ICP score", "CSV URL",
    ]);
  });

  it("columnLabel is the header text", () => {
    expect(columnLabel("hq")).toBe("HQ");
    expect(columnLabel("source_url")).toBe("Source URL");
    expect(columnLabel("id")).toBe("ID");
    expect(columnLabel("funding_round")).toBe("Funding round");
  });

  it("honours explicit column order and marks all-numeric columns for right alignment", () => {
    const model = buildDataTableModel({ rows: funding, columns: ["company", "amount_usd", "rank"], showIndex: false });
    expect(fieldKeys(model.headers)).toEqual(["company", "amount_usd", "rank"]);
    expect(model.headers.map((h) => h.kind === "field" && h.numeric)).toEqual([false, true, true]);
  });

  it("infers columns in first-seen order when none are given", () => {
    const model = buildDataTableModel({ rows: [{ b: 1 }, { a: 2, b: 3 }] });
    expect(fieldKeys(model.headers)).toEqual(["b", "a"]);
  });
});

describe("DataTable model: rows", () => {
  it("truncates to maxRows but reports the true total", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ n: i }));
    const model = buildDataTableModel({ rows, maxRows: 5 });
    expect(model.visibleRows).toHaveLength(5);
    expect(model.totalRows).toBe(12);
    expect(buildDataTableModel({ rows, maxRows: 0 }).visibleRows).toHaveLength(1);
    expect(buildDataTableModel({ rows, maxRows: Number.NaN }).visibleRows).toHaveLength(12);
  });

  it("drops rows that aren't records instead of inventing columns from them", () => {
    const model = buildDataTableModel({ rows: [null, "x", 3, ["a", "b"], { company: "Acme" }] });
    expect(model.totalRows).toBe(1);
    expect(fieldKeys(model.headers)).toEqual(["company"]);
    expect(buildDataTableModel({ rows: "not rows" }).totalRows).toBe(0);
  });
});
