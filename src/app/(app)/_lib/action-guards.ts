import { z } from "zod";
import type { SessionContext } from "@/server/auth/types";
import { invalid } from "@/server/errors";
import { enforce, RATE_RULES } from "@/server/security";

/**
 * Shared input guards for every server action under `(app)` — the outer edge of the server, where a hostile
 * client is the normal case (audit F-011 / INF-15).
 *
 * Two jobs:
 *  1. bound every value before it reaches Prisma, an LLM prompt or `revalidatePath` — ids are opaque strings,
 *     not paths, and free text has a ceiling so nobody can push a megabyte into a stored spec;
 *  2. apply the per-user / per-org rate limits from `@/server/security` to the actions that cost money.
 *
 * Not a route (Next ignores `_`-prefixed folders); imported only by `"use server"` files.
 */

/**
 * A database id as it travels from the client: cuid-ish. Deliberately not a strict cuid regex — the demo seed
 * writes fixed ids like `worker_demo_alex` — but always opaque: no slashes, dots or spaces, so an id can never
 * become a path segment in `revalidatePath`.
 */
export const IdSchema = z
  .string()
  .trim()
  .min(1, "Missing id")
  .max(64, "That id is not valid")
  .regex(/^[A-Za-z0-9_-]+$/, "That id is not valid");

/** Parses an id argument, naming what it was ("Worker", "Run") so the toast is human. */
export function parseId(value: unknown, what: string): string {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) throw invalid(`${what} not found`);
  return parsed.data;
}

/** Same, for the optional `context` ids actions use only to revalidate extra pages. */
export function parseOptionalId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = IdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export const DECISION_NOTE_MAX = 1_000;
export const FEEDBACK_MAX = 4_000;
export const TOOL_NAME_MAX = 64;

export const DecisionSchema = z.enum(["approve", "reject"]);
export const ReviewDecisionSchema = z.enum(["accept", "reject"]);
export const ToolNameSchema = z.string().trim().min(1, "Missing tool").max(TOOL_NAME_MAX, "That tool is not valid");

/** Optional free text with a hard ceiling; blank becomes undefined so "no note" is never stored as "". */
const boundedText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : undefined));

export const NoteSchema = boundedText(DECISION_NOTE_MAX, `Keep the note under ${DECISION_NOTE_MAX.toLocaleString("en-US")} characters`);
export const FeedbackSchema = boundedText(FEEDBACK_MAX, `Keep the feedback under ${FEEDBACK_MAX.toLocaleString("en-US")} characters`);

/**
 * Every action that reaches a model: per user (the human clicking) and per org (the bill). Both fail closed with
 * LIMIT_EXCEEDED, which `runAction` turns into a toast.
 */
export async function limitLlmAction(s: SessionContext): Promise<void> {
  await enforce(RATE_RULES.llmUser, s.userId);
  await enforce(RATE_RULES.llmOrg, s.organizationId);
}

/** Queueing work: "Run now", retry, and hires that start a first run. */
export async function limitRunAction(s: SessionContext): Promise<void> {
  await enforce(RATE_RULES.runOrg, s.organizationId);
}

/** Writing to the credential vault (an AES encrypt + a DB write each time). */
export async function limitCredentialsAction(s: SessionContext): Promise<void> {
  await enforce(RATE_RULES.credentialsOrg, s.organizationId);
}
