"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { withParams } from "./segmented";

export interface WorkerFilterProps {
  /** "/runs" or "/deliverables". */
  basePath: string;
  workers: Array<{ id: string; name: string }>;
  /** Currently selected worker id, or null for everyone. */
  selected: string | null;
  /** Other search params to keep when the selection changes. */
  preserve?: Record<string, string | undefined>;
  /** Label for the "no filter" option. */
  allLabel?: string;
}

const ALL = "__all__";

/**
 * Worker filter as a gray pill Select. The URL stays the source of truth — picking a name just navigates, so
 * the list itself remains a server component.
 */
export function WorkerFilter({ basePath, workers, selected, preserve, allLabel = "Everyone" }: WorkerFilterProps) {
  const router = useRouter();

  return (
    <Select
      value={selected ?? ALL}
      onValueChange={(value) => {
        router.push(withParams(basePath, { ...preserve, worker: value === ALL ? undefined : value }), { scroll: false });
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Filter by worker"
        className="h-8 rounded-full border-transparent bg-secondary px-3.5 text-[13px] font-medium hover:bg-secondary-hover sm:text-[13px]"
      >
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {workers.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
