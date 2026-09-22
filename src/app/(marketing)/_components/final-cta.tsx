import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DEFAULT_SIGNED_IN_PATH, SIGN_IN_PATH, SIGN_UP_PATH } from "@/server/auth";
import { MarketingSection, reveal } from "./section";

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <MarketingSection tone="white" innerClassName="text-center">
      <h2 {...reveal(0)} className="text-display mx-auto max-w-[18ch]">
        Your next hire is a paragraph away.
      </h2>

      <div {...reveal(1)} className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
        {signedIn ? (
          <Button asChild size="xl" className="w-full sm:w-auto">
            <Link href={DEFAULT_SIGNED_IN_PATH}>Open workforce</Link>
          </Button>
        ) : (
          <>
            <Button asChild size="xl" className="w-full sm:w-auto">
              <Link href={SIGN_UP_PATH}>Get started</Link>
            </Button>
            <Button asChild size="xl" variant="secondary" className="w-full sm:w-auto">
              <Link href={SIGN_IN_PATH}>Sign in</Link>
            </Button>
          </>
        )}
      </div>
    </MarketingSection>
  );
}
