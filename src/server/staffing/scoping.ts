import { recordActivity } from "@/server/activity";
import { assertCan } from "@/server/auth/permissions";
import type { SessionContext } from "@/server/auth/types";
import { db, toJson } from "@/server/db";
import {
  JobFamilySchema,
  JobSpecLlmSchema,
  JobSpecSchema,
  ScopingQuestionsSchema,
  type IntakeAnswers,
  type JobFamily,
  type JobSpec,
  type ScopingQuestions,
} from "@/server/domain";
import { AppError, conflict, invalid } from "@/server/errors";
import { llm } from "@/server/models";
import { assertOrgActive, assertWithinBudget } from "@/server/security";
import { tools } from "@/server/tools";
import { detectFamily } from "./family-cues";
import { getJob, nextSpecVersion, parseIntake } from "./jobs";
import { normalizeJobSpecLlm, normalizeScopingQuestions } from "./normalize";
import { SCOPING_QUESTIONS_SYSTEM, SPEC_SYSTEM, buildScopingQuestionsPrompt, buildSpecPrompt } from "./prompts";
import { mockJobSpec, mockScopingQuestions } from "./scoping-mock";

/**
 * Job scoping: plain-English description → follow-up questions → JobSpec draft.
 * The LLM (or its deterministic stand-in) proposes; code validates and persists.
 */

const MIN_DESCRIPTION_CHARS = 10;
const MAX_DESCRIPTION_CHARS = 5_000;

export async function scopeJob(s: SessionContext, description: string): Promise<{ jobId: string; questions: ScopingQuestions }> {
  assertCan(s, "jobs.manage");
  await assertOrgActive(s.organizationId);
  await assertWithinBudget(s.organizationId);
  const text = description.replace(/\r\n/g, "\n").trim();
  if (text.length < MIN_DESCRIPTION_CHARS) throw invalid("Describe the job in a sentence or two so it can be scoped.");
  if (text.length > MAX_DESCRIPTION_CHARS) throw invalid(`Keep the description under ${MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters.`);

  const familyHint: JobFamily = detectFamily(text);
  const { object: questions } = await llm.generateObject(
    {
      tier: "fast",
      system: SCOPING_QUESTIONS_SYSTEM,
      prompt: buildScopingQuestionsPrompt(text, familyHint),
      schema: ScopingQuestionsSchema,
      schemaName: "ScopingQuestions",
      normalize: normalizeScopingQuestions(familyHint),
      mock: () => mockScopingQuestions(text),
    },
    { organizationId: s.organizationId, purpose: "scoping.questions" },
  );

  const intake: IntakeAnswers = { questions: questions.questions, answers: {} };
  const job = await db.job.create({
    data: {
      organizationId: s.organizationId,
      title: questions.draftTitle,
      description: text,
      jobFamily: questions.jobFamily,
      status: "DRAFT",
      intake: toJson(intake),
      createdById: s.userId,
    },
  });

  await recordActivity({
    organizationId: s.organizationId,
    type: "JOB_CREATED",
    title: `${s.name} opened a job: “${job.title}”`,
    detail: questions.questions.length > 0 ? `${questions.questions.length} follow-up question${questions.questions.length === 1 ? "" : "s"} to answer before the spec is drafted` : "No follow-up questions needed",
    jobId: job.id,
    actorType: "USER",
    actorName: s.name,
  });

  return { jobId: job.id, questions };
}

/** Job.jobFamily is a plain string column; fall back to detection if it ever holds an unknown slug. */
function storedFamily(slug: string, description: string): JobFamily {
  const parsed = JobFamilySchema.safeParse(slug);
  return parsed.success ? parsed.data : detectFamily(description);
}

/** Keep answers for questions we asked; trim; drop skipped ones. */
function mergeAnswers(intake: IntakeAnswers | null, answers: Record<string, string>): IntakeAnswers {
  const questions = intake?.questions ?? [];
  const known = new Set(questions.map((q) => q.id));
  const merged: Record<string, string> = { ...(intake?.answers ?? {}) };
  for (const [id, value] of Object.entries(answers)) {
    if (!known.has(id) || typeof value !== "string") continue;
    const clean = value.trim();
    if (clean.length > 0) merged[id] = clean;
    else delete merged[id];
  }
  return { questions, answers: merged };
}

export async function buildJobSpec(s: SessionContext, jobId: string, answers: Record<string, string>): Promise<{ jobSpecId: string; spec: JobSpec }> {
  assertCan(s, "jobs.manage");
  await assertOrgActive(s.organizationId);
  await assertWithinBudget(s.organizationId);
  const job = await getJob(s.organizationId, jobId);
  if (job.status !== "DRAFT") throw conflict("This job's spec is already approved. Revise it to make changes.");

  const intake = mergeAnswers(parseIntake(job.intake), answers);
  await db.job.update({ where: { id: job.id }, data: { intake: toJson(intake) } });

  const familyHint = storedFamily(job.jobFamily, job.description);
  const { object } = await llm.generateObject(
    {
      tier: "standard",
      system: SPEC_SYSTEM,
      prompt: buildSpecPrompt({ description: job.description, title: job.title, jobFamily: familyHint, intake }),
      schema: JobSpecLlmSchema,
      schemaName: "JobSpec",
      normalize: normalizeJobSpecLlm(familyHint),
      mock: () => JobSpecLlmSchema.parse(mockJobSpec({ description: job.description, title: job.title, jobFamily: familyHint, intake })),
    },
    { organizationId: s.organizationId, jobId: job.id, purpose: "scoping.spec" },
  );

  const parsed = JobSpecSchema.safeParse({
    ...object,
    schemaVersion: 1,
    toolsLikelyNeeded: object.toolsLikelyNeeded.filter((t) => tools.has(t)),
  });
  if (!parsed.success) {
    throw new AppError("VALIDATION", "The drafted spec did not validate; please try again.", { issues: parsed.error.issues });
  }
  const spec = parsed.data;

  const row = await db.$transaction(async (tx) => {
    await tx.jobSpec.updateMany({ where: { jobId: job.id, status: "DRAFT" }, data: { status: "SUPERSEDED" } });
    const created = await tx.jobSpec.create({
      data: { jobId: job.id, version: await nextSpecVersion(job.id, tx), status: "DRAFT", spec: toJson(spec) },
    });
    await tx.job.update({ where: { id: job.id }, data: { title: spec.title, jobFamily: spec.jobFamily } });
    return created;
  });

  return { jobSpecId: row.id, spec };
}
