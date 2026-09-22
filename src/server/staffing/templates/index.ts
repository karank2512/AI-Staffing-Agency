import type { BlueprintDraft, JobFamily, JobSpec } from "@/server/domain";
import { contentTemplate, generalTemplate } from "./content";
import { feedbackAnalysisTemplate, financeOpsTemplate, supportTriageTemplate } from "./operations";
import { leadResearchTemplate, marketAnalysisTemplate, marketResearchTemplate } from "./research";
import { templateContext, type TemplateContext } from "./shared";

/**
 * Job-family templates — the Simulated-mode designer and the fallback when live output is unusable.
 * Each template reads the approved spec (fields, target, cadence, notify cues) so the draft is specific to the
 * job, not a canned blueprint. PURE and deterministic.
 */

const TEMPLATES: Record<JobFamily, (ctx: TemplateContext) => BlueprintDraft> = {
  market_research: marketResearchTemplate,
  market_analysis: marketAnalysisTemplate,
  lead_research: leadResearchTemplate,
  feedback_analysis: feedbackAnalysisTemplate,
  support_triage: supportTriageTemplate,
  finance_ops: financeOpsTemplate,
  content: contentTemplate,
  general: generalTemplate,
};

export function draftFromTemplate(spec: JobSpec, opts: { usedNames?: string[] } = {}): BlueprintDraft {
  return TEMPLATES[spec.jobFamily](templateContext(spec, opts.usedNames ?? []));
}
