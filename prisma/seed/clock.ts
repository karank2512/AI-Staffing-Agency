/**
 * Deterministic time for the demo seed. Every date is an offset from "now" so the workforce always looks like it
 * has been working for the last three weeks, whenever the seed runs. `Timeline` hands out monotonic timestamps
 * for one run so steps, tool calls and usage rows line up the way the executor would have written them.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A moment `days` days ago at the given local hour:minute (defaults to the same time of day as now). */
export function daysAgo(days: number, hour?: number, minute = 0, now = new Date()): Date {
  const d = new Date(now.getTime() - days * DAY_MS);
  if (hour !== undefined) d.setHours(hour, minute, 0, 0);
  return d;
}

export function minutesAgo(minutes: number, now = new Date()): Date {
  return new Date(now.getTime() - minutes * MINUTE_MS);
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

/** Small deterministic hash (FNV-1a) — the seed never uses Math.random. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer in [min, max] derived from a seed string. */
export function seededBetween(seed: string, min: number, max: number): number {
  return min + (hashText(seed) % (max - min + 1));
}

/**
 * Monotonic clock for one run: `next(ms)` advances by `ms` and returns the interval, so a step that "took" 4.2 s
 * starts where the previous one ended. `activeMs` is what the executor would have accumulated.
 */
export class Timeline {
  private cursor: Date;
  activeMs = 0;

  constructor(start: Date) {
    this.cursor = new Date(start);
  }

  get now(): Date {
    return new Date(this.cursor);
  }

  /** Advance by `ms` of ACTIVE work; returns the interval it covered. */
  next(ms: number): { startedAt: Date; finishedAt: Date; durationMs: number } {
    const startedAt = new Date(this.cursor);
    const durationMs = Math.max(1, Math.round(ms));
    this.cursor = new Date(this.cursor.getTime() + durationMs);
    this.activeMs += durationMs;
    return { startedAt, finishedAt: new Date(this.cursor), durationMs };
  }

  /** Let wall-clock time pass without counting it as active work (an approval wait, a retry backoff). */
  wait(ms: number): void {
    this.cursor = new Date(this.cursor.getTime() + Math.max(0, Math.round(ms)));
  }
}
