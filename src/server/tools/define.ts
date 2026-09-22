import type { z } from "zod";
import { TOOL_INPUT_SCHEMAS, type ToolInput, type ToolName, type ToolOutput } from "./schemas";
import type { ToolDefinition } from "./types";

/** A tool definition whose input/output types are bound to the frozen contract for `name`. */
export type TypedToolDefinition<N extends ToolName> = ToolDefinition<ToolInput<N>, ToolOutput<N>> & { name: N };

/**
 * Binds `TOOL_INPUT_SCHEMAS[name]` and `ToolOutputs[name]` to an implementation so every tool file is fully
 * typed against the contract: `execute` receives the parsed input and must return the contracted output.
 */
export function defineTool<N extends ToolName>(
  name: N,
  def: Omit<TypedToolDefinition<N>, "name" | "inputSchema">,
): TypedToolDefinition<N> {
  // The schema table is keyed by N, but TypeScript cannot relate the indexed access to z.ZodType<ToolInput<N>>
  // for a generic N; the cast is safe because ToolInput<N> is *defined* as the inferred output of this very schema.
  const inputSchema = TOOL_INPUT_SCHEMAS[name] as unknown as z.ZodType<ToolInput<N>>;
  return { ...def, name, inputSchema };
}

/** Quote a user-facing string the way the activity feed does: Searched the web for “AI infra funding”. */
export function quote(text: string, max = 80): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const clipped = trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
  return `“${clipped}”`;
}

export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}
