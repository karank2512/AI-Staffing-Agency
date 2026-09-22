import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DecisionSchema,
  FeedbackSchema,
  IdSchema,
  NoteSchema,
  ReviewDecisionSchema,
  ToolNameSchema,
  limitLlmAction,
  limitRunAction,
  parseId,
  parseOptionalId,
} from "@/app/(app)/_lib/action-guards";
import { AnswersSchema, MAX_ANSWERS, SpecPatchSchema } from "@/app/(app)/hire/schema";
import { AppError } from "@/server/errors";
import { RATE_RULES, resetLimit } from "@/server/security";
import { rejection, withEnv } from "../platform/helpers";

/**
 * The bounds every server action applies before anything reaches Prisma, an LLM prompt or revalidatePath
 * (audit F-011 / INF-15), plus the rate limits that protect the actions which cost money (INF-05).
 */

const code = (e: unknown): string | undefined => (e instanceof AppError ? e.code : undefined);

describe("server-action input guards", () => {
  it("accepts the ids the platform actually issues and nothing else", () => {
    for (const id of ["cmud2s68a000brwjlcgwzyqj4", "worker_demo_alex", "org_demo", "run-42"]) {
      expect(IdSchema.safeParse(id).success, id).toBe(true);
    }
    for (const bad of ["", "   ", "../../etc/passwd", "a/b", "id with spaces", "id.with.dots", "x".repeat(65), "<script>"]) {
      expect(IdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("turns an unusable id into a human NOT_FOUND instead of a Prisma error", () => {
    expect(parseId("  worker_demo_alex  ", "Worker")).toBe("worker_demo_alex");
    const err = (() => {
      try {
        parseId("/runs/../../admin", "Run");
      } catch (e) {
        return e;
      }
    })();
    expect(code(err)).toBe("VALIDATION");
    expect((err as AppError).message).toBe("Run not found");
    // A non-string from a hand-rolled client is rejected the same way.
    expect(code((() => { try { parseId(42, "Run"); } catch (e) { return e; } })())).toBe("VALIDATION");
  });

  it("drops the optional context ids used only for revalidation", () => {
    expect(parseOptionalId(undefined)).toBeUndefined();
    expect(parseOptionalId("")).toBeUndefined();
    expect(parseOptionalId("not a valid id")).toBeUndefined();
    expect(parseOptionalId("cmud2s68a000brwjlcgwzyqj4")).toBe("cmud2s68a000brwjlcgwzyqj4");
  });

  it("bounds free text and enumerates decisions", () => {
    expect(NoteSchema.parse(undefined)).toBeUndefined();
    expect(NoteSchema.parse("   ")).toBeUndefined();
    expect(NoteSchema.parse(" Looks good ")).toBe("Looks good");
    expect(NoteSchema.safeParse("x".repeat(1_001)).success).toBe(false);
    expect(FeedbackSchema.safeParse("x".repeat(4_001)).success).toBe(false);
    expect(FeedbackSchema.safeParse("x".repeat(4_000)).success).toBe(true);

    expect(DecisionSchema.safeParse("approve").success).toBe(true);
    expect(DecisionSchema.safeParse("accept").success).toBe(false);
    expect(ReviewDecisionSchema.safeParse("accept").success).toBe(true);
    expect(ReviewDecisionSchema.safeParse("delete").success).toBe(false);
    expect(ToolNameSchema.safeParse("web_search").success).toBe(true);
    expect(ToolNameSchema.safeParse("x".repeat(65)).success).toBe(false);
  });

  it("bounds the scoping answers and the spec patch, which both end up in every future prompt", () => {
    const tooMany = Object.fromEntries(Array.from({ length: MAX_ANSWERS + 1 }, (_, i) => [`q${i}`, "yes"]));
    expect(AnswersSchema.safeParse(tooMany).success).toBe(false);
    const allowed = Object.fromEntries(Array.from({ length: MAX_ANSWERS }, (_, i) => [`q${i}`, "yes"]));
    expect(AnswersSchema.safeParse(allowed).success).toBe(true);
    expect(AnswersSchema.safeParse({ q1: "x".repeat(1_001) }).success).toBe(false);

    expect(SpecPatchSchema.safeParse({ summary: "x".repeat(2_001) }).success).toBe(false);
    expect(SpecPatchSchema.safeParse({ objective: "x".repeat(1_001) }).success).toBe(false);
    expect(SpecPatchSchema.safeParse({ responsibilities: ["x".repeat(301)] }).success).toBe(false);
    expect(SpecPatchSchema.safeParse({ summary: "A reasonable summary of the job.", responsibilities: ["Find funded startups"] }).success).toBe(true);
  });
});

describe("server-action rate limits", () => {
  const restores: Array<() => void> = [];
  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });

  it("does nothing while the limiter is disabled for tests", async () => {
    const s = { userId: `u_${randomUUID()}`, organizationId: `o_${randomUUID()}` } as Parameters<typeof limitLlmAction>[0];
    for (let i = 0; i < RATE_RULES.llmUser.limit + 5; i++) await limitLlmAction(s);
  });

  it("stops a scripted client from looping an LLM action, and says how long to wait", async () => {
    restores.push(withEnv({ RATE_LIMIT_DISABLED: undefined }));
    const s = { userId: `u_${randomUUID()}`, organizationId: `o_${randomUUID()}` } as Parameters<typeof limitLlmAction>[0];
    try {
      for (let i = 0; i < RATE_RULES.llmUser.limit; i++) await limitLlmAction(s);
      const err = await rejection(limitLlmAction(s));
      expect(code(err)).toBe("LIMIT_EXCEEDED");
      expect((err as AppError).message).toMatch(/too often/i);

      // Run actions are counted separately, so hitting the LLM ceiling does not block "Run now".
      await expect(limitRunAction(s)).resolves.toBeUndefined();
    } finally {
      await resetLimit(RATE_RULES.llmUser, s.userId);
      await resetLimit(RATE_RULES.llmOrg, s.organizationId);
      await resetLimit(RATE_RULES.runOrg, s.organizationId);
    }
  });
});
