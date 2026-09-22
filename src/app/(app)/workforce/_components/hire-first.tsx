import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Concrete briefs, in the words a manager would actually use. They deep-link into the hire flow. */
const EXAMPLES = [
  {
    label: "Weekly competitor digest",
    brief:
      "Every Monday, summarize what our three main competitors shipped last week and email it to the product team.",
  },
  {
    label: "Support inbox triage",
    brief:
      "Every morning, read yesterday's support emails, group them into themes with counts, and quote one example each.",
  },
  {
    label: "Friday lead list",
    brief:
      "Each Friday, build a list of 20 Series A fintech companies hiring revenue operations, with one line on why each fits.",
  },
];

/**
 * What a brand-new workspace sees instead of a roster: one sentence about the job to be done, one pill, and
 * three briefs to borrow. No dashed box, no illustration.
 */
export function HireFirst({ canHire }: { canHire: boolean }) {
  return (
    <section className="flex flex-col items-center px-4 py-16 text-center sm:py-24">
      <h2 className="text-headline max-w-[16ch] text-balance text-foreground">Hire your first AI worker</h2>
      <p className="text-body mt-5 max-w-[52ch] text-pretty text-muted-foreground">
        Describe a job the way you&apos;d brief a new contractor — the outcome, how often, and who it&apos;s for. We
        scope it, design a worker for it, and put them on the schedule.
      </p>

      {canHire ? (
        <>
          <Button size="lg" className="mt-9" asChild>
            <Link href="/hire">Hire a worker</Link>
          </Button>
          <p className="text-footnote mt-12 text-muted-foreground">Or start from one of these</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {EXAMPLES.map((example) => (
              <Button key={example.label} variant="secondary" asChild>
                <Link href={`/hire?prefill=${encodeURIComponent(example.brief)}`}>{example.label}</Link>
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-footnote mt-9 text-muted-foreground">
          Ask a workspace admin to make the first hire — you&apos;ll see everything they do here.
        </p>
      )}
    </section>
  );
}
