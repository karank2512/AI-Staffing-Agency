import { describe, expect, it } from "vitest";
import {
  inlineToText,
  parseInline,
  parseMarkdown,
  sanitizeHref,
  splitTableRow,
  type BlockNode,
  type InlineNode,
} from "@/lib/markdown";

const text = (value: string): InlineNode => ({ type: "text", value });

function only<T extends BlockNode["type"]>(blocks: BlockNode[], type: T): Extract<BlockNode, { type: T }> {
  expect(blocks).toHaveLength(1);
  const block = blocks[0] as BlockNode;
  expect(block.type).toBe(type);
  return block as Extract<BlockNode, { type: T }>;
}

describe("parseInline", () => {
  it("parses bold, italic, strikethrough and inline code", () => {
    expect(parseInline("a **b** *c* _d_ ~~e~~ `f`")).toEqual([
      text("a "),
      { type: "strong", children: [text("b")] },
      text(" "),
      { type: "em", children: [text("c")] },
      text(" "),
      { type: "em", children: [text("d")] },
      text(" "),
      { type: "del", children: [text("e")] },
      text(" "),
      { type: "code", value: "f" },
    ]);
  });

  it("nests emphasis", () => {
    expect(parseInline("**bold and *italic***")).toEqual([
      { type: "strong", children: [text("bold and "), { type: "em", children: [text("italic")] }] },
    ]);
    expect(parseInline("*outer **inner** tail*")).toEqual([
      { type: "em", children: [text("outer "), { type: "strong", children: [text("inner")] }, text(" tail")] },
    ]);
    expect(parseInline("***both***")).toEqual([
      { type: "strong", children: [{ type: "em", children: [text("both")] }] },
    ]);
  });

  it("leaves snake_case, arithmetic and unmatched markers alone", () => {
    expect(parseInline("source_url and funding_round_usd")).toEqual([text("source_url and funding_round_usd")]);
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
    expect(parseInline("**not closed")).toEqual([text("**not closed")]);
    expect(parseInline("a ` b")).toEqual([text("a ` b")]);
  });

  it("does not parse markup inside code spans", () => {
    expect(parseInline("`**x**` and ``a ` b``")).toEqual([
      { type: "code", value: "**x**" },
      text(" and "),
      { type: "code", value: "a ` b" },
    ]);
  });

  it("honours backslash escapes", () => {
    expect(parseInline("\\*not em\\* and 1\\. item")).toEqual([text("*not em* and 1. item")]);
  });

  it("parses links, titles, autolinks and bare URLs", () => {
    expect(parseInline('[Acme](https://acme.example/pricing "Pricing")')).toEqual([
      { type: "link", href: "https://acme.example/pricing", children: [text("Acme")] },
    ]);
    expect(parseInline("[**Bold** label](/workers/w1)")).toEqual([
      { type: "link", href: "/workers/w1", children: [{ type: "strong", children: [text("Bold")] }, text(" label")] },
    ]);
    expect(parseInline("<https://a.example/x>")).toEqual([
      { type: "link", href: "https://a.example/x", children: [text("https://a.example/x")] },
    ]);
    expect(parseInline("See https://a.example/report. Thanks (https://b.example/x).")).toEqual([
      text("See "),
      { type: "link", href: "https://a.example/report", children: [text("https://a.example/report")] },
      text(". Thanks ("),
      { type: "link", href: "https://b.example/x", children: [text("https://b.example/x")] },
      text(")."),
    ]);
    expect(parseInline("https://en.example/wiki/Foo_(bar)")).toEqual([
      { type: "link", href: "https://en.example/wiki/Foo_(bar)", children: [text("https://en.example/wiki/Foo_(bar)")] },
    ]);
  });

  it("drops unsafe link targets but keeps the label", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([text("click")]);
    expect(parseInline("[x](data:text/html;base64,AAAA)")).toEqual([text("x")]);
    expect(parseInline("![logo](https://a.example/logo.png)")).toEqual([
      { type: "link", href: "https://a.example/logo.png", children: [text("logo")] },
    ]);
  });

  it("treats raw HTML as literal text", () => {
    const nodes = parseInline('<script>alert("x")</script> <img src=x onerror=alert(1)>');
    expect(nodes).toEqual([text('<script>alert("x")</script> <img src=x onerror=alert(1)>')]);
  });

  it("supports hard line breaks", () => {
    expect(parseInline("line one  \nline two\\\nline three\nsoft")).toEqual([
      text("line one"),
      { type: "br" },
      text("line two"),
      { type: "br" },
      text("line three\nsoft"),
    ]);
  });

  it("flattens to plain text", () => {
    expect(inlineToText(parseInline("**Top 5** [startups](https://a.example) in `AI`"))).toBe("Top 5 startups in AI");
  });
});

