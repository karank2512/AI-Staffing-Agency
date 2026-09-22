import type { Metadata } from "next";
import { getSession } from "@/server/auth";
import { FeatureRow } from "./_components/feature-row";
import { FinalCta } from "./_components/final-cta";
import { Hero } from "./_components/hero";
import { HowItWorks } from "./_components/how-it-works";
import { InkBand } from "./_components/ink-band";
import { ApprovalMock, ResumeMock, TimelineMock } from "./_components/mock-cards";
import { PricingTeaser } from "./_components/pricing-teaser";
import { ReviewTiles } from "./_components/review-tiles";
import { Trust } from "./_components/trust";

const DESCRIPTION =
  "Describe a job in plain English. We scope it, design an AI worker for it, and put them on a schedule — with every run narrated, every deliverable reviewed and scored, and a replacement one click away.";

export const metadata: Metadata = {
  // The root template appends "· AI Staffing Agency"; the landing page carries the whole name itself.
  title: { absolute: "AI Staffing Agency — hire AI workers like contractors" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "AI Staffing Agency",
    title: "Describe the job. Meet your new hire.",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "Describe the job. Meet your new hire.", description: DESCRIPTION },
};

export default async function LandingPage() {
  // Read, never redirect: a signed-in visitor should still be able to look at the marketing page.
  const signedIn = (await getSession()) !== null;

  return (
    <>
      <Hero signedIn={signedIn} />
      <HowItWorks />

      <FeatureRow
        id="product"
        tone="white"
        eyebrow="Hiring"
        title="See exactly who you're hiring."
        body="Every worker comes with a résumé: what they'll do on each run, which tools they can use, what they're allowed to do without asking, and what it should cost. No black boxes."
        link={{ href: "#how", label: "How workers are designed" }}
        mock={<ResumeMock />}
      />

      <FeatureRow
        tone="gray"
        title="Every run, told in plain English."
        body="Follow along step by step: what was searched, what was read, what was written. When something goes sideways, you'll know where and why."
        mock={<TimelineMock />}
        mockFirst
      />

      <FeatureRow
        tone="white"
        title="Nothing sensitive happens without you."
        body="Decide which actions need your sign-off. Sending an email, posting an update, touching a customer record: your worker pauses, shows you the draft, and waits."
        mock={<ApprovalMock />}
      />

      <InkBand />
      <ReviewTiles />
      <Trust />
      <PricingTeaser />
      <FinalCta signedIn={signedIn} />
    </>
  );
}
