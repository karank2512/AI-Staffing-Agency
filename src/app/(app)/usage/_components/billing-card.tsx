import Link from "next/link";
import { FlaskConical, Receipt } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatUsd } from "@/lib/format";

export interface BillingCardProps {
  marginMultiplier: number;
  /** Example amounts from the current window make the explanation concrete; zero when there is no usage yet. */
  costUsd: number;
  billableUsd: number;
  simulatedMode: boolean;
  simulatedShare: number | null;
}

/** Plain-language explanation of the two money columns, with the live margin from config. */
export function BillingCard({ marginMultiplier, costUsd, billableUsd, simulatedMode, simulatedShare }: BillingCardProps) {
  const exampleCost = costUsd > 0 ? costUsd : 10;
  const exampleBillable = costUsd > 0 ? billableUsd : exampleCost * marginMultiplier;
  const marginPct = Math.round((marginMultiplier - 1) * 100);
  const showSimulatedNote = simulatedMode || (simulatedShare !== null && simulatedShare > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" aria-hidden="true" />
          How billing works
        </CardTitle>
        <CardDescription>Two numbers appear everywhere on this page. Here is what each one means.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3">
            <dt className="font-medium">Cost</dt>
            <dd className="mt-0.5 text-pretty text-muted-foreground">
              What the work actually costs the platform: model tokens at the provider&apos;s list price plus a flat per-call fee for
              tools with a real backend. Also called COGS.
            </dd>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <dt className="font-medium">Billable</dt>
            <dd className="mt-0.5 text-pretty text-muted-foreground">
              What a customer would be charged for the same work: cost × <span className="metric font-medium text-foreground">{formatNumber(marginMultiplier, 2)}</span>
              {marginPct > 0 ? ` (a ${marginPct}% margin)` : marginPct < 0 ? ` (a ${Math.abs(marginPct)}% discount)` : " (no margin)"}. Set with{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">USAGE_MARGIN_MULTIPLIER</code>.
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          {costUsd > 0 ? "In this window: " : "For example: "}
          <span className="metric font-medium text-foreground">{formatUsd(exampleCost)}</span> of cost becomes{" "}
          <span className="metric font-medium text-foreground">{formatUsd(exampleBillable)}</span> billable.
        </p>

        {showSimulatedNote ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-900">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-pretty">
              <span className="font-medium">Simulated-mode costs are reference prices, not spend.</span>{" "}
              {simulatedMode
                ? "No model API key is configured, so every call runs on the built-in simulator and is priced at what the same call would cost on each tier's reference model. Nothing was actually charged."
                : "Part of this window ran on the built-in simulator, priced at each tier's reference model rather than charged by a provider."}{" "}
              <Link href="/settings" className="font-medium underline underline-offset-2">
                Add keys in Settings
              </Link>{" "}
              to see real spend.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
