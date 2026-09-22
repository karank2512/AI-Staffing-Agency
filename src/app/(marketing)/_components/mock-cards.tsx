import { WorkerAvatar } from "@/components/worker-avatar";
import { cn } from "@/lib/utils";

/**
 * The three big feature mocks: a worker's résumé before you hire them, a narrated run, and an approval
 * waiting on a person. Each is a `role="img"` frame, so nothing inside is focusable or announced twice.
 */

const SKILLS = ["Competitor tracking", "Source triage", "Executive summaries", "Change detection"];

const TOOLS: [string, "allowed" | "asks"][] = [
  ["Searches the public web", "allowed"],
  ["Reads pages you point her at", "allowed"],
  ["Writes the digest as a document", "allowed"],
  ["Asks before emailing anyone", "asks"],
];

export function ResumeMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A candidate résumé card for Maya, a market research analyst: four skills, four tools — three allowed outright and emailing set to ask first — and an expected cost of about four cents per run."
      className={cn("rounded-2xl bg-card p-7 shadow-card sm:p-8", className)}
    >
      <div className="flex items-start gap-4">
        <WorkerAvatar name="Maya Okonkwo" color="sky" size="xl" />
        <div className="min-w-0 pt-1">
          <p className="text-[28px] leading-8 font-semibold tracking-[-0.02em]">Maya</p>
          <p className="mt-1 text-[17px] leading-6 text-muted-foreground">Market research analyst</p>
        </div>
      </div>

      <p className="mt-5 text-[17px] leading-[25px] text-foreground">
        Every Monday morning Maya reads what your three main competitors shipped last week, sorts signal from
        noise, and writes a one-page digest for the product team.
      </p>

      <div className="mt-6 border-t border-border pt-5">
        <p className="text-[13px] leading-[18px] font-semibold text-muted-foreground">Skills</p>
        <p className="mt-1.5 text-[15px] leading-[22px]">{SKILLS.join(" · ")}</p>
      </div>

      <div className="mt-5 border-t border-border pt-5">
        <p className="text-[13px] leading-[18px] font-semibold text-muted-foreground">Tools &amp; access</p>
        <ul className="mt-2 space-y-2">
          {TOOLS.map(([label, mode]) => (
            <li key={label} className="flex items-center justify-between gap-4 text-[15px] leading-5">
              <span className="min-w-0 truncate">{label}</span>
              <span
                className={cn(
                  "shrink-0 text-[13px]",
                  mode === "asks" ? "text-warning font-medium" : "text-muted-foreground",
                )}
              >
                {mode === "asks" ? "Asks first" : "Allowed"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4 border-t border-border pt-5">
        <div>
          <p className="text-[13px] leading-[18px] font-semibold text-muted-foreground">Expected cost</p>
          <p className="mt-1 text-[34px] leading-10 font-semibold tracking-[-0.02em] tabular-nums">$0.04</p>
          <p className="text-[13px] leading-[18px] text-muted-foreground">per run, estimated</p>
        </div>
        <span className="inline-flex h-11 items-center rounded-full bg-primary px-5.5 text-[17px] font-medium text-primary-foreground">
          Hire Maya
        </span>
      </div>
    </div>
  );
}

interface Step {
  tone: "success" | "info";
  text: string;
  meta: string;
  detail?: string[];
}

const STEPS: Step[] = [
  { tone: "success", text: "Maya read the brief and planned five checks.", meta: "0.8s" },
  { tone: "success", text: "Maya searched the web for “Northwind changelog May”.", meta: "2.1s · 9 results" },
  {
    tone: "success",
    text: "Maya read 3 release notes and kept 2.",
    meta: "4.6s · 3 pages",
    detail: [
      "Kept — Northwind 4.2 release notes (May 14): usage-based billing, SSO for all plans.",
      "Kept — Harborline changelog (May 12): audit export, 2 bug fixes.",
      "Dropped — Vantage blog (May 9): no product changes, marketing post.",
    ],
  },
  { tone: "success", text: "Maya drafted the weekly competitor digest.", meta: "6.2s · 1,240 words" },
  { tone: "info", text: "Maya is waiting for your OK to email the product team.", meta: "waiting" },
];

const NODE = {
  success: "bg-success",
  info: "bg-info",
} as const;

export function TimelineMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="A run timeline told in sentences: Maya planned five checks, searched the web for a competitor changelog, read three release notes and kept two — with that step expanded to show which pages were kept and dropped — drafted the digest, and is now waiting for permission to email the product team."
      className={cn("rounded-2xl bg-card p-6 shadow-card sm:p-7", className)}
    >
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-title-3">Monday digest run</p>
        <p className="text-[13px] text-muted-foreground tabular-nums">2m 14s</p>
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <span className="size-[7px] rounded-full bg-info" />
        <span>Working, step 5 of ~7 · $0.03 · Simulated</span>
      </p>

      <ol className="relative mt-6">
        <span aria-hidden className="absolute top-2 bottom-6 left-[4px] w-px bg-border" />
        {STEPS.map((step) => (
          <li key={step.text} className="relative pl-7 pb-5 last:pb-0">
            <span className={cn("absolute top-1.5 left-0 size-[9px] rounded-full", NODE[step.tone])} />
            <div className="flex items-start justify-between gap-4">
              <p className="text-[15px] leading-[22px]">{step.text}</p>
              <p className="shrink-0 pt-0.5 text-[13px] text-muted-foreground tabular-nums">{step.meta}</p>
            </div>
            {step.detail ? (
              <div className="mt-3 rounded-lg bg-muted p-4">
                {step.detail.map((line) => (
                  <p key={line} className="text-[13px] leading-[19px] text-muted-foreground first:mt-0 mt-1.5">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ApprovalMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="An approval card: Theo wants to reply to three customers, requested twelve minutes ago, with a preview of the recipients and the opening line, and Approve and Decline buttons."
      className={cn("rounded-2xl bg-card p-6 shadow-card-hover sm:p-7", className)}
    >
      <div className="flex items-start gap-3.5">
        <WorkerAvatar name="Theo Brandt" color="emerald" size="md" />
        <div className="min-w-0">
          <p className="text-[17px] leading-6 font-semibold">Theo wants to reply to 3 customers</p>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
            Requested 12 min ago · Support inbox triage
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-muted p-4">
        <p className="text-[13px] leading-[18px] text-muted-foreground">To</p>
        <p className="mt-0.5 truncate text-[15px] leading-5">rosa@fernwood.co, ian@blaketools.com, jm@pellecraft.io</p>
        <p className="mt-3 text-[13px] leading-[18px] text-muted-foreground">Subject</p>
        <p className="mt-0.5 truncate text-[15px] leading-5">Re: shipping delay on order #4471</p>
        <p className="mt-3 text-[15px] leading-[22px]">
          “Thanks for flagging this — your order left our Rotterdam warehouse on Tuesday and…”
        </p>
        <p className="mt-3 text-[13px] font-medium text-link">Show full ›</p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <span className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[14px] font-medium text-primary-foreground">
          Approve
        </span>
        <span className="inline-flex h-9 items-center rounded-full bg-secondary px-4 text-[14px] font-medium">
          Decline
        </span>
      </div>
    </div>
  );
}
