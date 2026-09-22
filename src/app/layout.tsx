import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "AI Staffing Agency", template: "%s · AI Staffing Agency" },
  description:
    "The staffing agency for AI workers. Describe a job, hire an AI worker, review its deliverables and performance — and replace it like a contractor when it underperforms.",
  applicationName: "AI Staffing Agency",
};

export const viewport: Viewport = {
  themeColor: "#fbfcfd",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Font variables live on <html> so `font-sans` / `font-mono` resolve everywhere, including portals.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        {/* theme is pinned: the shadcn wrapper defaults to "system", which would render dark toasts on dark-mode OSes. */}
        <Toaster position="top-right" richColors closeButton theme="light" />
      </body>
    </html>
  );
}
