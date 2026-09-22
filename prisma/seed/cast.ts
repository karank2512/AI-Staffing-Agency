import { computeNextRunAt, type Cadence } from "@/server/domain";
import { generatePerformanceReview, recordDeliverableFeedback } from "@/server/evaluation";
import { sendMessageToWorker } from "@/server/workers";
import { backdate } from "./backdate";
import { addMs, atTime, DAY_MS, HOUR_MS, lastOccurrences, MINUTE_MS, occurrencesBetween, seededBetween } from "./clock";
import { invalidJsonAttempt, toolLimitAttempt } from "./failures";
import { seedFailedRun, seedSucceededRun, seedWaitingRun, type RunPlan, type SeedEnv, type SeededRun } from "./runs";
import type { ApprovalDecision } from "./approval-call";
import type { Seat } from "./trace";

/**
 * The three demo workers' histories as timelines of actions (runs, reviews of deliverables, chat, performance
 * reviews). Every time is an offset from `now` or a real schedule slot, so the history is consistent with each
 * worker's cadence whenever the seed runs. The driver executes all actions in chronological order, so anything
 * computed from "the record so far" (scores, chat replies, reviews) sees exactly the history before it.
 */

export interface Action {
  at: Date;
  label: string;
  run: () => Promise<void>;
}

export interface CastResults {
  runs: Map<string, SeededRun>;
}

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
const daysAgoAt = (now: Date, days: number, hour: number, minute = 0) => atTime(ago(now, days * DAY_MS), hour, minute);

/** A run slot a few seconds after its trigger (the scheduler tick / the click). */
const slot = (at: Date, key: string) => addMs(at, seededBetween(key, 2_000, 9_000));

function runAction(env: SeedEnv, seat: Seat, results: CastResults, key: string, plan: RunPlan, kind: "succeeded" | "waiting"): Action {
  return {
    at: plan.queuedAt,
    label: `${seat.workerName}: ${key}`,
    run: async () => {
      const seeded = kind === "waiting" ? await seedWaitingRun(env, seat, plan) : await seedSucceededRun(env, seat, plan);
      results.runs.set(key, seeded);
    },
  };
}

function reviewDeliverable(env: SeedEnv, seat: Seat, results: CastResults, key: string, at: Date, decision: "accept" | "reject", feedback?: (run: SeededRun) => string | undefined): Action {
  return {
    at,
    label: `${seat.workerName}: ${decision} ${key}`,
    run: async () => {
      const run = results.runs.get(key);
      if (!run?.deliverableId) throw new Error(`No deliverable for ${key}`);
      const note = feedback?.(run);
      await backdate(env.db, seat.organizationId, at, () =>
        recordDeliverableFeedback(env.session, { deliverableId: run.deliverableId!, decision, ...(note ? { feedback: note } : {}) }),
      );
    },
  };
}

function chat(env: SeedEnv, seat: Seat, at: Date, content: string): Action {
  return {
    at,
    label: `${seat.workerName}: chat`,
    run: async () => {
      // The reply quotes the worker's calendar as it stood then; the slot is cleared again right after so a live
      // scheduler never sees a past-due worker while the seed is still writing history.
      await env.db.worker.update({ where: { id: seat.workerId }, data: { nextRunAt: computeNextRunAt(seat.blueprint.schedule, at) } });
      try {
        await backdate(env.db, seat.organizationId, at, () => sendMessageToWorker(env.session, seat.workerId, content));
      } finally {
        await env.db.worker.update({ where: { id: seat.workerId }, data: { nextRunAt: null } });
      }
    },
  };
}

/**
 * generatePerformanceReview refuses (CONFLICT) a worker whose current version has no evaluated run yet, so a
 * review is only ever planned after one. This check makes a mis-ordered timeline fail with the action's name
 * instead of a CONFLICT from inside the review.
 */
export async function assertEvaluatedBefore(env: SeedEnv, seat: Seat, at: Date): Promise<void> {
  const evaluated = await env.db.evaluation.findFirst({
    where: { organizationId: seat.organizationId, workerId: seat.workerId, workerVersionId: seat.versionId, runId: { not: null }, createdAt: { lte: at } },
    select: { id: true },
  });
  if (!evaluated) throw new Error(`${seat.workerName}'s performance review at ${at.toISOString()} is planned before any of their runs was evaluated`);
}