describe("sanitizeHref", () => {
  it("allows http(s), mailto and same-site paths", () => {
    expect(sanitizeHref("https://a.example")).toBe("https://a.example");
    expect(sanitizeHref("HTTP://A.EXAMPLE")).toBe("HTTP://A.EXAMPLE");
    expect(sanitizeHref("mailto:team@acme.example")).toBe("mailto:team@acme.example");
    expect(sanitizeHref("/runs/r1")).toBe("/runs/r1");
    expect(sanitizeHref("#summary")).toBe("#summary");
    expect(sanitizeHref("docs/page")).toBe("docs/page");
  });

  it("rejects script-capable and unknown schemes, including obfuscated ones", () => {
    expect(sanitizeHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeHref("  JaVaScRiPt:alert(1)")).toBeNull();
    expect(sanitizeHref("java\nscript:alert(1)")).toBeNull();
    expect(sanitizeHref("java\tscript:alert(1)")).toBeNull();
    expect(sanitizeHref("data:text/html,<b>x</b>")).toBeNull();
    expect(sanitizeHref("vbscript:x")).toBeNull();
    expect(sanitizeHref("file:///etc/passwd")).toBeNull();
    expect(sanitizeHref("//evil.example")).toBeNull();
    expect(sanitizeHref("")).toBeNull();
  });

  it("rejects relative-looking links that browsers resolve to another host", () => {
    // Browsers treat "\" as "/" in http(s) URLs, so each of these is protocol-relative.
    expect(sanitizeHref("/\\evil.example/login")).toBeNull();
    expect(sanitizeHref("\\\\evil.example")).toBeNull();
    expect(sanitizeHref("\\/evil.example")).toBeNull();
    expect(sanitizeHref("/ /evil.example")).toBeNull(); // whitespace is stripped first → "//evil.example"
    expect(sanitizeHref("/\t\\evil.example")).toBeNull();
    // Same-site relative links are untouched.
    expect(sanitizeHref("?tab=performance")).toBe("?tab=performance");
    expect(sanitizeHref("../deliverables/d1")).toBe("../deliverables/d1");
    expect(sanitizeHref("/workers/w1?tab=chat#latest")).toBe("/workers/w1?tab=chat#latest");
  });

  it("drops a backslash link from parsed Markdown but keeps its text", () => {
    const [paragraph] = parseMarkdown("[here](/\\evil.example/login) and [b](\\\\\\\\evil.example) and [ok](/runs/r1)");
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(inlineToText(paragraph.children)).toBe("here and b and ok");
    expect(paragraph.children.filter((n) => n.type === "link")).toEqual([{ type: "link", href: "/runs/r1", children: [text("ok")] }]);
  });
});

