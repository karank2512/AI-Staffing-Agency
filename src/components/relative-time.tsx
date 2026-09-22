"use client";

import { useSyncExternalStore } from "react";
import { EMPTY, formatDateTime, formatRelativeTime } from "@/lib/format";

/**
 * One shared 30 s ticker for every <RelativeTime> on the page (an activity feed can mount dozens).
 * The interval only runs while at least one instance is subscribed.
 */
const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let tick = 1;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(() => {
      tick += 1;
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number => tick;
/** 0 = "this is the server / hydration render". */
const getServerSnapshot = (): number => 0;

export interface RelativeTimeProps {
  /** ISO-8601 timestamp (queries serialize dates with `.toISOString()`). `null` renders an em-dash. */
  iso: string | null | undefined;
  className?: string;
}

/**
 * "5 minutes ago" that keeps itself current, with the absolute local time in the `title` tooltip.
 *
 * Hydration-safe: server and browser disagree on "now" (and possibly on the time zone), so the server-rendered
 * text is accepted as-is (`suppressHydrationWarning`), and right after hydration the element is re-keyed so the
 * browser's own values replace it — React would otherwise leave stale server text in the DOM.
 */
export function RelativeTime({ iso, className }: RelativeTimeProps) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!iso) return <span className={className}>{EMPTY}</span>;
  return (
    <time
      key={current === 0 ? "server" : "client"}
      dateTime={iso}
      title={formatDateTime(iso)}
      className={className}
      suppressHydrationWarning
    >
      {formatRelativeTime(iso)}
    </time>
  );
}
