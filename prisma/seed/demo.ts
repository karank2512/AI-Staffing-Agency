import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/server/auth/password";
import { DEMO_USER, type SessionContext } from "@/server/auth/types";
import { db as defaultDb } from "@/server/db";
import { computeNextRunAt } from "@/server/domain";
import { refreshWorkerScore } from "@/server/evaluation";
import { approveJobSpec, buildJobSpec, scopeJob } from "@/server/staffing";
import { backdate } from "./backdate";
import { designSamV1, designWorker } from "./blueprints";
import { alexActions, alexTimeline, mayaActions, mayaTimeline, samActions, samTimeline, type Action, type CastResults } from "./cast";
import { addMs, DAY_MS, HOUR_MS, MINUTE_MS } from "./clock";
import type { SeedEnv } from "./runs";
import { ALEX_SPEC, MAYA_SPEC, PRICING_JOB, PRODUCT_TEAM_EMAIL, SAM_SPEC, TRIAGE_JOB_DESCRIPTION } from "./specs";
import { q, RECIPIENTS_QUESTION, staffJob } from "./staff";

/**
 * The demo workspace (Acme Robotics): idempotent — the demo organization is deleted by slug and rebuilt with fixed
 * ids, so session cookies and bookmarked worker URLs survive a re-seed. Everything is Simulated, spread over the
 * last three weeks relative to now, and produced by the platform's own engines wherever one exists (blueprint
 * design, simulated brain + tools, deterministic steps, evaluation, feedback, chat, reviews, scoping).
 *
 * Server modules use the shared `db` client; pass the same client (the default) — the parameter exists so the CLI
 * and the test own the connection lifecycle.
 */

export const DEMO_IDS = {
  organizationId: "org_demo",
  userId: "user_demo",
  alex: { jobId: "job_demo_alex", workerId: "worker_demo_alex" },
  maya: { jobId: "job_demo_maya", workerId: "worker_demo_maya" },
  sam: { jobId: "job_demo_sam", workerId: "worker_demo_sam" },
} as const;

export interface SeedSummary {
  organizationId: string;
  userId: string;
  workers: { alex: string; maya: string; sam: string };
  waitingRunId: string;
  pendingApprovalId: string;
  jobs: { pricing: string; triage: string };
}

async function reset(db: PrismaClient): Promise<void> {
  const email = DEMO_USER.email.toLowerCase();
  // Tenant rows cascade from Organization; the user row is unique by email across orgs, so clear it explicitly.
  await db.organization.deleteMany({ where: { OR: [{ slug: DEMO_USER.organizationSlug }, { id: DEMO_IDS.organizationId }] } });
  await db.user.deleteMany({ where: { OR: [{ email }, { id: DEMO_IDS.userId }] } });
}

export async function seedDemo(client: PrismaClient = defaultDb, opts: { now?: Date; log?: (line: string) => void } = {}): Promise<SeedSummary> {
  // The demo is Simulated by definition, even on a machine that has provider keys configured.
  const previous = process.env.FORCE_SIMULATED;
  process.env.FORCE_SIMULATED = "true";
  try {
    // History is backdated from the real clock, so "now" can move into the past but never into the future.
    const real = new Date();
    const now = opts.now && opts.now.getTime() < real.getTime() ? opts.now : real;
    return await build(client, now, opts.log ?? (() => {}));
  } finally {
    if (previous === undefined) delete process.env.FORCE_SIMULATED;
    else process.env.FORCE_SIMULATED = previous;
  }
}

