import type { ReactNode } from "react";

/** Chrome-less shell for signed-out pages: content centred on a quiet, textured backdrop. */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden bg-muted/40 px-4 py-12">
      {/* Faint dot grid that fades out towards the edges, plus a soft glow behind the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_72%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.04] blur-3xl"
      />

      <main className="w-full max-w-sm">{children}</main>

      <footer className="mt-10 text-center text-xs text-muted-foreground">
        Describe the job. Hire the worker. Review the work.
      </footer>
    </div>
  );
}