describe("parseMarkdown — blocks", () => {
  it("returns [] for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
    expect(parseMarkdown(undefined)).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });

  it("parses headings of every level and ignores closing hashes", () => {
    const blocks = parseMarkdown("# One\n## Two ##\n###### Six\n#hashtag");
    expect(blocks).toEqual([
      { type: "heading", level: 1, children: [text("One")] },
      { type: "heading", level: 2, children: [text("Two")] },
      { type: "heading", level: 6, children: [text("Six")] },
      { type: "paragraph", children: [text("#hashtag")] },
    ]);
  });

  it("joins paragraph lines and splits on blank lines", () => {
    expect(parseMarkdown("first line\nsecond line\n\nnext para")).toEqual([
      { type: "paragraph", children: [text("first line\nsecond line")] },
      { type: "paragraph", children: [text("next para")] },
    ]);
  });

  it("normalizes CRLF", () => {
    expect(parseMarkdown("# Title\r\n\r\nBody\r\n")).toEqual([
      { type: "heading", level: 1, children: [text("Title")] },
      { type: "paragraph", children: [text("Body")] },
    ]);
  });

  it("parses unordered and ordered lists", () => {
    const ul = only(parseMarkdown("- one\n- two\n* three"), "list");
    expect(ul.ordered).toBe(false);
    expect(ul.items.map((i) => inlineToText(i.children))).toEqual(["one", "two", "three"]);

    const ol = only(parseMarkdown("3. three\n4. four"), "list");
    expect(ol.ordered).toBe(true);
    expect(ol.start).toBe(3);
    expect(ol.items).toHaveLength(2);
  });

  it("starts a new list when the marker type changes", () => {
    const blocks = parseMarkdown("- a\n- b\n1. c\n2. d");
    expect(blocks.map((b) => b.type)).toEqual(["list", "list"]);
    expect((blocks[1] as Extract<BlockNode, { type: "list" }>).ordered).toBe(true);
  });

  it("nests lists by indentation", () => {
    const list = only(parseMarkdown("- parent\n  - child a\n  - child b\n    - grandchild\n- sibling"), "list");
    expect(list.items).toHaveLength(2);
    const parent = list.items[0]!;
    expect(inlineToText(parent.children)).toBe("parent");
    const child = only(parent.blocks, "list");
    expect(child.items.map((i) => inlineToText(i.children))).toEqual(["child a", "child b"]);
    const grandchild = only(child.items[1]!.blocks, "list");
    expect(inlineToText(grandchild.items[0]!.children)).toBe("grandchild");
    expect(inlineToText(list.items[1]!.children)).toBe("sibling");
  });

  it("nests an unordered list under an ordered item", () => {
    const list = only(parseMarkdown("1. Pricing\n   - Acme raised prices\n   - Globex held\n2. Hiring"), "list");
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(2);
    expect(only(list.items[0]!.blocks, "list").items).toHaveLength(2);
  });

  it("keeps loose lists (blank lines between items) as one list", () => {
    const list = only(parseMarkdown("- one\n\n- two\n\n- three"), "list");
    expect(list.items).toHaveLength(3);
  });

  it("supports lazy continuation lines and ends the list at a paragraph after a blank line", () => {
    const blocks = parseMarkdown("- first item\ncontinues here\n- second\n\nAfter the list.");
    expect(blocks.map((b) => b.type)).toEqual(["list", "paragraph"]);
    const list = blocks[0] as Extract<BlockNode, { type: "list" }>;
    expect(inlineToText(list.items[0]!.children)).toBe("first item\ncontinues here");
  });

  it("parses task list items", () => {
    const list = only(parseMarkdown("- [x] shipped\n- [ ] pending\n- plain"), "list");
    expect(list.items.map((i) => i.checked)).toEqual([true, false, null]);
    expect(inlineToText(list.items[0]!.children)).toBe("shipped");
  });

  it("parses fenced code verbatim, with language", () => {
    const code = only(parseMarkdown('```json\n{ "a": "**not bold**" }\n\n# not a heading\n```'), "code");
    expect(code.lang).toBe("json");
    expect(code.value).toBe('{ "a": "**not bold**" }\n\n# not a heading');
  });

  it("tolerates an unclosed fence and tilde fences", () => {
    expect(only(parseMarkdown("```\nrest of doc\n- not a list"), "code").value).toBe("rest of doc\n- not a list");
    const tilde = only(parseMarkdown("~~~ts\nconst a = 1;\n~~~"), "code");
    expect(tilde).toEqual({ type: "code", lang: "ts", value: "const a = 1;" });
  });

  it("parses horizontal rules without confusing them with lists or emphasis", () => {
    expect(parseMarkdown("above\n\n---\n\n***\n\n- - -\n\nbelow").map((b) => b.type)).toEqual([
      "paragraph",
      "hr",
      "hr",
      "hr",
      "paragraph",
    ]);
  });

  it("parses blockquotes recursively", () => {
    const quote = only(parseMarkdown("> **Note**\n> continues\n>\n> - item"), "blockquote");
    expect(quote.children.map((b) => b.type)).toEqual(["paragraph", "list"]);
  });
});

