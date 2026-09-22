import { describe, expect, it } from "vitest";
import { markdownToPlainText, plainExcerpt } from "@/server/tools/plain-text";

describe("markdownToPlainText", () => {
  it("drops headings, rules, table rows and fenced code, and unwraps inline markup", () => {
    const md = [
      "# Weekly report",
      "## Summary",
      "> **Bold** claim with *italics*, __strong__, ~~gone~~ and `code`.",
      "",
      "---",
      "1. First point with [a link](https://x.example) and ![chart](https://x.example/c.png)",
      "- [x] Done item",
      "| a | b |",
      "|:--|--:|",
      "| 1 | 2 |",
      "~~~",
      "ignored",
      "~~~",
      "<b>html</b> is stripped",
    ].join("\n");
    expect(markdownToPlainText(md)).toBe(
      "Bold claim with italics, strong, gone and code. First point with a link and chart Done item html is stripped",
    );
  });

  it("keeps snake_case identifiers and arithmetic intact", () => {
    expect(markdownToPlainText("Fields amount_usd and lead_investor; 2 * 3 = 6")).toBe("Fields amount_usd and lead_investor; 2 * 3 = 6");
  });

  it("falls back to headings and table cells when the document has no prose", () => {
    expect(markdownToPlainText("# Title\n\n| Company | Stage |\n| --- | --- |\n| Acme | Seed |")).toBe("Title Company · Stage Acme · Seed");
  });

  it("returns an empty string for an empty document", () => {
    expect(markdownToPlainText("   \n\n")).toBe("");
  });
});

describe("plainExcerpt", () => {
  it("returns short text unchanged and cuts long text on a word boundary", () => {
    expect(plainExcerpt("**Short** note", 50)).toBe("Short note");
    const long = `${"word ".repeat(100)}end`;
    const excerpt = plainExcerpt(long, 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith("word…")).toBe(true);
  });

  it("hard-cuts a single very long token", () => {
    const excerpt = plainExcerpt("x".repeat(500), 20);
    expect(excerpt).toBe(`${"x".repeat(19)}…`);
  });
});
