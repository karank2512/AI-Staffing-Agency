import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import type { JobSpecVersionItem } from "@/server/queries/jobs";

/** Every draft and approval of the spec, newest first; the version rendered on the page is marked. */
export function SpecVersions({ versions }: { versions: JobSpecVersionItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spec history</CardTitle>
        <CardDescription>
          {versions.length === 0 ? "No spec drafted yet." : "Each revision of the job description."}
        </CardDescription>
      </CardHeader>
      {versions.length > 0 ? (
        <CardContent>
          <ol className="divide-y">
            {versions.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="metric">v{version.version}</span>
                    {version.shown ? <span className="text-xs font-normal text-muted-foreground">shown</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground" title={formatDateTime(version.approvedAt ?? version.createdAt)}>
                    {version.approvedAt ? `Approved ${formatDate(version.approvedAt)}` : `Drafted ${formatDate(version.createdAt)}`}
                  </p>
                </div>
                <StatusBadge kind="spec" status={version.status} />
              </li>
            ))}
          </ol>
        </CardContent>
      ) : null}
    </Card>
  );
}
