import { getTool } from "./registry";

export interface ToolDescription {
  title: string;
  approval: { title: string; description?: string };
}

/**
 * Humanized headline for a tool call — the ONLY thing the runtime uses for RunStep titles and Approval rows.
 * NEVER throws: unknown tools, malformed input and a crashing humanizer all fall back to "Used <tool>".
 */
export function describe(toolName: string, input: unknown): ToolDescription {
  const tool = getTool(toolName);
  const fallback = `Used ${tool?.displayName ?? toolName}`;
  if (!tool) return { title: fallback, approval: { title: fallback } };

  let parsed: { success: true; data: unknown } | { success: false };
  try {
    parsed = tool.inputSchema.safeParse(input);
  } catch {
    parsed = { success: false };
  }
  if (!parsed.success) return { title: fallback, approval: { title: fallback } };

  let title = fallback;
  try {
    title = tool.humanize(parsed.data) || fallback;
  } catch {
    // keep the fallback
  }
  let approval: ToolDescription["approval"] = { title };
  if (tool.describeForApproval) {
    try {
      const described = tool.describeForApproval(parsed.data);
      if (described && typeof described.title === "string" && described.title.trim()) {
        approval = described.description ? { title: described.title, description: described.description } : { title: described.title };
      }
    } catch {
      // keep the humanized line as the approval headline
    }
  }
  return { title, approval };
}
