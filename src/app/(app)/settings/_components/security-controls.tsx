"use client";

import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/(auth)/actions";
import { changePasswordAction, signOutEverywhereAction } from "../account-actions";

/**
 * The password rules live on the server (`checkPasswordPolicy`) and are the only ones that decide anything.
 * These are a readable mirror of them, so the checklist can tick as you type — the breach-list lookup is the
 * one rule that can't run in the browser, and the footnote says so.
 */

const KEYBOARD_ROWS = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];

function isRepeatedUnit(value: string): boolean {
  for (let unit = 1; unit <= 3; unit++) {
    if (value.length % unit !== 0 || value.length / unit < 3) continue;
    if (value === value.slice(0, unit).repeat(value.length / unit)) return true;
  }
  return false;
}

function isSequentialRun(value: string): boolean {
  if (value.length < 4) return false;
  const step = value.charCodeAt(1) - value.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < value.length; i++) {
    let expected = value.charCodeAt(i - 1) + step;
    if (expected === 58) expected = 48;
    if (expected === 47) expected = 57;
    if (value.charCodeAt(i) !== expected) return false;
  }
  return true;
}

function isKeyboardRun(value: string): boolean {
  if (value.length < 6) return false;
  const reversed = [...value].reverse().join("");
  return KEYBOARD_ROWS.some((row) => row.includes(value) || row.includes(reversed));
}

function echoesIdentity(password: string, parts: string[]): boolean {
  const haystack = password.toLowerCase();
  return parts.some((part) => part.length >= 4 && haystack.includes(part));
}

function Requirement({ met, children }: { met: boolean; children: string }) {
  return (
    <li className={cn("flex items-start gap-2 text-footnote", met ? "text-success" : "text-muted-foreground")}>
      {met ? (
        <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <span className="mt-[5px] size-2 shrink-0 rounded-full border border-current opacity-60" aria-hidden="true" />
      )}
      <span>{children}</span>
    </li>
  );
}

export interface PasswordFormProps {
  minLength: number;
  name: string;
  email: string;
  organizationName: string;
}

export function PasswordForm({ minLength, name, email, organizationName }: PasswordFormProps) {
  const ids = { current: useId(), next: useId(), list: useId() };
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [pending, start] = useTransition();

  const identity = useMemo(() => {
    const local = email.split("@")[0] ?? "";
    const domain = email.split("@")[1]?.split(".")[0] ?? "";
    return [email, local, domain, name, ...name.split(/\s+/), organizationName, ...organizationName.split(/\s+/)]
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length >= 4);
  }, [email, name, organizationName]);

  const lower = next.toLowerCase();
  const checks = [
    { label: `At least ${minLength} characters`, met: [...next].length >= minLength },
    { label: "A mix of at least 5 different characters", met: new Set(next).size >= 5 },
    {
      label: "No repeats, counting runs or keyboard runs",
      met: next.length > 0 && !isRepeatedUnit(lower) && !isSequentialRun(lower) && !isKeyboardRun(lower),
    },
    { label: "Nothing from your name, email or workspace name", met: next.length > 0 && !echoesIdentity(next, identity) },
  ];
  const ready = current.length > 0 && checks.every((c) => c.met);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !ready) return;
    start(async () => {
      const result = await changePasswordAction({ currentPassword: current, newPassword: next });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCurrent("");
      setNext("");
      toast.success("Password changed", { description: "Sign in again with your new password." });
      await signOutAction();
    });
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1 px-1">
        <h3 className="eyebrow">Password</h3>
        <p className="text-footnote text-pretty text-muted-foreground">
          Changing it signs you out everywhere, including here.
        </p>
      </div>

      <Card className="gap-0 py-2">
        <form onSubmit={submit} className="mx-6 space-y-5 py-5" autoComplete="off">
          <div className="max-w-sm space-y-2">
            <Label htmlFor={ids.current}>Current password</Label>
            <Input
              id={ids.current}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={pending}
              required
            />
          </div>

          <div className="max-w-sm space-y-2">
            <Label htmlFor={ids.next}>New password</Label>
            <div className="relative">
              <Input
                id={ids.next}
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={pending}
                aria-describedby={ids.list}
                required
                className="pr-16"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute inset-y-0 right-3.5 my-auto h-6 rounded-sm text-footnote font-medium text-link outline-none hover:underline"
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <ul id={ids.list} className="space-y-1.5">
            {checks.map((check) => (
              <Requirement key={check.label} met={check.met}>
                {check.label}
              </Requirement>
            ))}
          </ul>
          <p className="text-footnote text-pretty text-muted-foreground">
            We also check it against public breach lists when you save.
          </p>

          <Button type="submit" disabled={pending || !ready} className="max-sm:w-full">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {pending ? "Changing…" : "Change password"}
          </Button>
        </form>
      </Card>
    </section>
  );
}

/** Revokes every session, then drops this one too so the page doesn't sit on a dead cookie. */
export function SignOutEverywhere() {
  return (
    <ConfirmDialog
      trigger={<Button variant="secondary">Sign out everywhere</Button>}
      title="Sign out of every device?"
      description="Every session ends immediately, including this one. You'll need to sign in again."
      confirmLabel="Sign out everywhere"
      destructive
      onConfirm={async () => {
        const result = await signOutEverywhereAction();
        if (!result.ok) throw new Error(result.error);
        await signOutAction();
      }}
    />
  );
}
