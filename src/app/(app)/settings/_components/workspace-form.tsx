"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/format";
import { updateOrgSettingsAction } from "../account-actions";

export interface WorkspaceFormProps {
  name: string;
  /** null = no override; the platform default applies. */
  monthlyBudgetUsd: number | null;
  defaultMonthlyBudgetUsd: number;
}

const money = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

/**
 * The owner's two editable settings. One primary pill, and it only wakes up when something actually changed —
 * `updateOrgSettings` ignores a no-op anyway, but a live button that does nothing is a small lie.
 */
export function WorkspaceForm({ name, monthlyBudgetUsd, defaultMonthlyBudgetUsd }: WorkspaceFormProps) {
  const router = useRouter();
  const ids = { name: useId(), budget: useId(), useDefault: useId() };
  const [nextName, setNextName] = useState(name);
  const [useDefault, setUseDefault] = useState(monthlyBudgetUsd === null);
  const [budget, setBudget] = useState(money(monthlyBudgetUsd ?? defaultMonthlyBudgetUsd));
  const [pending, start] = useTransition();

  const parsedBudget = Number(budget);
  const budgetInvalid = !useDefault && (budget.trim() === "" || !Number.isFinite(parsedBudget) || parsedBudget < 0);
  const nameInvalid = nextName.trim().length < 2;
  const nextBudget = useDefault ? null : parsedBudget;
  const dirty = nextName.trim() !== name || nextBudget !== monthlyBudgetUsd;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !dirty || nameInvalid || budgetInvalid) return;
    start(async () => {
      const result = await updateOrgSettingsAction({ name: nextName.trim(), monthlyBudgetUsd: nextBudget });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Workspace updated");
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1 px-1">
        <h3 className="eyebrow">Workspace</h3>
        <p className="text-footnote text-pretty text-muted-foreground">
          The name your team sees, and the hard cap on what your workers may spend in a month.
        </p>
      </div>

      <Card className="gap-0 py-2">
        <form onSubmit={submit} noValidate>
          <div className="mx-6 space-y-2 border-b border-border py-5">
            <Label htmlFor={ids.name}>Name</Label>
            <Input
              id={ids.name}
              value={nextName}
              onChange={(e) => setNextName(e.target.value)}
              maxLength={80}
              required
              disabled={pending}
              aria-invalid={nameInvalid || undefined}
              className="max-w-sm"
            />
            {nameInvalid ? <p className="text-footnote text-danger">Give the workspace a name of at least 2 characters.</p> : null}
          </div>

          <div className="mx-6 space-y-2 border-b border-border py-5">
            <Label htmlFor={ids.budget}>Monthly budget</Label>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="text-[15px] text-muted-foreground">
                $
              </span>
              <Input
                id={ids.budget}
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                value={useDefault ? money(defaultMonthlyBudgetUsd) : budget}
                onChange={(e) => setBudget(e.target.value)}
                disabled={pending || useDefault}
                aria-invalid={budgetInvalid || undefined}
                className="metric max-w-40"
              />
            </div>
            <div className="flex items-center gap-2.5 pt-1">
              <Checkbox
                id={ids.useDefault}
                checked={useDefault}
                disabled={pending}
                onCheckedChange={(checked) => setUseDefault(checked === true)}
              />
              <Label htmlFor={ids.useDefault} className="font-normal text-muted-foreground">
                Use the platform default of {formatUsd(defaultMonthlyBudgetUsd)}
              </Label>
            </div>
            <p className="text-footnote text-pretty text-muted-foreground">
              Real provider spend only. When the month&apos;s total reaches this, new runs are refused until you
              raise it.
            </p>
            {budgetInvalid ? <p className="text-footnote text-danger">Enter an amount of $0 or more.</p> : null}
          </div>

          <div className="mx-6 flex items-center gap-4 py-4">
            <Button type="submit" disabled={pending || !dirty || nameInvalid || budgetInvalid}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {pending ? "Saving…" : "Save changes"}
            </Button>
            {dirty && !pending ? <span className="text-footnote text-muted-foreground">Unsaved changes</span> : null}
          </div>
        </form>
      </Card>
    </section>
  );
}
