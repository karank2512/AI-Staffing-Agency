"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronsUpDown, Loader2, LogOut, Settings } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/lib/initials";

export interface ShellUser {
  name: string;
  email: string;
  organizationName: string;
}

/** Sidebar footer: organization + signed-in user, with Settings and Sign out. */
export function UserMenu({ user }: { user: ShellUser }) {
  const [signingOut, startSignOut] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 data-[state=open]:bg-sidebar-accent"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-800 text-[11px] font-semibold tracking-tight text-white"
          >
            {initialsOf(user.organizationName)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold text-foreground">{user.organizationName}</span>
            <span className="truncate text-xs text-muted-foreground">{user.name}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="min-w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="text-xs text-muted-foreground">Signed in as</span>
          <span className="truncate text-[13px] font-medium text-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(event) => {
            // Keep the menu open while the server action runs so the spinner is visible; the action redirects.
            event.preventDefault();
            startSignOut(async () => {
              await signOutAction();
            });
          }}
        >
          {signingOut ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
