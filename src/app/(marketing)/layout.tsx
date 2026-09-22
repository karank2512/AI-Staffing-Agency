import type { ReactNode } from "react";
import type { Viewport } from "next";
import { getSession } from "@/server/auth";
import { llm } from "@/server/models";
import { MarketingNav } from "./_components/marketing-nav";
import { ScrollReveal } from "./_components/reveal";
import { SiteFooter } from "./_components/site-footer";

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

/**
 * The public shell: frosted bar, content, footer. The session is read but never acted on — the landing page
 * stays viewable when you are signed in, it just swaps its calls to action for a way back into the app.
 */
export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <MarketingNav signedIn={session !== null} />

      <main id="main" className="flex-1">
        {children}
      </main>

      <SiteFooter simulated={llm.isSimulated()} />
      <ScrollReveal />
    </div>
  );
}
