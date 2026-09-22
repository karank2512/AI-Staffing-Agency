import { cn } from "@/lib/utils";
import { HIRE_STEPS, type HireStepKey } from "../schema";

/**
 * The quiet step indicator: one 13px line of text over a five-segment rail. Deliberately not a stepper —
 * nobody navigates by clicking it, so it only has to answer "how far in am I?".
 */
export function HireProgress({ current, className }: { current: HireStepKey; className?: string }) {
  const index = Math.max(
    0,
    HIRE_STEPS.findIndex((s) => s.key === current),
  );
  const step = HIRE_STEPS[index];

  return (
    <div className={cn("mb-7", className)}>
      <p className="text-footnote text-muted-foreground">
        <span className="metric">
          Step {index + 1} of {HIRE_STEPS.length}
        </span>
        {step ? <> · {step.label}</> : null}
      </p>
      <ol aria-label="Hire progress" className="mt-2.5 flex items-center gap-1">
        {HIRE_STEPS.map((s, i) => (
          <li
            key={s.key}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200 ease-standard",
              i < index && "bg-foreground",
              i === index && "bg-primary",
              i > index && "bg-secondary",
            )}
          >
            <span className="sr-only">
              {s.label}
              {i < index ? " (done)" : i === index ? " (current step)" : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
