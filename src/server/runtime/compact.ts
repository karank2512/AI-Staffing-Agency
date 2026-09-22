/**
 * Compact copies of values for RunStep.input / RunStep.output. Steps are the debug trace, not the source of
 * truth (ToolCall.output keeps full tool results for idempotent resume), so long strings and big arrays are
 * clipped while the JSON stays valid and browsable.
 */

export const MAX_STEP_STRING_CHARS = 4_000;
const MAX_ITEMS = 60;
const MAX_DEPTH = 8;
const MARKER = "…[truncated]";

export function clipText(value: string, max = MAX_STEP_STRING_CHARS): string {
  return value.length > max ? `${value.slice(0, max)}${MARKER}` : value;
}

export function compact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return clipText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return MARKER;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => compact(item, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`…[${value.length - MAX_ITEMS} more items]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child !== undefined) out[key] = compact(child, depth + 1);
  }
  return out;
}

/** One-line title-safe text (RunStep.title, activity headlines). */
export function oneLine(text: string, max = 200): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
}
