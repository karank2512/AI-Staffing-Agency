/**
 * Minimal, safe Markdown → AST parser for worker deliverables, reviews and chat replies.
 *
 * Supported: ATX headings, paragraphs (hard breaks), ordered / unordered / task lists (nested), GFM tables with
 * alignment, fenced code, blockquotes, horizontal rules, and inline bold / italic / strikethrough / code / links /
 * bare URLs. Raw HTML is NEVER interpreted — it stays literal text — and link targets are restricted to
 * http(s), mailto and same-site paths. The renderer (`src/components/markdown.tsx`) maps this AST to React
 * elements, so no HTML string is ever produced.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "del"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "br" };

export type TableAlign = "left" | "center" | "right" | null;

export interface ListItemNode {
  /** `true` / `false` for task-list items (`- [x]`), `null` otherwise. */
  checked: boolean | null;
  /** The item's first paragraph. */
  children: InlineNode[];
  /** Anything after it: nested lists, further paragraphs, code blocks. */
  blocks: BlockNode[];
}

export type BlockNode =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItemNode[] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "table"; align: TableAlign[]; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "blockquote"; children: BlockNode[] }
  | { type: "hr" };

// ── Links ───────────────────────────────────────────────────────────────────

const SAFE_PROTOCOL = /^(https?:|mailto:)/i;
/** Placeholder origin used only to check that a relative href cannot leave the site. */
const SAME_SITE_ORIGIN = "http://same-site.invalid";

/** Returns a safe href or `null` (javascript:, data:, vbscript:, protocol-relative and unknown schemes are dropped). */
export function sanitizeHref(raw: string): string | null {
  // Browsers ignore whitespace/control characters inside the scheme ("java\nscript:"), so strip before checking.
  const href = raw.trim().replace(/[\x00-\x1f\x7f\s]+/g, "");
  if (href === "") return null;
  // Absolute links open in a new tab without a referrer (see isExternalHref), so they may point anywhere.
  if (SAFE_PROTOCOL.test(href)) return href;
  // Anything else with a scheme is rejected.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  // What is left renders as a same-tab link WITH a referrer, so it must stay on this site. Browsers read "\" as
  // "/" in http(s) URLs, which makes "/\evil.example" and "\\evil.example" protocol-relative just like
  // "//evil.example"; resolving against a placeholder origin catches every such spelling.
  if (href.includes("\\")) return null;
  try {
    if (new URL(href, SAME_SITE_ORIGIN).origin !== SAME_SITE_ORIGIN) return null;
  } catch {
    return null;
  }
  // "/runs/r1", "#summary", "?tab=x" and scheme-less text like "docs/page" (a relative path).
  return href;
}

export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href);
}

// ── Inline ──────────────────────────────────────────────────────────────────

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const BARE_URL = /^https?:\/\/[^\s<>]+/i;

function pushText(out: InlineNode[], value: string): void {
  if (value === "") return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.value += value;
  else out.push({ type: "text", value });
}

/** Index of the closing `delim` after `from`, skipping escapes and code spans. -1 when there is none. */
function findClosing(src: string, from: number, delim: string): number {
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))?.[0].length ?? 1;
      const close = src.indexOf("`".repeat(run), i + run);
      i = close === -1 ? i + run : close + run;
      continue;
    }
    if (src.startsWith(delim, i)) {
      // A single * / _ must not match the first char of a ** / __ run (that belongs to a nested strong).
      if (delim.length === 1 && src[i + 1] === delim) {
        const innerClose = src.indexOf(delim + delim, i + 2);
        if (innerClose !== -1) {
          i = innerClose + 2;
          continue;
        }
      }
      // "**bold and *italic***": a longer closing run donates its LAST chars to this delimiter so the inner
      // emphasis keeps its own closer.
      if (delim.length > 1) {
        let run = delim.length;
        while (src[i + run] === delim[0]) run += 1;
        return i + (run - delim.length);
      }
      return i;
    }
    i += 1;
  }
  return -1;
}

