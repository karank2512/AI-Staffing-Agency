"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export interface AutoRefreshProps {
  /** Poll only while something on the page can still change (a run in flight, a pending approval). */
  active: boolean;
  /** Default 4000 ms. Values under 1000 ms are clamped to 1000. */
  intervalMs?: number;
}

/**
 * Keeps a server-rendered list fresh: calls `router.refresh()` on an interval while `active`. Pauses while the
 * tab is hidden and refreshes once as soon as it becomes visible again. Renders nothing.
 *
 * ```tsx
 * <AutoRefresh active={runs.some((r) => r.status === "RUNNING" || r.status === "QUEUED")} />
 * ```
 */
export function AutoRefresh({ active, intervalMs = 4000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const every = Math.max(1000, intervalMs);
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(() => router.refresh(), every);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        router.refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, intervalMs, router]);

  return null;
}
