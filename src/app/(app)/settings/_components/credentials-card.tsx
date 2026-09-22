import { KeyRound } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { SettingsCredential } from "@/server/queries/settings";
import { CredentialActions } from "./credential-actions";

export interface CredentialsCardProps {
  credentials: SettingsCredential[];
  /** No live model provider: even a valid tool key stays simulated until the platform is live. */
  simulatedMode: boolean;
  canManage: boolean;
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
}

function StatusLine({ c, simulatedMode }: { c: SettingsCredential; simulatedMode: boolean }) {
  if (c.source === null) return <>Not set — {c.usedBy.map((t) => t.displayName).join(", ")} returns realistic simulated results.</>;
  const where = c.source === "workspace" ? "Stored for this workspace" : `Read from the server's .env (${c.name})`;
  if (c.effective === "live") return <>{where}. Live results on every run.</>;
  return (
    <>
      {where}, but {simulatedMode ? "the platform is in Simulated mode — tools go live together with the models." : "not in use right now."}
    </>
  );
}

/** KNOWN_CREDENTIALS × the vault: one row per key the tools know how to use. Values never reach this page. */
export function CredentialsCard({ credentials, simulatedMode, canManage }: CredentialsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
          Tool credentials
        </CardTitle>
        <CardDescription>
          Keys your workers&apos; tools use to reach the outside world. Encrypted per workspace; a key set here wins over the server&apos;s{" "}
          <Code>.env</Code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-lg border">
          {credentials.map((c) => (
            <li key={c.name} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <Code>{c.name}</Code>
                  {c.effective === "live" ? (
                    <Badge variant="outline" className={cn("gap-1", TONE_CLASSES.success.badge)}>
                      <span className={cn("size-1.5 rounded-full", TONE_CLASSES.success.dot)} aria-hidden="true" />
                      Live
                    </Badge>
                  ) : (
                    <SimulatedBadge />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Used by{" "}
                  {c.usedBy.map((t, i) => (
                    <span key={t.name}>
                      {i > 0 ? ", " : ""}
                      <span className="font-medium text-foreground">{t.displayName}</span>
                    </span>
                  ))}
                  {c.stored ? (
                    <>
                      {" · "}
                      ends in <span className="font-mono text-foreground">{c.stored.last4 ? `…${c.stored.last4}` : "(short key)"}</span>
                      {" · "}set {formatDate(c.stored.setAt)}
                      {c.stored.label ? <> · &ldquo;{c.stored.label}&rdquo;</> : null}
                      {c.stored.lastUsedAt ? (
                        <>
                          {" · "}last used <RelativeTime iso={c.stored.lastUsedAt} />
                        </>
                      ) : (
                        " · not used yet"
                      )}
                    </>
                  ) : null}
                </p>
                <p className="text-xs text-pretty text-muted-foreground">
                  <StatusLine c={c} simulatedMode={simulatedMode} />
                </p>
              </div>
              <CredentialActions
                name={c.name}
                label={c.label}
                docsUrl={c.docsUrl}
                usedBy={c.usedBy.map((t) => t.displayName)}
                stored={c.stored !== null}
                canManage={canManage}
              />
            </li>
          ))}
        </ul>
        {simulatedMode ? (
          <p className="text-xs text-pretty text-muted-foreground">
            Tool keys only take effect once a model provider is live — in Simulated mode every tool answers from the built-in fixtures so the
            demo stays deterministic.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
