import { db } from "@/server/db";
import { llm } from "@/server/models";

export interface ShellData {
  /** True when no live model provider is configured — the whole product runs on the deterministic simulator. */
  simulated: boolean;
  /** Approvals a human can act on right now. */
  pendingApprovals: number;
}

/**
 * Data for the app chrome, loaded once per request by `src/app/(app)/layout.tsx`.
 *
 * An approval only counts while its run is still WAITING_FOR_APPROVAL: a PENDING row whose run was cancelled or
 * failed in the meantime is about to be expired by the runtime and is no longer actionable — the same filter
 * the /approvals pending list uses, so the badge and the list always agree.
 */
export async function getShellData(organizationId: string): Promise<ShellData> {
  const pendingApprovals = await db.approval.count({
    where: { organizationId, status: "PENDING", run: { status: "WAITING_FOR_APPROVAL" } },
  });
  return { simulated: llm.isSimulated(), pendingApprovals };
}
