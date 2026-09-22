import type { JobStatus } from "@prisma/client";
import { statusLabel } from "@/lib/status";
import { SegmentedLinks } from "../../runs/_components/segmented";

const ORDER: readonly JobStatus[] = ["DRAFT", "SPEC_APPROVED", "STAFFED", "PAUSED", "CLOSED"];

export interface StatusFilterProps {
  active: JobStatus | null;
  counts: Record<JobStatus | "all", number>;
}

/**
 * Segmented filter driven entirely by `?status=` so the list stays a server component (and the URL is shareable).
 * Statuses with zero jobs are still listed so the filter reads the same on every visit.
 */
export function StatusFilter({ active, counts }: StatusFilterProps) {
  const current: JobStatus | "all" = active ?? "all";
  return (
    <SegmentedLinks
      label="Filter jobs by status"
      options={[
        { label: "All", href: "/jobs", active: current === "all", count: counts.all },
        ...ORDER.map((status) => ({
          label: statusLabel("job", status),
          href: `/jobs?status=${status.toLowerCase()}`,
          active: current === status,
          count: counts[status],
        })),
      ]}
    />
  );
}
