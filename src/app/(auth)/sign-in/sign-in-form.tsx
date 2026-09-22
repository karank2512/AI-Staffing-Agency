"use client";

import { useActionState, useState } from "react";
import { ArrowRight, CircleAlert, Eye, EyeOff, Info, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "../actions";
import type { SignInState } from "../schema";

interface SignInFormProps {
  defaultEmail: string;
  defaultPassword: string;
  /** Already sanitized by the page; the action sanitizes it again. */
  callbackUrl: string;
  sessionExpired: boolean;
  /** Error carried in the URL by Auth.js (`?error=`); superseded as soon as the form is submitted. */
  initialError: string | null;
}

export function SignInForm({
  defaultEmail,
  defaultPassword,
  callbackUrl,
  sessionExpired,
  initialError,
}: SignInFormProps) {
  const [state, formAction, isPending] = useActionState<SignInState, FormData>(signInAction, { error: initialError });
  // Controlled inputs: React resets uncontrolled fields after a form action, which would wipe what was typed
  // on a failed attempt. While pending they are readOnly, not disabled — disabled fields are left out of FormData.
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState(defaultPassword);
  const [showPassword, setShowPassword] = useState(false);

  const error = isPending ? null : state.error;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      {sessionExpired && !error ? (
        <Alert>
          <Info aria-hidden />
          <AlertDescription>Your session has ended. Sign in again to pick up where you left off.</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" id="sign-in-error">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="h-10"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={isPending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "sign-in-error" : undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            className="h-10 pr-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            readOnly={isPending}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "sign-in-error" : undefined}
          />
          {/* Positioned by a wrapper so the button keeps its own press animation (it uses translate). */}
          <div className="absolute inset-y-0 right-1.5 flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </div>
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-1 h-10 w-full" disabled={isPending} aria-busy={isPending}>
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden />
            Signing in…
          </>
        ) : (
          <>
            Sign in to demo workspace
            <ArrowRight aria-hidden />
          </>
        )}
      </Button>
    </form>
  );
}
