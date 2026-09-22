/** Pure helpers behind `JsonView`: safe stringification, a one-line shape summary and a tiny JSON tokenizer. */

export type JsonTokenKind = "key" | "string" | "number" | "literal" | "plain";

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

/** Pretty-print anything without throwing (cycles, BigInt, undefined). */
export function safeStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const seen = new WeakSet<object>();
    const text = JSON.stringify(
      value,
      (_key, v: unknown) => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      },
      2,
    );
    return text ?? String(value);
  } catch {
    return String(value);
  }
}

/** "Array · 12 items", "Object · 4 keys", "string", "null" — shown next to the label while collapsed. */
export function describeJsonShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `Array · ${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") {
    const count = Object.keys(value as object).length;
    return `Object · ${count} ${count === 1 ? "key" : "keys"}`;
  }
  return typeof value;
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Split pretty-printed JSON into coloured runs. Concatenating `text` of all tokens reproduces the input. */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: "plain", text: text.slice(cursor, index) });
    const [whole, quoted, colon] = match;
    if (quoted !== undefined) {
      tokens.push({ kind: colon !== undefined ? "key" : "string", text: quoted });
      if (colon !== undefined) tokens.push({ kind: "plain", text: colon });
    } else if (whole === "true" || whole === "false" || whole === "null") {
      tokens.push({ kind: "literal", text: whole });
    } else {
      tokens.push({ kind: "number", text: whole });
    }
    cursor = index + whole.length;
  }
  if (cursor < text.length) tokens.push({ kind: "plain", text: text.slice(cursor) });
  return tokens;
}
