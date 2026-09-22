import Link from "next/link";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatNumber, formatUsd, pluralize } from "@/lib/format";
import type { OrgSettingsView } from "@/server/account";
import { settingsHref } from "../sections";
import { Callout, SettingsGroup, SettingsRow, SettingsValue } from "./settings-list";
import { WorkspaceForm } from "./workspace-form";

export interface WorkspaceSectionProps {
  org: OrgSettingsView;
  /** OWNER (`org.manage`) — everyone else reads the same numbers without the inputs. */
  canManage: boolean;
  /** No model provider has a key, so nothing in this window was really charged. */
  simulated: boolean;
}

/** Month label and reset date from the budget's UTC "YYYY-MM" key, rendered in the reader's local calendar. */
function monthParts(key: string): { label: string; resets: string } {
  const [y, m] = key.split("-").map(Number);
  const first = new Date(y ?? 1970, (m ?? 1) - 1, 1);
  const next = new Date(y ?? 1970, m ?? 1, 1);
  return { label: format(first, "MMMM"), resets: formatDate(next) };
}

/** Workspace identity and the one number that can stop the workforce: this month's real provider spend. */
export function WorkspaceSection({ org, canManage, simulated }: WorkspaceSectionProps) {
  const { budget } = org;
  const { label: month, resets } = monthParts(budget.month);
  const used = budget.budgetUsd > 0 ? Math.min(100, Math.round((budget.spentUsd / budget.budgetUsd) * 100)) : 0;
  const usingDefault = org.monthlyBudgetUsd === null;

  return (
    <div className="space-y-10">
      {canManage ? (
        <WorkspaceForm
          name={org.name}
          monthlyBudgetUsd={org.monthlyBudgetUsd}
          defaultMonthlyBudgetUsd={org.defaultMonthlyBudgetUsd}
        />
      ) : (
        <SettingsGroup
          title="Workspace"
          footer="Only the workspace owner can rename the workspace or change the budget."
        >
          <SettingsRow label="Name">
            <SettingsValue>{org.name}</SettingsValue>
          </SettingsRow>
          <SettingsRow label="Monthly budget" hint={usingDefault ? "Using the platform default" : undefined}>
            <SettingsValue className="metric">{formatUsd(budget.budgetUsd)}</SettingsValue>
          </SettingsRow>
        </SettingsGroup>
      )}

      <section className="space-y-3">
        <div className="space-y-1 px-1">
          <h3 className="eyebrow">Spend in {month}</h3>
          <p className="text-footnote text-pretty text-muted-foreground">
            Only real provider spend counts against the cap. Workers stop when it is reached.
          </p>
        </div>
        <Card className="gap-0 px-(--card-spacing)">
          <div className="space-y-4">
            <div>
              <p className="text-metric text-foreground">{formatUsd(budget.spentUsd)}</p>
              <p className="text-footnote mt-1 text-muted-foreground">
                of <span className="metric">{formatUsd(budget.budgetUsd)}</span>
                {budget.exceeded ? " · nothing left" : ` · ${formatUsd(budget.remainingUsd)} left`} · resets {resets}
              </p>
            </div>
            <Progress
              value={used}
              aria-label={`${used}% of the monthly budget used`}
              className={budget.exceeded ? "[&_[data-slot=progress-indicator]]:bg-danger" : undefined}
            />
            {budget.exceeded ? (
              <Callout tone="failure">
                The cap for {month} is spent, so runs are refused until you raise it or the month rolls over.
              </Callout>
            ) : simulated ? (
              <p className="text-footnote text-pretty text-muted-foreground">
                Every model call is running on the built-in simulator right now, so real spend stays at $0.00.
                The prices on <Link href="/usage" className="text-link hover:underline">Usage</Link> are what the
                same work would cost.
              </p>
            ) : null}
          </div>
        </Card>
      </section>

      <SettingsGroup title="About this workspace">
        <SettingsRow label="Created">
          <SettingsValue>{formatDate(org.createdAt)}</SettingsValue>
        </SettingsRow>
        <SettingsRow label="Address" hint="Where this workspace lives in URLs and invite links.">
          <SettingsValue className="font-mono text-[13px]">{org.slug}</SettingsValue>
        </SettingsRow>
        <SettingsRow label="People">
          <Link href={settingsHref("members")} className="text-[15px] text-link hover:underline">
            {pluralize(org.memberCount, "member")} ›
          </Link>
        </SettingsRow>
        <SettingsRow
          label="Limits"
          hint={`Up to ${formatNumber(org.limits.maxActiveWorkers, 0)} workers on the payroll, ${formatNumber(org.limits.maxConcurrentRuns, 0)} running at a time and ${formatNumber(org.limits.maxQueuedRuns, 0)} waiting in line.`}
        />
        {org.isDemo ? (
          <SettingsRow
            label="Demo workspace"
            hint="Seeded with three workers and three weeks of history. Anything you change here can be re-seeded."
          />
        ) : null}
      </SettingsGroup>

      {org.suspended ? (
        <Callout tone="failure">
          This workspace is suspended, so no run will start. Contact your platform operator to lift it.
        </Callout>
      ) : null}
    </div>
  );
}
