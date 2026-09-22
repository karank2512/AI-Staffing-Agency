import { describe, expect, it } from "vitest";
import { displayUrl, formatCell, inferColumns, isNumericColumn } from "@/lib/cell-format";
import { describeJsonShape, safeStringify, tokenizeJson } from "@/lib/json-highlight";

describe("formatCell", () => {
  it("renders empties as the empty kind", () => {
    for (const value of [null, undefined, "", "   ", [], Number.NaN]) {
      expect(formatCell(value)).toEqual({ kind: "empty" });
    }
  });

  it("groups numbers but leaves years and ids alone", () => {
    expect(formatCell(12_000_000, "amount_usd")).toEqual({ kind: "number", text: "12,000,000" });
    expect(formatCell(3.14159)).toEqual({ kind: "number", text: "3.14" });
    expect(formatCell(2021, "founded_year")).toEqual({ kind: "number", text: "2021" });
    expect(formatCell(2021, "year")).toEqual({ kind: "number", text: "2021" });
    expect(formatCell(104522, "ticket_id")).toEqual({ kind: "number", text: "104522" });
    expect(formatCell(2021, "headcount")).toEqual({ kind: "number", text: "2,021" });
    expect(formatCell(0)).toEqual({ kind: "number", text: "0" });
  });

  it("renders booleans as words", () => {
    expect(formatCell(true)).toEqual({ kind: "boolean", text: "Yes", value: true });
    expect(formatCell(false)).toEqual({ kind: "boolean", text: "No", value: false });
  });

  it("turns http(s) URLs into short links and nothing else", () => {
    expect(formatCell("https://www.vectorly.example/blog/series-b/?utm=x")).toEqual({
      kind: "link",
      href: "https://www.vectorly.example/blog/series-b/?utm=x",
      text: "vectorly.example/blog/series-b",
    });
    expect(formatCell("javascript:alert(1)").kind).toBe("text");
    expect(formatCell("see https://a.example for details").kind).toBe("text");
  });

  it("formats ISO dates without shifting the calendar day", () => {
    expect(formatCell("2026-09-17")).toEqual({ kind: "text", text: "Sep 17, 2026" });
    expect(formatCell("2026-01-01")).toEqual({ kind: "text", text: "Jan 1, 2026" });
    const stamp = formatCell("2026-09-17T14:45:00.000Z");
    expect(stamp.kind).toBe("text");
    expect(stamp.kind === "text" && stamp.text).toMatch(/^Sep 1[78], 2026, \d{1,2}:\d{2} [AP]M$/);
  });

  it("joins arrays and stringifies objects", () => {
    expect(formatCell(["pricing", "onboarding", 3])).toEqual({ kind: "text", text: "pricing, onboarding, 3" });
    expect(formatCell({ a: 1 })).toEqual({ kind: "text", text: '{"a":1}' });
    expect(formatCell([{ a: 1 }, null])).toEqual({ kind: "text", text: '{"a":1}' });
  });

  it("clips very long text", () => {
    const cell = formatCell("x".repeat(5000));
    expect(cell.kind === "text" && cell.text.length).toBe(600);
    expect(cell.kind === "text" && cell.text.endsWith("…")).toBe(true);
  });
});

describe("displayUrl", () => {
  it("strips protocol, www, query and trailing slash; truncates", () => {
    expect(displayUrl("https://www.acme.example/")).toBe("acme.example");
    expect(displayUrl("http://acme.example/a/b?x=1#y")).toBe("acme.example/a/b");
    expect(displayUrl(`https://acme.example/${"a".repeat(80)}`)).toHaveLength(48);
    expect(displayUrl("not a url")).toBe("not a url");
  });
});

describe("column inference", () => {
  const rows = [
    { company: "Acme", amount_usd: 10 },
    { company: "Globex", source_url: "https://g.example", amount_usd: null },
    { company: "Initech", amount_usd: 3.5, stage: "Seed" },
  ];

  it("unions keys in first-seen order", () => {
    expect(inferColumns(rows)).toEqual(["company", "amount_usd", "source_url", "stage"]);
    expect(inferColumns([])).toEqual([]);
  });

  it("detects numeric columns, ignoring gaps", () => {
    expect(isNumericColumn(rows, "amount_usd")).toBe(true);
    expect(isNumericColumn(rows, "company")).toBe(false);
    expect(isNumericColumn(rows, "missing")).toBe(false);
    expect(isNumericColumn([{ n: 1 }, { n: "2" }], "n")).toBe(false);
  });
});

describe("JSON helpers", () => {
  it("stringifies without throwing on cycles, bigint or undefined", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    expect(safeStringify(cyclic)).toContain('"self": "[Circular]"');
    expect(safeStringify({ n: BigInt(12) })).toContain('"n": "12"');
    expect(safeStringify(undefined)).toBe("undefined");
    expect(safeStringify({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });

  it("describes the top-level shape", () => {
    expect(describeJsonShape([1, 2, 3])).toBe("Array · 3 items");
    expect(describeJsonShape([1])).toBe("Array · 1 item");
    expect(describeJsonShape({ a: 1 })).toBe("Object · 1 key");
    expect(describeJsonShape(null)).toBe("null");
    expect(describeJsonShape("x")).toBe("string");
  });

  it("tokenizes losslessly and classifies keys, strings, numbers and literals", () => {
    const text = safeStringify({ name: "Alex: \"the\" researcher", score: -82.5e1, ok: true, none: null, list: ["a", 1] });
    const tokens = tokenizeJson(text);
    expect(tokens.map((t) => t.text).join("")).toBe(text);
    expect(tokens.filter((t) => t.kind === "key").map((t) => t.text)).toEqual(['"name"', '"score"', '"ok"', '"none"', '"list"']);
    expect(tokens.filter((t) => t.kind === "string").map((t) => t.text)).toEqual(['"Alex: \\"the\\" researcher"', '"a"']);
    expect(tokens.filter((t) => t.kind === "number").map((t) => t.text)).toEqual(["-825", "1"]);
    expect(tokens.filter((t) => t.kind === "literal").map((t) => t.text)).toEqual(["true", "null"]);
  });
});
