import type { Cadence } from "./job-spec";

/**
 * Schedule math shared by staffing (hire), workers (activate/update/resume) and the runtime scheduler.
 * PURE. Hours/day-of-week are interpreted in SERVER LOCAL TIME (tests build dates with `new Date(y, m, d, h)`).
 */

export type ScheduleKindSlug = "MANUAL" | "HOURLY" | "DAILY" | "WEEKLY";

export interface WorkerScheduleFields {
  scheduleKind: ScheduleKindSlug;
  scheduleHour: number | null;
  scheduleDow: number | null;
}

const DEFAULT_HOUR = 9;
const DEFAULT_DOW = 1; // Monday

export function cadenceToWorkerFields(c: Cadence): WorkerScheduleFields {
  switch (c.kind) {
    case "manual":
      return { scheduleKind: "MANUAL", scheduleHour: null, scheduleDow: null };
    case "hourly":
      return { scheduleKind: "HOURLY", scheduleHour: null, scheduleDow: null };
    case "daily":
      return { scheduleKind: "DAILY", scheduleHour: c.hour ?? DEFAULT_HOUR, scheduleDow: null };
    case "weekly":
      return { scheduleKind: "WEEKLY", scheduleHour: c.hour ?? DEFAULT_HOUR, scheduleDow: c.dayOfWeek ?? DEFAULT_DOW };
  }
}

export function workerFieldsToCadence(w: {
  scheduleKind: ScheduleKindSlug;
  scheduleHour: number | null;
  scheduleDow: number | null;
}): Cadence {
  switch (w.scheduleKind) {
    case "MANUAL":
      return { kind: "manual" };
    case "HOURLY":
      return { kind: "hourly" };
    case "DAILY":
      return { kind: "daily", hour: w.scheduleHour ?? DEFAULT_HOUR };
    case "WEEKLY":
      return { kind: "weekly", hour: w.scheduleHour ?? DEFAULT_HOUR, dayOfWeek: w.scheduleDow ?? DEFAULT_DOW };
  }
}

/** Next fire time STRICTLY after `from`. null for manual schedules. */
export function computeNextRunAt(c: Cadence, from: Date): Date | null {
  if (c.kind === "manual") return null;

  if (c.kind === "hourly") {
    const next = new Date(from);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }

  const hour = c.hour ?? DEFAULT_HOUR;
  const next = new Date(from);
  next.setHours(hour, 0, 0, 0);

  if (c.kind === "daily") {
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }

  // weekly
  const dow = c.dayOfWeek ?? DEFAULT_DOW;
  let daysAhead = (dow - next.getDay() + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= from.getTime()) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next;
}

export function runsPerMonth(c: Cadence): number {
  switch (c.kind) {
    case "manual":
      return 4; // planning assumption for on-demand workers
    case "hourly":
      return 24 * 30;
    case "daily":
      return 30;
    case "weekly":
      return 4.33;
  }
}

export function describeCadence(c: Cadence): string {
  const hh = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  switch (c.kind) {
    case "manual":
      return "On demand";
    case "hourly":
      return "Every hour";
    case "daily":
      return `Daily at ${hh(c.hour ?? DEFAULT_HOUR)}`;
    case "weekly":
      return `Weekly on ${days[c.dayOfWeek ?? DEFAULT_DOW]} at ${hh(c.hour ?? DEFAULT_HOUR)}`;
  }
}