function performanceReview(env: SeedEnv, seat: Seat, at: Date): Action {
  return {
    at,
    label: `${seat.workerName}: performance review`,
    run: async () => {
      await assertEvaluatedBefore(env, seat, at);
      await backdate(env.db, seat.organizationId, at, () => generatePerformanceReview(env.session, seat.workerId));
    },
  };
}

/**
 * A human gets to it a few hours after `after` — pulled earlier when that would land in the last half hour, and
 * never before `after` itself (the thing being reviewed must exist first).
 */
function reviewTime(now: Date, after: Date, key: string, minHours = 2, maxHours = 6): Date {
  const at = addMs(after, seededBetween(key, minHours * 60, maxHours * 60) * MINUTE_MS);
  const latest = ago(now, 30 * MINUTE_MS);
  if (at.getTime() <= latest.getTime()) return at;
  return new Date(Math.max(latest.getTime(), addMs(after, 5 * MINUTE_MS).getTime()));
}

// ── Alex ────────────────────────────────────────────────────────────────────

export function alexTimeline(now: Date): { jobCreatedAt: Date; specApprovedAt: Date; hiredAt: Date } {
  const jobCreatedAt = daysAgoAt(now, 21, 10, 2);
  return { jobCreatedAt, specApprovedAt: addMs(jobCreatedAt, 7 * MINUTE_MS + 12_000), hiredAt: addMs(jobCreatedAt, 10 * MINUTE_MS + 40_000) };
}

export const ALEX_INSTRUCTION = "This time, only include Series A and Series B rounds.";

/** The manager's note on Alex's first report — grounded in how many seed rounds it actually contained. */
export function alexFirstReportFeedback(records: Array<Record<string, unknown>>): string | undefined {
  const seed = records.filter((r) => /seed/i.test(String(r.stage ?? ""))).length;
  if (seed === 0) return undefined;
  return `Solid research, but ${seed} of the ${records.length} rounds are seed deals — the platform team only acts on Series A and later. Keep the focus there.`;
}

export function alexActions(env: SeedEnv, seat: Seat, now: Date, results: CastResults): Action[] {
  const { hiredAt } = alexTimeline(now);
  const cadence: Cadence = seat.blueprint.schedule;
  const scheduled = occurrencesBetween(cadence, hiredAt, ago(now, 90 * MINUTE_MS));
  // Six finished runs over three weeks: the hire run, every Monday slot, and "Run now" clicks to fill the rest.
  const manualSlots = [daysAgoAt(now, 10, 15, 40), daysAgoAt(now, 3, 16, 5), daysAgoAt(now, 17, 11, 20), daysAgoAt(now, 13, 10, 15)];
  const manual = manualSlots.slice(0, Math.max(2, 5 - scheduled.length));
  const plans: Array<{ key: string; plan: RunPlan }> = [
    { key: "alex-hire", plan: { trigger: "HIRE" as const, queuedAt: addMs(hiredAt, 4_000), seed: 0 } },
    ...scheduled.map((at, i) => ({ key: `alex-sched-${i}`, plan: { trigger: "SCHEDULED" as const, queuedAt: slot(at, `alex-sched-${i}`), seed: 7 + i * 5 } })),
    ...manual.map((at, i) => ({ key: `alex-manual-${i}`, plan: { trigger: "MANUAL" as const, queuedAt: at, seed: 31 + i * 3 } })),
  ].sort((a, b) => a.plan.queuedAt.getTime() - b.plan.queuedAt.getTime());

  const actions: Action[] = plans.map(({ key, plan }) => runAction(env, seat, results, key, plan, "succeeded"));
  // Every report but the newest was reviewed: the first one sent back over stage focus, the rest accepted.
  plans.slice(0, -1).forEach(({ key, plan }, i) => {
    const at = reviewTime(now, addMs(plan.queuedAt, 3 * MINUTE_MS), `${key}:review`);
    if (i === 0) {
      actions.push(reviewDeliverable(env, seat, results, key, at, "reject", (run) => alexFirstReportFeedback(run.records ?? [])));
      return;
    }
    const note = i === 1 ? "Great — the category breakdown is exactly what the platform team needed." : undefined;
    actions.push(reviewDeliverable(env, seat, results, key, at, "accept", () => note));
  });
  actions.push(chat(env, seat, daysAgoAt(now, 6, 11, 30), "How did your last report score, and what did it cost?"));
  // A one-off instruction, picked up by the manual run a few minutes later (enqueue consumes it).
  actions.push(chat(env, seat, daysAgoAt(now, 3, 15, 58), ALEX_INSTRUCTION));
  actions.push(performanceReview(env, seat, daysAgoAt(now, 2, 17, 30)));
  return actions;
}