describe("parseMarkdown — GFM tables", () => {
  const source = [
    "| Company | Round | Amount (USD) |",
    "|:--------|:-----:|-------------:|",
    "| **Acme** | Series A | 12,000,000 |",
    "| Globex \\| Labs | Seed |",
    "| [Initech](https://initech.example) | B | 40000000 | extra |",
  ].join("\n");

  it("parses header, alignment and rows", () => {
    const table = only(parseMarkdown(source), "table");
    expect(table.align).toEqual(["left", "center", "right"]);
    expect(table.header.map(inlineToText)).toEqual(["Company", "Round", "Amount (USD)"]);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]![0]).toEqual([{ type: "strong", children: [text("Acme")] }]);
  });

  it("normalizes ragged rows to the header width and unescapes pipes", () => {
    const table = only(parseMarkdown(source), "table");
    expect(table.rows.every((r) => r.length === 3)).toBe(true);
    expect(table.rows[1]!.map(inlineToText)).toEqual(["Globex | Labs", "Seed", ""]);
    expect(table.rows[2]!.map(inlineToText)).toEqual(["Initech", "B", "40000000"]);
  });

  it("works without outer pipes and directly after a paragraph", () => {
    const blocks = parseMarkdown("Here are the results:\na | b\n--- | ---\n1 | 2\n\nDone.");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    const table = blocks[1] as Extract<BlockNode, { type: "table" }>;
    expect(table.align).toEqual([null, null]);
    expect(table.rows.map((r) => r.map(inlineToText))).toEqual([["1", "2"]]);
  });

  it("does not treat a pipe in prose as a table", () => {
    expect(parseMarkdown("either a | b\nor something else").map((b) => b.type)).toEqual(["paragraph"]);
    // header/delimiter column counts must agree
    expect(parseMarkdown("a | b | c\n--- | ---").map((b) => b.type)).not.toContain("table");
  });

  it("splits rows on unescaped pipes only", () => {
    expect(splitTableRow("| a | b \\| c |  |")).toEqual(["a", "b | c", ""]);
    expect(splitTableRow("a|b")).toEqual(["a", "b"]);
  });
});

describe("parseMarkdown — a realistic deliverable", () => {
  it("parses a full report without throwing and in document order", () => {
    const report = [
      "# Weekly AI infrastructure funding — Sep 17, 2026",
      "",
      "**12 rounds** this week, led by _inference_ startups. Source: <https://news.example/funding>.",
      "",
      "## Highlights",
      "1. **Vectorly** raised $40M (Series B)",
      "   - Lead: Northwind Capital",
      "2. `gpu_cloud` spend is up 18%",
      "",
      "## Records",
      "| company | amount_usd |",
      "| --- | ---: |",
      "| Vectorly | 40000000 |",
      "",
      "---",
      "> Simulated data.",
    ].join("\n");
    expect(parseMarkdown(report).map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "heading",
      "table",
      "hr",
      "blockquote",
    ]);
  });

  it("terminates on pathological input", () => {
    const nasty = `${"*".repeat(500)}${"[".repeat(500)}${"`".repeat(501)}\n${"- ".repeat(200)}\n${"> ".repeat(200)}x`;
    expect(() => parseMarkdown(nasty)).not.toThrow();
  });
});
