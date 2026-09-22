import type { VersionChangeReason, WorkerVersionStatus } from "@prisma/client";

/**
 * Wording for the replace / compare page. The same URL is used before the decision (a proposal to review) and
 * after it (feed and Versions-tab links keep pointing here), so every label depends on the version's status as
 * well as on why it was drafted. Pure: tested directly and safe in client leaves.
 */

export interface ReplaceLabelInput {
  workerName: string;
  changeReason: VersionChangeReason;
  status: WorkerVersionStatus;
  version: number;
}

/** Hired / applied at some point: ACTIVE today, or REPLACED by a later version. */
function wasAdopted(status: WorkerVersionStatus): boolean {
  return status === "ACTIVE" || status === "REPLACED";
}

export function replacePageTitle({ workerName, changeReason, status, version }: ReplaceLabelInput): string {
  if (changeReason === "REPLACEMENT") {
    if (status === "PROPOSED") return `Proposed replacement for ${workerName}`;
    if (status === "REJECTED") return `Declined replacement for ${workerName}`;
    return `${workerName} · version ${version} (replacement)`;
  }
  if (changeReason === "SPEC_CHANGE") {
    if (status === "PROPOSED") return `Proposed change to how ${workerName} works`;
    if (status === "REJECTED") return `Declined change to how ${workerName} works`;
    return `${workerName} · version ${version} (changed)`;
  }
  return `${workerName} · version ${version}`;
}

export function replaceCrumb({ changeReason, status, version }: Omit<ReplaceLabelInput, "workerName">): string {
  if (changeReason === "REPLACEMENT") {
    if (status === "PROPOSED") return "Proposed replacement";
    if (status === "REJECTED") return "Declined replacement";
  } else if (changeReason === "SPEC_CHANGE") {
    if (status === "PROPOSED") return "Proposed change";
    if (status === "REJECTED") return "Declined change";
  }
  return `Version ${version}`;
}

/** Heading of the right-hand (target) card in the side-by-side comparison. */
export function targetCardHeading({ changeReason, status, version }: Omit<ReplaceLabelInput, "workerName">): string {
  if (changeReason === "REPLACEMENT") {
    if (status === "PROPOSED") return "Proposed replacement";
    if (status === "REJECTED") return "Declined replacement";
    return "Replacement";
  }
  if (changeReason === "SPEC_CHANGE") {
    if (status === "PROPOSED") return "Proposed change";
    if (status === "REJECTED") return "Declined change";
    return "Changed version";
  }
  return `Version ${version}`;
}

/** "the proposal" before the decision, then what it became: "the replacement", "the changed version". */
export function targetNoun({ changeReason, status, version }: Omit<ReplaceLabelInput, "workerName">): string {
  if (status === "PROPOSED" || status === "REJECTED") return "the proposal";
  if (changeReason === "REPLACEMENT") return "the replacement";
  if (changeReason === "SPEC_CHANGE") return "the changed version";
  return `version ${version}`;
}

/** Description of the "Estimated impact" section; analysis estimates are forecasts, so tense follows the decision. */
export function impactDescription(source: "analysis" | "estimate", status: WorkerVersionStatus): string {
  if (source === "estimate") return "Derived from the two cost estimates.";
  if (status === "PROPOSED") return "What the analysis expects once the replacement is hired.";
  if (wasAdopted(status)) return "What the analysis expected when the replacement was proposed, before it was hired.";
  return "What the analysis expected if the replacement had been hired.";
}
