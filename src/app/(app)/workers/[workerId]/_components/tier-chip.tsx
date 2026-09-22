import { Bot, Cpu, Zap } from "lucide-react";
import type { ModelTier } from "@/server/domain";
import { cn } from "@/lib/utils";

/** Full static class strings — Tailwind cannot see dynamically built names. */
const TIER_META: Record<ModelTier, { label: string; className: string; icon: typeof Zap; hint: string }> = {
  fast: { label: "Fast model", className: "border-sky-200 bg-sky-50 text-sky-700", icon: Zap, hint: "Cheapest and quickest — fine for simple, well-specified steps." },
  standard: { label: "Standard model", className: "border-indigo-200 bg-indigo-50 text-indigo-700", icon: Bot, hint: "The everyday model — balanced quality and cost." },
  reasoning: { label: "Reasoning model", className: "border-violet-200 bg-violet-50 text-violet-700", icon: Cpu, hint: "Slow and thorough — used where judgement matters most." },
};

export interface TierChipProps {
  tier: ModelTier;
  className?: string;
}

/** Which model tier an agent step runs on. */
export function TierChip({ tier, className }: TierChipProps) {
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  return (
    <span
      title={meta.hint}
      className={cn("inline-flex h-5.5 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap", meta.className, className)}
    >
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
