import { CopyButton } from "@/components/copy-button";
import { formatDuration, pluralize } from "@/lib/format";
import type { SettingsExecutor } from "@/server/queries/settings";
import { Mono, SettingsGroup, SettingsRow, SettingsValue, StatusLine } from "./settings-list";

const SEED_COMMAND = "npm run db:seed";

export interface RuntimeSectionProps {
  /** Executor tuning is platform-operator config: null for anyone below OWNER (audit INF-19). */
  executor: SettingsExecutor | null;
  /** Hide the re-seed instructions where there is no demo data to re-seed. */
  showDemoData: boolean;
}

/** The background loop that picks queued runs up, and the one command that puts the demo back how it was. */
export function RuntimeSection({ executor, showDemoData }: RuntimeSectionProps) {
  return (
    <div className="space-y-10">
      {executor ? (
        <SettingsGroup
          title="Background worker"
          description="The loop that picks up queued runs and fires scheduled ones."
          footer={
            <>
              Tune with <Mono>EXECUTOR_POLL_MS</Mono>, <Mono>EXECUTOR_CONCURRENCY</Mono>,{" "}
              <Mono>SCHEDULER_TICK_MS</Mono> and <Mono>EXECUTOR_STALE_LOCK_MS</Mono>; set{" "}
              <Mono>EXECUTOR_DISABLED=true</Mono> to pause it.
            </>
          }
        >
          <SettingsRow
            label={executor.enabled ? "Picking up work" : "Paused"}
            hint={
              executor.enabled
                ? "Queued runs start on their own, and schedules fire on time."
                : "Runs queue up but nothing claims them until the worker is switched back on."
            }
          >
            <StatusLine tone={executor.enabled ? "success" : "attention"}>
              {executor.enabled ? "Running" : "Disabled"}
            </StatusLine>
          </SettingsRow>
          <SettingsRow label="Checks for work">
            <SettingsValue className="metric">every {formatDuration(executor.pollMs)}</SettingsValue>
          </SettingsRow>
          <SettingsRow label="Runs at once">
            <SettingsValue className="metric">{pluralize(executor.concurrency, "run")}</SettingsValue>
          </SettingsRow>
          <SettingsRow label="Scheduler tick">
            <SettingsValue className="metric">every {formatDuration(executor.schedulerTickMs)}</SettingsValue>
          </SettingsRow>
          <SettingsRow label="Recovers a stuck run" hint="A run whose worker died is handed back to the queue.">
            <SettingsValue className="metric">
              after {formatDuration(executor.staleLockMs)} of silence
            </SettingsValue>
          </SettingsRow>
        </SettingsGroup>
      ) : (
        <p className="text-footnote max-w-[62ch] text-pretty text-muted-foreground px-1">
          The background worker is tuned on the server by your workspace owner.
        </p>
      )}

      {showDemoData ? (
        <SettingsGroup
          title="Demo data"
          description="Three workers with three weeks of history, ready to hire, review and replace."
          footer="Runs, deliverables, evaluations and usage created since the last seed are removed, and so are tool keys set here. The ids stay the same, so you stay signed in."
        >
          <SettingsRow label="Put the demo workspace back" hint="Run this from a terminal in the project folder.">
            <span className="flex items-center gap-2 rounded-lg bg-muted py-1.5 pr-1.5 pl-3">
              <span className="font-mono text-[13px]">{SEED_COMMAND}</span>
              <CopyButton value={SEED_COMMAND} />
            </span>
          </SettingsRow>
        </SettingsGroup>
      ) : null}
    </div>
  );
}