// ── Maya ────────────────────────────────────────────────────────────────────

export function mayaTimeline(now: Date, cadence: Cadence): { jobCreatedAt: Date; specApprovedAt: Date; hiredAt: Date; slots: Date[] } {
  const slots = lastOccurrences(cadence, ago(now, 45 * MINUTE_MS), 4);
  const hiredAt = atTime(ago(slots[0], DAY_MS), 10, 35);
  return { jobCreatedAt: addMs(hiredAt, -22 * MINUTE_MS), specApprovedAt: addMs(hiredAt, -6 * MINUTE_MS), hiredAt, slots };
}

export function mayaActions(env: SeedEnv, seat: Seat, now: Date, results: CastResults): Action[] {
  const { hiredAt, slots } = mayaTimeline(now, seat.blueprint.schedule);
  const decisions: ApprovalDecision[] = [
    { decision: "approve", waitMs: 6 * MINUTE_MS },
    { decision: "approve", waitMs: 47 * MINUTE_MS },
    { decision: "reject", note: "Hold this one — I'll walk the team through it at Thursday's product review instead.", waitMs: 72 * MINUTE_MS },
    { decision: "approve", waitMs: 22 * MINUTE_MS },
    { decision: "approve", waitMs: 9 * MINUTE_MS },
  ];
  const plans: Array<{ key: string; plan: RunPlan }> = [
    { key: "maya-hire", plan: { trigger: "HIRE", queuedAt: addMs(hiredAt, 3_000), seed: 0, approval: decisions[0] } },
    ...slots.map((at, i) => ({ key: `maya-sched-${i}`, plan: { trigger: "SCHEDULED" as const, queuedAt: slot(at, `maya-sched-${i}`), seed: 5 + i * 4, approval: decisions[i + 1] } })),
  ];
  const actions: Action[] = plans.map(({ key, plan }) => runAction(env, seat, results, key, plan, "succeeded"));
  plans.forEach(({ key, plan }, i) => {
    const decidedAround = addMs(plan.queuedAt, (plan.approval?.waitMs ?? 0) + 2 * MINUTE_MS);
    const note = i === 1 ? "Useful. The churn-risk callout is the part leadership reads — keep it at the top." : undefined;
    actions.push(reviewDeliverable(env, seat, results, key, reviewTime(now, decidedAround, `${key}:review`, 1, 3), "accept", () => note));
  });
  // The one pending approval of the demo: "Run now" clicked twenty minutes ago.
  actions.push(runAction(env, seat, results, "maya-waiting", { trigger: "MANUAL", queuedAt: ago(now, 20 * MINUTE_MS), seed: 97 }, "waiting"));
  return actions;
}

// ── Sam ─────────────────────────────────────────────────────────────────────

export function samTimeline(now: Date, cadence: Cadence): { jobCreatedAt: Date; specApprovedAt: Date; hiredAt: Date; slots: Date[] } {
  const slots = lastOccurrences(cadence, ago(now, 2 * HOUR_MS), 6);
  const hiredAt = atTime(ago(slots[0], DAY_MS), 14, 20);
  return { jobCreatedAt: addMs(hiredAt, -25 * MINUTE_MS), specApprovedAt: addMs(hiredAt, -8 * MINUTE_MS), hiredAt, slots };
}

