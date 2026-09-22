import type { ModelTier } from "@/server/domain";

/** Pure labels shared by the Versions tab and the replace page (client-safe: no server imports). */

export type ChangeReason = "INITIAL_HIRE" | "REPLACEMENT" | "SPEC_CHANGE" | "MANUAL";

export const CHANGE_REASON_LABELS: Record<ChangeReason, string> = {
  INITIAL_HIRE: "Hired",
  REPLACEMENT: "Replacement",
  SPEC_CHANGE: "Change requested in chat",
  MANUAL: "Manual edit",
};

export const TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  standard: "Standard",
  reasoning: "Reasoning",
};

/** Static class strings per tier (Tailwind cannot see dynamically built class names). */
export const TIER_CLASSES: Record<ModelTier, string> = {
  fast: "border-slate-200 bg-slate-50 text-slate-600",
  standard: "border-sky-200 bg-sky-50 text-sky-700",
  reasoning: "border-violet-200 bg-violet-50 text-violet-700",
};
