"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WorkerAvatar } from "@/components/worker-avatar";

/** Radix Select cannot represent "no value" as an item, so "all" is a sentinel that maps to no query param. */
const ALL = "all";

export interface ActivityFiltersProps {
  workers: Array<{ id: string; name: string; title: string; avatarColor: string; status: string }>;
  groups: Array<{ value: string; label: string }>;
  /** Current selection (from searchParams); undefined = all. */
  workerId?: string;
  group?: string;
}

/** Worker + event-type filters for the feed. Selections live in the URL so pages are shareable and "Load more" keeps them. */
export function ActivityFilters({ workers, groups, workerId, group }: ActivityFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function apply(next: { worker?: string; type?: string }) {
    const params = new URLSearchParams();
    const worker = next.worker ?? workerId;
    const type = next.type ?? group;
    if (worker && worker !== ALL) params.set("worker", worker);
    if (type && type !== ALL) params.set("type", type);
    // A new filter always starts from the newest events — an old cursor would make the first page look empty.
    const query = params.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  const filtered = Boolean(workerId || group);
  // An id that matches no worker (stale link) would leave the trigger blank; show "All workers" but keep Clear visible.
  const workerValue = workerId && workers.some((w) => w.id === workerId) ? workerId : ALL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={workerValue} onValueChange={(value) => apply({ worker: value })}>
        <SelectTrigger size="sm" className="min-w-40" aria-label="Filter by worker">
          <SelectValue placeholder="All workers" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All workers</SelectItem>
          {workers.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              <WorkerAvatar name={w.name} color={w.avatarColor} size="sm" className="size-4 text-[8px]" />
              <span>
                {w.name}
                {w.status === "RETIRED" ? <span className="text-muted-foreground"> (retired)</span> : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={group ?? ALL} onValueChange={(value) => apply({ type: value })}>
        <SelectTrigger size="sm" className="min-w-36" aria-label="Filter by event type">
          <SelectValue placeholder="All events" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All events</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.value} value={g.value}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filtered ? (
        <Button variant="ghost" size="sm" asChild>
          <Link href={pathname}>
            <X aria-hidden="true" /> Clear
          </Link>
        </Button>
      ) : null}
      {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /> : null}
    </div>
  );
}
