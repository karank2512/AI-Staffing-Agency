"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { isTerminal, type RunLiveView } from "@/server/runtime/types";

/**
 * Live state for /runs/[runId]. The page is server-rendered once with `initial`; this provider then polls
 * `GET /api/runs/[runId]` every `intervalMs` while the run is still moving (not terminal, or terminal but
 * waiting for its evaluation) and hands the latest snapshot to the header, stats, actions and timeline via
 * context. When polling stops it calls `router.refresh()` ONCE so the server-rendered parts (evaluations,
 * tool I/O, checkpoint) catch up with what the poller saw.
 */

export const RUN_POLL_INTERVAL_MS = 1_500;

interface RunLiveContextValue {
  live: RunLiveView;
  /** Whether the poller is active right now. */
  polling: boolean;
  /** Re-render the server parts now (after an inline action such as approving a request). */
  refresh: () => void;
}

const RunLiveContext = createContext<RunLiveContextValue | null>(null);

export function useRunLive(): RunLiveContextValue {
  const value = useContext(RunLiveContext);
  if (!value) throw new Error("useRunLive must be used inside <RunLiveProvider>");
  return value;
}

export function shouldPoll(view: RunLiveView): boolean {
  return !isTerminal(view.run.status) || view.evaluationPending;
}

export interface RunLiveProviderProps {
  runId: string;
  initial: RunLiveView;
  intervalMs?: number;
  children: ReactNode;
}

export function RunLiveProvider({ runId, initial, intervalMs = RUN_POLL_INTERVAL_MS, children }: RunLiveProviderProps) {
  const router = useRouter();
  const [live, setLive] = useState(initial);

  // A fresh server render (router.refresh, navigation) is at least as new as the last poll: adopt it.
  const [adopted, setAdopted] = useState(initial);
  if (initial !== adopted) {
    setAdopted(initial);
    setLive(initial);
  }

  const polling = shouldPoll(live);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      timer = setTimeout(tick, Math.max(500, intervalMs));
    };
    const tick = async () => {
      if (cancelled) return;
      // A hidden tab keeps its place but stops hammering the API; the next visible tick catches up.
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        if (res.status === 401 || res.status === 404) {
          // Session gone or run gone: let the server render decide what to show (sign-in / 404).
          if (!cancelled) router.refresh();
          return;
        }
        if (res.ok) {
          const next = (await res.json()) as RunLiveView;
          if (!cancelled) setLive(next);
        }
      } catch {
        // Transient network failure: keep polling.
      }
      if (!cancelled) schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [polling, runId, intervalMs, router]);

  // Exactly one refresh when polling stops (never on a page that mounts already finished).
  const wasPolling = useRef(polling);
  useEffect(() => {
    if (wasPolling.current && !polling) router.refresh();
    wasPolling.current = polling;
  }, [polling, router]);

  const refresh = useCallback(() => router.refresh(), [router]);

  return <RunLiveContext.Provider value={{ live, polling, refresh }}>{children}</RunLiveContext.Provider>;
}
