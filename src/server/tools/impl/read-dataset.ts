import { AppError } from "@/server/errors";
import { simulation } from "@/server/simulation";
import { defineTool, plural } from "../define";
import { SAMPLE_DATASETS, type SampleDataset } from "../schemas";

/** "Customer Feedback" / "customer-feedback" → "customer_feedback" (same normalization as simulation.dataset). */
export function canonicalDatasetName(name: string): SampleDataset | undefined {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SAMPLE_DATASETS.find((d) => d === key);
}

export const readDatasetTool = defineTool("read_dataset", {
  displayName: "Dataset reader",
  description: `Read records from a connected dataset. Available datasets: ${SAMPLE_DATASETS.join(", ")}. Returns the records (up to \`limit\`) and the total count.`,
  humanDescription: "Reads records from the workspace's connected data sources (sample datasets in this phase).",
  category: "data",
  sideEffect: "external_read",
  defaultRequiresApproval: false,
  costPerCallUsd: 0.001,
  humanize: (input) => `Read the ${input.dataset.trim()} dataset${input.limit ? ` (up to ${plural(input.limit, "record")})` : ""}`,
  describeForApproval: (input) => ({ title: `Read the ${input.dataset.trim()} dataset` }),
  async execute(input) {
    const dataset = canonicalDatasetName(input.dataset);
    if (!dataset) {
      throw new AppError("TOOL_ERROR", `Unknown dataset "${input.dataset}". Available datasets: ${SAMPLE_DATASETS.join(", ")}`);
    }
    // Phase 1 datasets are the built-in samples, so every read is simulated by definition.
    const all = simulation.dataset(dataset);
    const records = input.limit ? all.slice(0, input.limit) : all;
    return { output: { dataset, records, total: all.length }, simulated: true };
  },
});
