/** Serializable view models (numbers, ISO strings — never Decimal/Date). */

export interface UsageTotals {
  costUsd: number;
  billableUsd: number;
  /** Portion of costUsd that came from Simulated-mode calls (priced at reference rates, not actually spent). */
  simulatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  toolCalls: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  totals: UsageTotals;
  /** One entry per calendar day in range, zero-filled. date = yyyy-MM-dd. */
  byDay: Array<{ date: string; costUsd: number; billableUsd: number; modelCostUsd: number; toolCostUsd: number }>;
  byWorker: Array<{
    workerId: string | null;
    workerName: string;
    avatarColor: string | null;
    costUsd: number;
    billableUsd: number;
    runs: number;
  }>;
  byModel: Array<{
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    simulated: boolean;
  }>;
  byTool: Array<{ toolName: string; calls: number; costUsd: number }>;
}

export interface WorkerCostSummary {
  days: number;
  runs: number;
  totalCostUsd: number;
  avgCostPerRunUsd: number | null;
  costPerDeliverableUsd: number | null;
  /** currentVersion.blueprint.costEstimate.perRunUsd */
  estimatedPerRunUsd: number | null;
  byDay: Array<{ date: string; costUsd: number }>;
  byVersion: Array<{
    workerVersionId: string;
    version: number;
    runs: number;
    totalCostUsd: number;
    avgCostPerRunUsd: number | null;
  }>;
  /** Spend grouped by model (kind MODEL) and by tool (kind TOOL). */
  byResource: Array<{ label: string; kind: "MODEL" | "TOOL"; calls: number; costUsd: number }>;
}
