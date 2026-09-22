import type { ModelTier } from "@/server/domain";
import { cn } from "@/lib/utils";

const TIER_META: Record<ModelTier, { label: string; hint: string }> = {
  fast: { label: "Fast model", hint: "Cheapest and quickest — fine for simple, well-specified steps." },
  standard: { label: "Standard model", hint: "The everyday model — balanced quality and cost." },
  reasoning: { label: "Reasoning model", hint: "Slow and thorough — used where judgement matters most." },
};

export interface TierChipProps {
  tier: ModelTier;
  className?: string;
}

/** Which model tier a step runs on — a word, not a coloured chip. */
export function TierChip({ tier, className }: TierChipProps) {
  const meta = TIER_META[tier];
  return (
    <span title={meta.hint} className={cn("text-footnote whitespace-nowrap text-muted-foreground", className)}>
      {meta.label}
    </span>
  );
}
