"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthField, ShowToggle } from "../_components/field";
import { FormAlert, SubmitButton } from "../_components/form-ui";
import { signInAction } from "../actions";
import type { SignInState } from "../schema";

export interface DemoCredentials {
  email: string;
  password: string;
  organizationName: string;
}

interface SignInFormProps {
  /** Already sanitized by the page; the action sanitizes it again. */
  callbackUrl: string;
  sessionExpired: boolean;
  /** Error carried in the URL by Auth.js (`?error=`); superseded as soon as the form is submitted. */
  initialError: string | null;
  /**
   * Only set when the deployment opted in (DEMO_MODE). Nothing is pre-filled: the shared account is offered
   * as a deliberate second action, so a real deployment's form never hints that one exists.
   */
  demo: DemoCredentials | null;
}

export function SignInForm({ callbackUrl, sessionExpired, initialError, demo }: SignInFormProps) {
  const [state, formAction, isPending] = useActionState<SignInState, FormData>(signInAction, { error: initialError });
  // Controlled inputs: React resets uncontrolled fields after a form action, which would wipe what was typed
  // on a failed attempt. While pending they are readOnly, not disabled — disabled fields are left out of FormData.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  // Filling the demo credentials and submitting are two React updates; the effect runs once the inputs
  // actually hold the new values, so the submitted FormData is never a frame behind.
  useEffect(() => {
    if (!autoSubmit) return;
    setAutoSubmit(false);
    form.current?.requestSubmit();
  }, [autoSubmit]);

  const error = isPending ? null : state.error;

  return (
    <form ref={form} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      {error ? (
        <FormAlert id="sign-in-error">{error}</FormAlert>
      ) : sessionExpired ? (
        <FormAlert tone="info">Your session ended. Sign in again to continue.</FormAlert>
      ) : null}

      <AuthField
        name="email"
        label="Email"
        type="email"
        value={email}
        onValueChange={setEmail}
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        readOnly={isPending}
        invalid={Boolean(error)}
        describedBy={error ? "sign-in-error" : undefined}
      />

      <AuthField
        name="password"
        label="Password"
        type={showPassword ? "text" : "password"}
        value={password}
        onValueChange={setPassword}
        autoComplete="current-password"
        required
        readOnly={isPending}
        invalid={Boolean(error)}
        describedBy={error ? "sign-in-error" : undefined}
        trailing={<ShowToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />}
      />

      <div className="mt-2">
        <SubmitButton pending={isPending} label="Sign in" pendingLabel="Signing in…" />
      </div>

      {demo ? (
        <div className="mt-2 flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={isPending}
            onClick={() => {
              setEmail(demo.email);
              setPassword(demo.password);
              setAutoSubmit(true);
            }}
          >
            Explore the demo workspace
          </Button>
          <p className="text-center text-[13px] leading-[18px] text-muted-foreground">
            Signs you into {demo.organizationName}, a shared read-and-write demo.
          </p>
        </div>
      ) : null}
    </form>
  );
}
