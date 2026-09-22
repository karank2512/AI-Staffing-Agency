"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CYCLE_MS = 2_500;

/** A 44px indeterminate ring. One arc on a flat track — it spins under `motion-safe` and holds still otherwise. */
function ProgressRing() {
  return (
    <svg
      viewBox="0 0 44 44"
      className="size-11 motion-safe:animate-[spin_1.4s_linear_infinite]"
      role="img"
      aria-label="Working"
    >
      <circle cx="22" cy="22" r="20" fill="none" stroke="var(--secondary)" strokeWidth="3" />
      <circle
        cx="22"
        cy="22"
        r="20"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="34 92"
      />
    </svg>
  );
}

export interface DesigningPanelProps {
  /** Deterministic lines, cross-faded one at a time. Never random, never a claim about work that isn't happening. */
  lines: readonly string[];
  title?: string;
  className?: string;
}

/**
 * The pending state of the hire flow, used while the spec is being approved and the worker designed. It is a
 * designed state, not a spinner: a calm ring, one headline, and a narrative that moves so the wait reads as
 * progress rather than a freeze.
 */
export function DesigningPanel({ lines, title = "Designing your worker…", className }: DesigningPanelProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (lines.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % lines.length), CYCLE_MS);
    return () => clearInterval(timer);
  }, [lines.length]);

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className={cn("flex flex-col items-center gap-6 rounded-xl bg-card px-6 py-16 text-center shadow-card", className)}
    >
      <ProgressRing />
      <div className="space-y-3">
        <h2 className="text-title-2 text-balance">{title}</h2>
        <div className="grid min-h-10 max-w-[40ch] place-items-center">
          {lines.map((line, i) => (
            <p
              key={line}
              aria-hidden={i === index ? undefined : true}
              className={cn(
                "col-start-1 row-start-1 text-body text-pretty text-muted-foreground transition-opacity duration-500 ease-out",
                i === index ? "opacity-100" : "opacity-0",
              )}
            >
              {line}
            </p>
          ))}
        </div>
      </div>
      <p className="text-footnote text-muted-foreground">This usually takes a few seconds.</p>
    </div>
  );
}
