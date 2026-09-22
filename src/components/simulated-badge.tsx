import { FlaskConical } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const SIMULATED_EXPLANATION =
  "No model API keys detected — workers run on a deterministic simulator. Add keys in .env to go live.";

export interface SimulatedBadgeProps {
  className?: string;
}

/**
 * The "Simulated" marker. Rendered globally by AppShell when the platform has no live model provider, and by
 * pages next to anything produced in simulated mode (`Run.simulated`, tool calls, usage rows). Render it
 * conditionally — the component itself is unconditional.
 */
export function SimulatedBadge({ className }: SimulatedBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-slot="simulated-badge"
          tabIndex={0}
          className={cn(
            "inline-flex h-5.5 w-fit shrink-0 cursor-help items-center gap-1 rounded-full border border-dashed border-amber-300 bg-amber-50 px-2 text-xs font-medium whitespace-nowrap text-amber-800 outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
            className,
          )}
        >
          <FlaskConical className="size-3" aria-hidden="true" />
          Simulated
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 text-pretty">
        {SIMULATED_EXPLANATION}
      </TooltipContent>
    </Tooltip>
  );
}