/** Matches `[label](target "title")` at `start` (which points at `[`). */
function matchLink(src: string, start: number): { label: string; target: string; end: number } | null {
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (i >= src.length || src[i + 1] !== "(") return null;
  let parens = 0;
  let j = i + 1;
  for (; j < src.length; j++) {
    const ch = src[j];
    if (ch === "\\") {
      j += 1;
      continue;
    }
    if (ch === "\n") return null;
    if (ch === "(") parens += 1;
    else if (ch === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  if (j >= src.length) return null;
  const inside = src.slice(i + 2, j).trim();
  // Drop an optional title: [x](https://a.example "Title")
  const target = inside.replace(/\s+("[^"]*"|'[^']*')\s*$/, "").replace(/^<(.*)>$/, "$1");
  return { label: src.slice(start + 1, i), target, end: j + 1 };
}

function emphasisCanOpen(src: string, i: number, delim: string): boolean {
  const next = src[i + delim.length];
  if (next === undefined || /\s/.test(next)) return false;
  // snake_case and 2*3*4 must survive: `_` never opens inside a word.
  if (delim[0] === "_" && i > 0 && WORD_CHAR.test(src[i - 1] ?? "")) return false;
  return true;
}

function emphasisCanClose(src: string, closeIdx: number, delim: string): boolean {
  const prev = src[closeIdx - 1];
  if (prev === undefined || /\s/.test(prev)) return false;
  if (delim[0] === "_" && WORD_CHAR.test(src[closeIdx + delim.length] ?? "")) return false;
  return true;
}

export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i] as string;

    // Backslash escapes and backslash hard breaks
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        out.push({ type: "br" });
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.test(next)) {
        pushText(out, next);
        i += 2;
        continue;
      }
      pushText(out, ch);
      i += 1;
      continue;
    }

    // Hard break: two+ trailing spaces before a newline
    if (ch === " " && src[i + 1] === " ") {
      const hard = /^ {2,}\n/.exec(src.slice(i));
      if (hard) {
        out.push({ type: "br" });
        i += hard[0].length;
        continue;
      }
    }

    // Code span
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))?.[0].length ?? 1;
      const close = src.indexOf("`".repeat(run), i + run);
      if (close !== -1) {
        const value = src.slice(i + run, close).replace(/\n/g, " ");
        // CommonMark: one leading + trailing space is stripped when both exist ("`` `a` ``").
        const trimmed = value.length > 2 && value.startsWith(" ") && value.endsWith(" ") ? value.slice(1, -1) : value;
        out.push({ type: "code", value: trimmed });
        i = close + run;
        continue;
      }
      pushText(out, "`".repeat(run));
      i += run;
      continue;
    }

    // Emphasis: ***x***, **x**, __x__, *x*, _x_, ~~x~~
    if (ch === "*" || ch === "_" || ch === "~") {
      const candidates = ch === "~" ? ["~~"] : [ch.repeat(3), ch.repeat(2), ch];
      let matched = false;
      for (const delim of candidates) {
        if (!src.startsWith(delim, i) || !emphasisCanOpen(src, i, delim)) continue;
        const close = findClosing(src, i + delim.length, delim);
        if (close === -1 || close === i + delim.length || !emphasisCanClose(src, close, delim)) continue;
        const inner = parseInline(src.slice(i + delim.length, close));
        if (delim === "~~") out.push({ type: "del", children: inner });
        else if (delim.length === 3) out.push({ type: "strong", children: [{ type: "em", children: inner }] });
        else if (delim.length === 2) out.push({ type: "strong", children: inner });
        else out.push({ type: "em", children: inner });
        i = close + delim.length;
        matched = true;
        break;
      }
      if (matched) continue;
      // Not emphasis: emit the whole delimiter run literally so its tail is not re-tried as an opener.
      const run = new RegExp(`^\\${ch}+`).exec(src.slice(i))?.[0] ?? ch;
      pushText(out, run);
      i += run.length;
      continue;
    }

    // Links (images degrade to a link on their alt text — deliverables never embed remote images)
    if (ch === "[" || (ch === "!" && src[i + 1] === "[")) {
      const start = ch === "!" ? i + 1 : i;
      const link = matchLink(src, start);
      if (link) {
        const href = sanitizeHref(link.target);
        const children = parseInline(link.label);
        if (href) out.push({ type: "link", href, children: children.length > 0 ? children : [{ type: "text", value: href }] });
        else out.push(...children);
        i = link.end;
        continue;
      }
    }

    // Autolink <https://…> — any other <…> is literal text (no raw HTML).
    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(src.slice(i));
      const href = auto?.[1] ? sanitizeHref(auto[1]) : null;
      if (auto && href) {
        out.push({ type: "link", href, children: [{ type: "text", value: auto[1] as string }] });
        i += auto[0].length;
        continue;
      }
    }

    // Bare URL
    if ((ch === "h" || ch === "H") && (i === 0 || !WORD_CHAR.test(src[i - 1] ?? ""))) {
      const bare = BARE_URL.exec(src.slice(i));
      if (bare) {
        let url = bare[0].replace(/[.,;:!?'"*_~]+$/, "");
        // A trailing ")" belongs to the sentence unless the URL itself opened a parenthesis.
        while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
          url = url.slice(0, -1);
        }
        const href = sanitizeHref(url);
        if (href) {
          out.push({ type: "link", href, children: [{ type: "text", value: url }] });
          i += url.length;
          continue;
        }
      }
    }

    pushText(out, ch);
    i += 1;
  }

  return out;
}