async function build(db: PrismaClient, now: Date, log: (line: string) => void): Promise<SeedSummary> {
  await reset(db);
  const createdAt = new Date(now.getTime() - 22 * DAY_MS);
  const organization = await db.organization.create({
    data: { id: DEMO_IDS.organizationId, name: DEMO_USER.organizationName, slug: DEMO_USER.organizationSlug, createdAt, updatedAt: createdAt },
  });
  const user = await db.user.create({
    data: {
      id: DEMO_IDS.userId,
      organizationId: organization.id,
      email: DEMO_USER.email.toLowerCase(),
      name: DEMO_USER.name,
      passwordHash: await hashPassword(DEMO_USER.password),
      role: "OWNER",
      createdAt,
      updatedAt: createdAt,
    },
  });
  const session: SessionContext = {
    userId: user.id,
    organizationId: organization.id,
    organizationName: organization.name,
    role: user.role,
    name: user.name,
    email: user.email,
  };
  const env: SeedEnv = { db, session };
  const people = { id: user.id, name: user.name };

  const alexDesign = designWorker(ALEX_SPEC, "Alex");
  const mayaDesign = designWorker(MAYA_SPEC, "Maya");
  const samDesign = designSamV1(SAM_SPEC);

  const alexT = alexTimeline(now);
  const alex = await staffJob(db, {
    organizationId: organization.id,
    user: people,
    ids: DEMO_IDS.alex,
    spec: ALEX_SPEC,
    designed: alexDesign,
    description:
      "I need someone to track funding in AI infrastructure every week — who raised, how much, from whom — and tell our platform team what it means for us. Compute, inference, vector databases, training tools, agent infra.",
    intake: {
      questions: [
        q("focus", "Which geographies, segments or stages matter most?", "Keeps the search focused on what you would actually act on.", ["AI infrastructure, seed to Series B", "North America and Europe", "Enterprise SaaS, any stage"]),
        q("volume", "How many records per run is ideal?", "Sets the target the worker is measured against and how much it searches.", ["10", "15", "25"]),
        RECIPIENTS_QUESTION,
      ],
      answers: { focus: "AI infrastructure — compute, inference, vector DBs, training and agent tooling; seed to Series C", volume: "About 12", recipients: "Just me, in the workspace" },
    },
    ...alexT,
  });

  const mayaT = mayaTimeline(now, MAYA_SPEC.cadence);
  const maya = await staffJob(db, {
    organizationId: organization.id,
    user: people,
    ids: DEMO_IDS.maya,
    spec: MAYA_SPEC,
    designed: mayaDesign,
    description: `Read all the customer feedback that comes in — support, NPS, app reviews, sales calls — sort it into themes and send the product team (${PRODUCT_TEAM_EMAIL}) a report every morning with what to fix first.`,
    intake: {
      questions: [
        q("sources", "Where does the feedback come from?", "Tells the worker which sources to read each run.", ["Support tickets and NPS surveys", "App store and G2 reviews", "Sales call notes"]),
        q("priorities", "What should the analysis emphasize?", "Shapes the themes and the recommendations section.", ["Top themes by volume", "Churn risks and severity", "Feature requests for the roadmap"]),
        RECIPIENTS_QUESTION,
      ],
      answers: { sources: "Support tickets, NPS comments, app reviews and sales call notes", priorities: "Churn risks and severity first, then top themes by volume", recipients: `Email it to ${PRODUCT_TEAM_EMAIL} every morning` },
    },
    jobCreatedAt: mayaT.jobCreatedAt,
    specApprovedAt: mayaT.specApprovedAt,
    hiredAt: mayaT.hiredAt,
  });

  const samT = samTimeline(now, SAM_SPEC.cadence);
  const sam = await staffJob(db, {
    organizationId: organization.id,
    user: people,
    ids: DEMO_IDS.sam,
    spec: SAM_SPEC,
    designed: samDesign,
    description:
      "Keep a map of the AI infrastructure landscape for our strategy team — which companies are in which segment, what stage they're at and how much they've raised — and tell us where our robotics compute platform should partner or compete.",
    intake: {
      questions: [
        q("competitors", "Which competitors or products should be covered?", "The analysis is only as good as the set it compares.", ["Our top 5 direct competitors", "Everyone in the category, up to 10", "Let the worker pick the most relevant"]),
        q("dimensions", "Which dimensions matter most?", "Decides what the worker collects and what the analysis focuses on.", ["Pricing and packaging", "Positioning and messaging", "Features and integrations"]),
        RECIPIENTS_QUESTION,
      ],
      answers: { competitors: "Let the worker pick the most relevant — about 10 companies", dimensions: "Segment, stage and funding", recipients: "Just me, in the workspace" },
    },
    jobCreatedAt: samT.jobCreatedAt,
    specApprovedAt: samT.specApprovedAt,
    hiredAt: samT.hiredAt,
  });

  const results: CastResults = { runs: new Map() };
  const jobs = { pricing: "", triage: "" };
  const pricingAt = new Date(now.getTime() - 2 * DAY_MS - 3 * HOUR_MS);
  const triageAt = new Date(now.getTime() - 3 * HOUR_MS - 10 * MINUTE_MS);
  const actions: Action[] = [
    ...alexActions(env, alex, now, results),
    ...mayaActions(env, maya, now, results),
    ...samActions(env, sam, now, results),
    {
      at: pricingAt,
      label: "Pricing job: scoped, spec'd and approved",
      run: async () => {
        const { jobId } = await backdate(db, organization.id, pricingAt, () => scopeJob(session, PRICING_JOB.description));
        const specAt = addMs(pricingAt, 4 * MINUTE_MS + 20_000);
        const { jobSpecId } = await backdate(db, organization.id, specAt, () => buildJobSpec(session, jobId, PRICING_JOB.answers));
        await backdate(db, organization.id, addMs(specAt, 3 * MINUTE_MS + 5_000), () => approveJobSpec(session, jobSpecId));
        jobs.pricing = jobId;
      },
    },
    {
      at: triageAt,
      label: "Triage job: opened, questions waiting",
      run: async () => {
        jobs.triage = (await backdate(db, organization.id, triageAt, () => scopeJob(session, TRIAGE_JOB_DESCRIPTION))).jobId;
      },
    },
  ];

  const ordered = actions.map((a, i) => ({ a, i })).sort((x, y) => x.a.at.getTime() - y.a.at.getTime() || x.i - y.i);
  for (const { a } of ordered) {
    if (a.at.getTime() > now.getTime()) throw new Error(`Seed action "${a.label}" is scheduled in the future`);
    log(`${a.at.toISOString()}  ${a.label}`);
    await a.run();
  }

  // Final state, as the platform would have it right now: first-run locks, the next slot, cached score + health.
  // (lastRunAt was stamped by each successful run, exactly when the runtime would have.)
  for (const seat of [alex, maya, sam]) {
    const first = await db.run.findFirst({ where: { workerId: seat.workerId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    await db.workerVersion.update({ where: { id: seat.versionId }, data: { lockedAt: first?.createdAt ?? null } });
    await db.worker.update({ where: { id: seat.workerId }, data: { nextRunAt: computeNextRunAt(seat.blueprint.schedule, now) } });
    await refreshWorkerScore(seat.workerId);
  }

  const waiting = results.runs.get("maya-waiting");
  if (!waiting?.approvalId) throw new Error("The pending approval was not seeded");
  return {
    organizationId: organization.id,
    userId: user.id,
    workers: { alex: alex.workerId, maya: maya.workerId, sam: sam.workerId },
    waitingRunId: waiting.runId,
    pendingApprovalId: waiting.approvalId,
    jobs,
  };
}
