import { RelativeTime } from "@/components/relative-time";
import { formatDate } from "@/lib/format";
import type { SettingsCredential } from "@/server/queries/settings";
import { SettingsGroup, SettingsRow, StatusLine } from "./settings-list";
import { CredentialActions } from "./credential-actions";

export interface CredentialsSectionProps {
  credentials: SettingsCredential[];
  /** No live model provider: a valid tool key still answers from fixtures until the platform goes live. */
  simulatedMode: boolean;
  /** `credentials.manage` — ADMIN and up. */
  canManage: boolean;
}

function toolList(usedBy: SettingsCredential["usedBy"]): string {
  const names = usedBy.map((t) => t.displayName);
  if (names.length === 0) return "no tools yet";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** One row per key the tools know how to use. Values enter through the dialog and are never read back. */
export function CredentialsSection({ credentials, simulatedMode, canManage }: CredentialsSectionProps) {
  return (
    <div className="space-y-10">
      <SettingsGroup
        title="Tool keys"
        description="What your workers use to reach the outside world."
        footer={
          canManage
            ? "Keys are stored for this workspace and never shown again — not even to you. A key set here wins over the server's environment, and removing one falls back to it."
            : "Only owners and admins can add or remove tool keys."
        }
      >
        {credentials.map((credential) => {
          const stored = credential.stored;
          return (
            <SettingsRow
              key={credential.name}
              align="start"
              label={credential.label}
              hint={
                <>
                  Powers {toolList(credential.usedBy)}.{" "}
                  {credential.source === null ? (
                    <>No key yet, so those tools answer from the built-in fixtures.</>
                  ) : credential.source === "environment" ? (
                    <>Read from the server&apos;s environment.</>
                  ) : stored ? (
                    <>
                      Stored for this workspace, ends in{" "}
                      <span className="font-mono">{stored.last4 ? `…${stored.last4}` : "(short key)"}</span>, set{" "}
                      {formatDate(stored.setAt)}
                      {stored.label ? <> as &ldquo;{stored.label}&rdquo;</> : null}
                      {stored.lastUsedAt ? (
                        <>
                          , last used <RelativeTime iso={stored.lastUsedAt} />
                        </>
                      ) : (
                        <>, not used yet</>
                      )}
                      .
                    </>
                  ) : null}
                </>
              }
            >
              <StatusLine tone={credential.effective === "live" ? "success" : "idle"}>
                {credential.effective === "live" ? "Live" : "Simulated"}
              </StatusLine>
              {canManage ? (
                <CredentialActions
                  name={credential.name}
                  label={credential.label}
                  docsUrl={credential.docsUrl}
                  usedBy={credential.usedBy.map((t) => t.displayName)}
                  stored={stored !== null}
                />
              ) : null}
            </SettingsRow>
          );
        })}
      </SettingsGroup>

      {simulatedMode ? (
        <p className="text-footnote max-w-[62ch] text-pretty text-muted-foreground px-1">
          Tool keys only take effect once a model provider is live. Until then every tool answers from the
          built-in fixtures, so the demo stays deterministic.
        </p>
      ) : null}
    </div>
  );
}