/** Flatten inline nodes to plain text (used for titles, previews and tests). */
export function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        case "br":
          return "\n";
        default:
          return inlineToText(n.children);
      }
    })
    .join("");
}

// ── Blocks ──────────────────────────────────────────────────────────────────

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BLOCKQUOTE = /^ {0,3}>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\]\s+/;

const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === "";
const indentOf = (line: string): number => /^\s*/.exec(line)?.[0].length ?? 0;

/** Split a table row on unescaped pipes; outer pipes are optional. */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  const trimmed = cells.map((c) => c.trim());
  if (trimmed.length > 1 && trimmed[0] === "") trimmed.shift();
  if (trimmed.length > 1 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return trimmed;
}

function isTableStart(lines: string[], i: number): boolean {
  const header = lines[i];
  const delimiter = lines[i + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (!header.includes("|") || !delimiter.includes("-") || !TABLE_DELIMITER.test(delimiter)) return false;
  return splitTableRow(header).length === splitTableRow(delimiter).length;
}

function startsNewBlock(lines: string[], i: number): boolean {
  const line = lines[i] as string;
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    isTableStart(lines, i)
  );
}

function parseList(lines: string[], start: number): { node: BlockNode; next: number } {
  const first = LIST_ITEM.exec(lines[start] as string) as RegExpExecArray;
  const baseIndent = (first[1] as string).length;
  const ordered = /\d/.test(first[2] as string);
  const startNumber = ordered ? parseInt(first[2] as string, 10) : 1;
  const items: ListItemNode[] = [];
  let i = start;

  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i] as string);
    if (!match || (match[1] as string).length !== baseIndent || /\d/.test(match[2] as string) !== ordered) break;
    // A "- - -" style rule at list level ends the list rather than becoming an item.
    if (HR.test(lines[i] as string)) break;

    const contentIndent = baseIndent + (match[2] as string).length + (match[3] as string).length;
    const dedent = (l: string): string => l.slice(Math.min(indentOf(l), contentIndent));
    const head: string[] = [match[4] as string];
    const body: string[] = [];
    let inBody = false;
    i += 1;

    while (i < lines.length) {
      const line = lines[i] as string;
      if (isBlank(line)) {
        // A blank line stays inside the item only when indented content follows it.
        let k = i + 1;
        while (k < lines.length && isBlank(lines[k])) k += 1;
        if (k >= lines.length || indentOf(lines[k] as string) <= baseIndent) break;
        body.push("");
        inBody = true;
        i += 1;
        continue;
      }
      const indent = indentOf(line);
      if (indent <= baseIndent) {
        // Same-level marker = next item; any other block start ends the list; plain text is a lazy continuation.
        if (LIST_ITEM.test(line) || inBody || startsNewBlock(lines, i)) break;
        head.push(line.trim());
        i += 1;
        continue;
      }
      // Indented content: either more of the first paragraph, or the start of the item's body (nested list,
      // code fence, table …). The lookahead line is needed because a table is recognised by its second row.
      const dedented = dedent(line);
      const opensBlock = startsNewBlock([dedented, dedent(lines[i + 1] ?? "")], 0);
      if (!inBody && !opensBlock) {
        head.push(line.trim());
      } else {
        inBody = true;
        body.push(dedented);
      }
      i += 1;
    }

    let text = head.join("\n");
    let checked: boolean | null = null;
    const task = TASK.exec(text);
    if (task) {
      checked = task[1] !== " ";
      text = text.slice(task[0].length);
    }
    items.push({ checked, children: parseInline(text), blocks: parseBlocks(body) });

    // Blank lines between sibling items are fine ("loose" lists).
    let k = i;
    while (k < lines.length && isBlank(lines[k])) k += 1;
    const upcoming = k < lines.length ? LIST_ITEM.exec(lines[k] as string) : null;
    if (k > i && upcoming && (upcoming[1] as string).length === baseIndent) i = k;
  }

  return { node: { type: "list", ordered, start: startNumber, items }, next: i };
}

