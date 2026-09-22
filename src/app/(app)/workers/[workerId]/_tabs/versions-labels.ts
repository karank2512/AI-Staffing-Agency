import type { ModelTier } from "@/server/domain";

/** Pure labels shared by the Versions tab and the replace page (client-safe: no server imports). */

export type ChangeReason = "INITIAL_HIRE" | "REPLACEMENT" | "SPEC_CHANGE" | "MANUAL";

export const CHANGE_REASON_LABELS: Record<ChangeReason, string> = {
  INITIAL_HIRE: "Hired",
  REPLACEMENT: "Replacement",
  SPEC_CHANGE: "Change asked for in chat",
  MANUAL: "Manual edit",
};

export const TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  standard: "Standard",
  reasoning: "Reasoning",
};
