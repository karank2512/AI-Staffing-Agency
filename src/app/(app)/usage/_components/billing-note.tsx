import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatNumber, formatUsd } from "@/lib/format";

export interface BillingNoteProps {
  marginMultiplier: number;
  /** Amounts from the current window, so the explanation uses real numbers where there are any. */
  costUsd: number;
  billableUsd: number;
  simulatedMode: boolean;
  /** Share of the window's cost that ran on the simulator, or null when there was no spend. */
  simulatedShare: number | null;
}

function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="mx-6 border-b border-border py-4 last:border-0">
      <dt className="text-[15px] font-medium text-foreground">{term}</dt>
      <dd className="mt-0.5 max-w-[62ch] text-[15px] text-pretty text-muted-foreground">{children}</dd>
    </div>
  );
}

/** The two money columns, in plain words. No invoice exists yet, so this explains rather than bills. */
export function BillingNote({ marginMultiplier, costUsd, billableUsd, simulatedMode, simulatedShare }: BillingNoteProps) {
  const exampleCost = costUsd > 0 ? costUsd : 10;
  const exampleBillable = costUsd > 0 ? billableUsd : exampleCost * marginMultiplier;
  const marginPct = Math.round((marginMultiplier - 1) * 100);
  const partlySimulated = simulatedShare !== null && simulatedShare > 0;

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-2">
        <dl>
          <Definition term="Cost">
            What the work costs the platform: model tokens at the provider&apos;s list price, plus a flat fee for
            each call to a tool with a real backend. Your accountant would call it cost of goods sold.
          </Definition>
          <Definition term="Billable">
            What the same work would be charged at — cost ×{" "}
            <span className="metric font-medium text-foreground">{formatNumber(marginMultiplier, 2)}</span>
            {marginPct > 0
              ? `, a ${marginPct}% margin`
              : marginPct < 0
                ? `, a ${Math.abs(marginPct)}% discount`
                : ", no margin"}
            . Nothing is invoiced yet; this is what an invoice would say.
          </Definition>
        </dl>
      </Card>

      <p className="text-footnote max-w-[62ch] text-pretty text-muted-foreground">
        {costUsd > 0 ? "In this window, " : "For example, "}
        <span className="metric text-foreground">{formatUsd(exampleCost)}</span> of cost is{" "}
        <span className="metric text-foreground">{formatUsd(exampleBillable)}</span> billable.{" "}
        {simulatedMode ? (
          <>
            Every call ran on the built-in simulator, priced at what the same call would cost on that tier&apos;s
            reference model. Nothing was charged —{" "}
            <Link href="/settings?section=providers" className="text-link hover:underline">
              add a provider key
            </Link>{" "}
            to see real spend.
          </>
        ) : partlySimulated ? (
          <>
            Part of this window ran on the simulator, priced at each tier&apos;s reference model rather than
            charged by a provider.
          </>
        ) : null}
      </p>
    </div>
  );
}