function parseTable(lines: string[], start: number): { node: BlockNode; next: number } {
  const headerCells = splitTableRow(lines[start] as string);
  const align: TableAlign[] = splitTableRow(lines[start + 1] as string).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return left ? "left" : null;
  });
  const rows: InlineNode[][][] = [];
  let i = start + 2;
  while (i < lines.length && !isBlank(lines[i]) && (lines[i] as string).includes("|")) {
    const cells = splitTableRow(lines[i] as string);
    // Normalize ragged rows to the header width so the renderer can rely on a rectangular table.
    const normalized = headerCells.map((_, col) => cells[col] ?? "");
    rows.push(normalized.map(parseInline));
    i += 1;
  }
  return { node: { type: "table", align, header: headerCells.map(parseInline), rows }, next: i };
}

function parseBlocks(lines: string[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !closing.test(lines[i] as string)) {
        body.push(lines[i] as string);
        i += 1;
      }
      i += 1; // closing fence (or EOF: an unclosed fence swallows the rest, like CommonMark)
      blocks.push({ type: "code", lang: fence[2] ? (fence[2] as string).toLowerCase() : null, value: body.join("\n") });
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: "heading", level, children: parseInline((heading[2] ?? "").trim()) });
      i += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && !isBlank(lines[i]) && (BLOCKQUOTE.test(lines[i] as string) || !startsNewBlock(lines, i))) {
        quoted.push((lines[i] as string).replace(BLOCKQUOTE, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", children: parseBlocks(quoted) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const table = parseTable(lines, i);
      blocks.push(table.node);
      i = table.next;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = parseList(lines, i);
      blocks.push(list.node);
      i = list.next;
      continue;
    }

    const paragraph: string[] = [line.trimStart()];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsNewBlock(lines, i)) {
      paragraph.push((lines[i] as string).trimStart());
      i += 1;
    }
    // Keep trailing double-spaces on inner lines (hard breaks) but not at the very end.
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n").trimEnd()) });
  }

  return blocks;
}

/** Parse a Markdown document. Never throws; `null` / `undefined` / empty input yields `[]`. */
export function parseMarkdown(source: string | null | undefined): BlockNode[] {
  if (!source) return [];
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseBlocks(lines);
}
