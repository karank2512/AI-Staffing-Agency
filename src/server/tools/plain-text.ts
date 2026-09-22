/**
 * Markdown → plain text for short human-facing previews (approval cards, the Workforce attention strip).
 * Those surfaces render the text verbatim, so "# Report ## Summary This run covered **24 items**" must become
 * "This run covered 24 items". Pure and deliberately small: it is a preview, not a renderer.
 */

import { isTableDelimiterRow } from "@/lib/markdown";

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s{0,3}#{1,6}(\s|$)/;
const RULE_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/**
 * This runs on untrusted model and web text, so the input is bounded and every scan is linear: the previous
 * table-separator regex backtracked for 1.5 s on a 50 k whitespace line (INF-17).
 */
const MAX_SOURCE_CHARS = 100_000;
const MAX_LINE_CHARS = 2_000;

/** Inline markdown → text: links/images keep their label, code keeps its content, emphasis markers go. */
function inlineText(line: string): string {
  return (
    line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .replace(/`([^`]*)`/g, "$1")
      // Emphasis: only markers that wrap a word, so snake_case names like amount_usd survive.
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
  );
}

/** `## Title ##` → `Title`, without the quadratic `\s+#+\s*$` tail match. */
function stripHashes(line: string): string {
  const withoutOpening = line.replace(/^\s*#+[ \t]*/, "");
  const trimmed = withoutOpening.trimEnd();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "#") end -= 1;
  if (end === trimmed.length) return trimmed;
  let start = end;
  while (start > 0 && (trimmed[start - 1] === " " || trimmed[start - 1] === "\t")) start -= 1;
  return start === end && end !== 0 ? trimmed : trimmed.slice(0, start);
}

function tableRowText(line: string): string {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => inlineText(cell).trim())
    .filter(Boolean)
    .join(" · ");
}

function blockLines(markdown: string, opts: { keepHeadings: boolean; keepTables: boolean }): string[] {
  const out: string[] = [];
  let fenced = false;
  const source = markdown.length > MAX_SOURCE_CHARS ? markdown.slice(0, MAX_SOURCE_CHARS) : markdown;
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const raw = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
    if (FENCE_RE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || RULE_RE.test(raw) || isTableDelimiterRow(raw, 2)) continue;
    if (HEADING_RE.test(raw)) {
      if (opts.keepHeadings) out.push(inlineText(stripHashes(raw)));
      continue;
    }
    if (/^\s*\|/.test(raw)) {
      if (opts.keepTables) out.push(tableRowText(raw));
      continue;
    }
    const prose = raw
      .replace(/^\s*(>\s*)+/, "")
      .replace(/^\s*([-*+]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?/, "");
    out.push(inlineText(prose));
  }
  return out;
}

function squash(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Only the prose of a markdown document (no headings, tables or code) as one line; "" when it has none. */
export function markdownProse(markdown: string): string {
  return squash(blockLines(markdown, { keepHeadings: false, keepTables: false }));
}

/** Readable plain text of a markdown document: prose first; headings and tables only when there is no prose. */
export function markdownToPlainText(markdown: string): string {
  return markdownProse(markdown) || squash(blockLines(markdown, { keepHeadings: true, keepTables: true }));
}

/** Clip already-plain text to at most `max` characters, on a word boundary, with an ellipsis. */
export function clipPlain(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length >= max * 0.6 ? atWord : cut).trimEnd()}…`;
}

/** Plain-text excerpt of a markdown document, at most `max` characters. */
export function plainExcerpt(markdown: string, max: number): string {
  return clipPlain(markdownToPlainText(markdown), max);
}
