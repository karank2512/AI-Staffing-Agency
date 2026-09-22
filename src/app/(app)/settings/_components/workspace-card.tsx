import { Building2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SettingsWorkspace } from "@/server/queries/settings";

const ROLE_LABEL: Record<SettingsWorkspace["members"][number]["role"], string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export interface WorkspaceCardProps {
  workspace: SettingsWorkspace;
  /** The signed-in user, highlighted in the member list. */
  currentUserId: string;
}

/** Read-only in Phase 1: who you are, which workspace this is, and who else is in it. */
export function WorkspaceCard({ workspace, currentUserId }: WorkspaceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
          Workspace
        </CardTitle>
        <CardDescription>Your organization and the people who can hire and manage workers in it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Organization</dt>
            <dd className="mt-0.5 font-medium">{workspace.organizationName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Created</dt>
            <dd className="mt-0.5 font-medium">{formatDate(workspace.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Members</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
              <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {pluralize(workspace.memberCount, "member")}
            </dd>
          </div>
        </dl>

        <div>
          <p className="eyebrow mb-2">People</p>
          <ul className="divide-y rounded-lg border">
            {workspace.members.map((m) => {
              const isYou = m.id === currentUserId;
              return (
                <li key={m.id} className={cn("flex items-center justify-between gap-3 px-3 py-2.5", isYou && "bg-muted/40")}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.name}
                      {isYou ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <Badge variant={m.role === "MEMBER" ? "outline" : "secondary"}>{ROLE_LABEL[m.role]}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Owners and admins can manage tool credentials. Inviting teammates is not part of this preview — the demo workspace
            comes with one account.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
