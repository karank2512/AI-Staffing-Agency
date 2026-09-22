"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Under `md` the sidebar lives in a left Sheet. `children` is the same sidebar body the desktop rail renders. */
export function MobileNav({ children, pendingApprovals }: { children: ReactNode; pendingApprovals: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigation (including redirects after an action) always closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative -ml-1.5" aria-label="Open navigation">
          <Menu className="size-5" aria-hidden="true" />
          {pendingApprovals > 0 ? (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-background" aria-hidden="true" />
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-64 gap-0 bg-sidebar p-0 sm:max-w-64">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Main navigation, workspace and account menu</SheetDescription>
        {/* Tapping the link for the page you are already on changes no pathname — close on any link click too. */}
        <div
          className="flex min-h-0 flex-1 flex-col"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
          }}
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
