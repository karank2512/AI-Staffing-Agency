import { DarkWorkforceMock } from "./mock-dark";
import { INK_BAND_ID, reveal } from "./section";

/** The single dark section on the page. The nav inverts while this band sits under it. */
export function InkBand() {
  return (
    <section
      id={INK_BAND_ID}
      className="bg-ink px-4 pt-(--space-section-marketing) pb-(--space-section-marketing) text-ink-foreground sm:px-6"
    >
      <div className="mx-auto w-full max-w-(--container-marketing)">
        <div className="mx-auto max-w-(--container-text) text-center">
          <h2 {...reveal(0)} className="text-display text-white">
            Your whole team, on one page.
          </h2>
          <p {...reveal(1)} className="text-body-lg mx-auto mt-5 max-w-[640px] text-[#a1a1a6]">
            Who&rsquo;s working, what&rsquo;s waiting on you, and what it&rsquo;s costing, updated as it happens.
          </p>
        </div>

        <div {...reveal(2)} className="mt-14">
          <DarkWorkforceMock />
        </div>
      </div>
    </section>
  );
}
