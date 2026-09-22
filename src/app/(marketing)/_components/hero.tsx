import type { CSSProperties } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DEFAULT_SIGNED_IN_PATH, SIGN_UP_PATH } from "@/server/auth";
import { WorkforceMock } from "./mock-workforce";
import { reveal } from "./section";

/**
 * The one page element allowed a longer entrance: the showcase frame rises 24px over 600ms. Both values are
 * set as local overrides of the reveal tokens, and the global reduced-motion net still flattens them.
 */
const SHOWCASE_MOTION = { "--duration-slow": "600ms", "--reveal-distance": "24px" } as CSSProperties;

export function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="bg-background px-4 pt-[clamp(72px,9vw,120px)] sm:px-6">
      <div className="mx-auto w-full max-w-(--container-marketing) text-center">
        <h1 {...reveal(0)} className="text-display-xl mx-auto max-w-[15ch]">
          Describe the job. Meet your new hire.
        </h1>

        <p {...reveal(1)} className="text-body-lg mx-auto mt-6 max-w-[640px] text-muted-foreground">
          Tell us what needs doing in plain English. We scope the work, design an AI worker for it, and put them
          on a schedule. Every deliverable is reviewed, scored, and yours to keep. If it isn&rsquo;t working, you
          replace them in a click.
        </p>

        <div {...reveal(2)} className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button asChild size="xl" className="w-full sm:w-auto">
            <Link href={signedIn ? DEFAULT_SIGNED_IN_PATH : SIGN_UP_PATH}>
              {signedIn ? "Open workforce" : "Get started"}
            </Link>
          </Button>
          <Button asChild size="xl" variant="secondary" className="w-full sm:w-auto">
            <a href="#how">See how it works</a>
          </Button>
        </div>

        <p {...reveal(3)} className="mt-5 text-[13px] leading-[18px] text-muted-foreground">
          No credit card required.
        </p>
      </div>

      {/* The frame is the same #f5f5f7 as the band below, so the bleed reads as the page opening into it. */}
      <div
        {...reveal(4)}
        style={{ ...reveal(4).style, ...SHOWCASE_MOTION }}
        className="relative z-10 mx-auto mt-16 -mb-14 w-full max-w-(--container-marketing) sm:-mb-20"
      >
        <WorkforceMock />
      </div>
    </section>
  );
}
