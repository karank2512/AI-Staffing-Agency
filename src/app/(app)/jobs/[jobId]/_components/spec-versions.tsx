import { ChevronDown } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatDateTime } from "@/lib/format";
import type { JobSpecVersionItem } from "@/server/queries/jobs";

/**
 * Every draft and approval of the spec, newest first — collapsed by default, because the current description is
 * what people came for. The version rendered on the page is marked.
 */
export function SpecVersions({ versions }: { versions: JobSpecVersionItem[] }) {
  if (versions.length === 0) {
    return <p className="border-t border-border py-4 text-[15px] text-muted-foreground">No spec has been drafted yet.</p>;
  }

  return (
    <details className="group/versions border-t border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-semibold tracking-[-0.012em] select-none [&::-webkit-details-marker]:hidden">
        Version history
        <ChevronDown
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-[240ms] ease-standard group-open/versions:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <ol className="pb-4">
        {versions.map((version) => (
          <li key={version.id} className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[15px] font-medium">
                <span className="metric">v{version.version}</span>
                {version.shown ? <span className="text-footnote font-normal text-muted-foreground">shown above</span> : null}
              </p>
              <p className="text-footnote text-muted-foreground" title={formatDateTime(version.approvedAt ?? version.createdAt)}>
                {version.approvedAt ? `Approved ${formatDate(version.approvedAt)}` : `Drafted ${formatDate(version.createdAt)}`}
              </p>
            </div>
            <StatusBadge kind="spec" status={version.status} />
          </li>
        ))}
      </ol>
    </details>
  );
}
