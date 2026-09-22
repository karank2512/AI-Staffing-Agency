import type { z } from "zod";

/**
 * Tool layer contract.
 *
 * Permissions are enforced SERVER-SIDE inside `tools.invoke()` — the model can ask for anything, but a
 * call only executes when (a) the tool is listed in the worker version's blueprint, (b) a non-revoked
 * WorkerToolGrant exists for (workerId, toolName), and (c) if the grant requires approval, an APPROVED
 * Approval row exists for this exact ToolCall. There is no code path around this check.
 */

export type ToolCategory = "research" | "data" | "output" | "compute" | "communication";

/** none: pure compute · external_read: reads the outside world · external_write: changes the outside world */
export type ToolSideEffect = "none" | "external_read" | "external_write";

export interface ToolContext {
  organizationId: string;
  workerId: string;
  workerVersionId: string;
  runId: string;
  /** Run.attempt — per-run call limits count ToolCall rows of the current attempt only. */
  attempt: number;
  /** True when the platform is in Simulated mode; tools with no real backend configured also self-simulate. */
  simulated: boolean;
  /** Resolve a secret by name: org Credential first, then process.env. */
  getSecret(name: string): Promise<string | undefined>;
}

export interface ToolResult<O = unknown> {
  output: O;
  /** True if this result came from a mock fallback rather than a real backend. */
  simulated: boolean;
  costUsd?: number;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  /** snake_case, stable: stored in blueprints, grants and tool calls. */
  name: string;
  displayName: string;
  /** Shown to the model. */
  description: string;
  /** Shown to humans on proposal cards / Permissions tab. */
  humanDescription: string;
  category: ToolCategory;
  sideEffect: ToolSideEffect;
  /** Default for new grants. external_write tools should default to true. */
  defaultRequiresApproval: boolean;
  /** Secret names (see secrets KNOWN_CREDENTIALS) that switch this tool from simulated to a real backend. */
  secretNames?: string[];
  /** Flat platform cost per call in USD used for metering + estimates. */
  costPerCallUsd: number;
  inputSchema: z.ZodType<I>;
  /** Contractor-style past-tense activity line: "Searched the web for “AI infra funding”". */
  humanize(input: I): string;
  /** Headline for an approval request: "Send “Weekly Feedback Report” to 3 recipients". */
  describeForApproval?(input: I): { title: string; description?: string };
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}

export type AuthorizationResult =
  | { allowed: true; requiresApproval: boolean; grantId: string }
  | { allowed: false; reason: "unknown_tool" | "not_in_blueprint" | "no_grant" | "grant_revoked" | "call_limit"; message: string };

export interface InvokeToolArgs {
  toolName: string;
  input: unknown;
  ctx: ToolContext;
  /** ToolCall row id — required to verify approvals for approval-gated grants. */
  toolCallId: string;
}

export type InvokeToolResult =
  | { status: "ok"; output: unknown; simulated: boolean; costUsd: number; latencyMs: number }
  | { status: "denied"; reason: string; message: string }
  | { status: "approval_required"; grantId: string }
  | { status: "rejected"; message: string } // a human rejected the approval
  | { status: "invalid_input"; message: string }
  | { status: "error"; message: string; latencyMs: number };

/** The public surface of src/server/tools/index.ts (exported as `tools`). */
export interface Tools {
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  has(name: string): boolean;
  /** Model-facing specs for the given tool names (unknown names are skipped). */
  specsFor(names: string[]): Array<{ name: string; description: string; inputSchema: z.ZodType }>;
  /**
   * NEVER throws. safeParses `input`; falls back to `Used <displayName ?? toolName>` for unknown tools / bad input.
   * The runtime uses ONLY this for RunStep titles + Approval headlines (never ToolDefinition methods directly).
   */
  describe(toolName: string, input: unknown): { title: string; approval: { title: string; description?: string } };
  authorize(args: {
    workerId: string;
    workerVersionId: string;
    toolName: string;
    runId?: string;
    attempt?: number;
  }): Promise<AuthorizationResult>;
  /**
   * NEVER throws. Order: registry lookup → Zod-validate input (invalid_input BEFORE any approval is requested)
   * → authorize → approval check (by toolCallId) → execute → record TOOL UsageRecord.
   * Writes ONLY UsageRecord rows; the runtime owns every ToolCall / RunStep / Approval write.
   */
  invoke(args: InvokeToolArgs): Promise<InvokeToolResult>;
}
