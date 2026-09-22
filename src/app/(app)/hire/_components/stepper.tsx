import { Fragment } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIRE_STEPS, type HireStepKey } from "../schema";

/** The five-stop progress header. `current` is derived on the server from the flow state — never from client state. */
export function HireStepper({ current }: { current: HireStepKey }) {
  const currentIndex = HIRE_STEPS.findIndex((s) => s.key === current);
  return (
    <ol aria-label="Hire progress" className="flex items-center gap-2 overflow-x-auto pb-1 sm:gap-3">
      {HIRE_STEPS.map((step, index) => {
        const status = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
        const isLast = index === HIRE_STEPS.length - 1;
        return (
          <Fragment key={step.key}>
            <li
              aria-current={status === "current" ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-[13px] font-medium transition-colors",
                status === "current" && "bg-primary/10 text-foreground ring-1 ring-primary/20",
                status === "done" && "text-foreground",
                status === "upcoming" && "text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ring-1 ring-inset",
                  status === "current" && "bg-primary text-primary-foreground ring-primary",
                  status === "done" && "bg-emerald-50 text-emerald-700 ring-emerald-200",
                  status === "upcoming" && "bg-muted text-muted-foreground ring-foreground/10",
                )}
              >
                {status === "done" ? <Check className="size-3.5" /> : isLast ? "✓" : index + 1}
              </span>
              <span className="whitespace-nowrap">
                {step.label}
                {status === "current" ? <span className="sr-only"> (current step)</span> : null}
              </span>
            </li>
            {isLast ? null : (
              <li aria-hidden="true" className={cn("h-px min-w-4 flex-1 rounded-full", index < currentIndex ? "bg-emerald-300" : "bg-border")} />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