/** Feedback in the manager's words, grounded in what the deliverable actually contains. */
export function samFeedback(records: Array<Record<string, unknown>>, target: number, closing: string): string {
  const names = records.map((r) => String(r.company ?? "").trim()).filter(Boolean);
  const unique = [...new Set(names.map((n) => n.toLowerCase()))];
  const twice = names.find((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i);
  const noAmount = records.filter((r) => r.amount_usd === null || r.amount_usd === undefined || r.amount_usd === "").length;
  const gaps = records.filter((r) => ["category", "stage", "source_url"].some((f) => r[f] === null || r[f] === undefined || r[f] === "")).length;
  const parts = [`Only ${unique.length} companies — the brief asks for ${target}.`];
  if (twice) parts.push(`${twice} is listed twice.`);
  if (noAmount > 0) parts.push(`${noAmount} row${noAmount === 1 ? " has" : "s have"} no amount.`);
  if (gaps > 0) parts.push(`${gaps} more ${gaps === 1 ? "is" : "are"} missing a stage, category or source.`);
  parts.push(closing);
  return parts.join(" ");
}

export function samActions(env: SeedEnv, seat: Seat, now: Date, results: CastResults): Action[] {
  const { hiredAt, slots } = samTimeline(now, seat.blueprint.schedule);
  const target = seat.spec.deliverable.targetCount ?? 10;
  const args = (at: Date, seed: number) => ({ blueprint: seat.blueprint, spec: seat.spec, workerName: seat.workerName, now: at, seed });
  const failed = (key: string, queuedAt: Date, seed: number, kind: "json" | "limit"): Action => ({
    at: queuedAt,
    label: `Sam: ${key}`,
    run: async () => {
      const run = await seedFailedRun(env, seat, { trigger: "SCHEDULED", queuedAt, seed }, (startedAt) =>
        kind === "json" ? [invalidJsonAttempt(args(startedAt, seed)), invalidJsonAttempt(args(startedAt, seed))] : [toolLimitAttempt(args(startedAt, seed))],
      );
      results.runs.set(key, run);
    },
  });
  const sched = (i: number) => slot(slots[i], `sam-sched-${i}`);

  const actions: Action[] = [
    runAction(env, seat, results, "sam-hire", { trigger: "HIRE", queuedAt: addMs(hiredAt, 3_000), seed: 0 }, "succeeded"),
    failed("sam-sched-0", sched(0), 3, "json"),
    runAction(env, seat, results, "sam-sched-1", { trigger: "SCHEDULED", queuedAt: sched(1), seed: 11 }, "succeeded"),
    failed("sam-sched-2", sched(2), 13, "limit"),
    runAction(env, seat, results, "sam-sched-3", { trigger: "SCHEDULED", queuedAt: sched(3), seed: 17 }, "succeeded"),
    failed("sam-sched-4", sched(4), 19, "json"),
    runAction(env, seat, results, "sam-sched-5", { trigger: "SCHEDULED", queuedAt: sched(5), seed: 23 }, "succeeded"),
  ];
  const firstRejection = reviewTime(now, addMs(hiredAt, 3 * MINUTE_MS), "sam-hire:review", 3, 4);
  const secondRejection = reviewTime(now, addMs(sched(3), 3 * MINUTE_MS), "sam-sched-3:review", 2, 3);
  actions.push(
    reviewDeliverable(env, seat, results, "sam-hire", firstRejection, "reject", (run) => samFeedback(run.records ?? [], target, "I can't send this to the strategy team.")),
    reviewDeliverable(env, seat, results, "sam-sched-1", reviewTime(now, addMs(sched(1), 3 * MINUTE_MS), "sam-sched-1:review", 4, 5), "accept", () => "Usable this time, but double-check the amounts before it goes out."),
    reviewDeliverable(env, seat, results, "sam-sched-3", secondRejection, "reject", (run) =>
      samFeedback(run.records ?? [], target, "Same problems as the first map — fix the basics before adding anything new."),
    ),
    chat(env, seat, addMs(secondRejection, 25 * MINUTE_MS), "Why does your report keep repeating companies and leaving amounts blank? This is the second map with the same problem."),
    performanceReview(env, seat, reviewTime(now, addMs(sched(5), 5 * MINUTE_MS), "sam:performance", 1, 2)),
  );
  return actions;
}
