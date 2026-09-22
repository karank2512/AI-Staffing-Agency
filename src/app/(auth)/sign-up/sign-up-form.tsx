"use client";

import { useActionState, useState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordField } from "../_components/password-field";
import { signUpAction } from "../actions";
import { FIELD_LIMITS, type SignUpState } from "../schema";

interface SignUpFormProps {
  /** SIGNUP_MODE=invite: the shared code the operator handed out. */
  inviteCodeRequired: boolean;
  passwordMinLength: number;
}

/**
 * Creates the workspace and its first owner, then signs in (the action redirects, so a success never
 * comes back as state). Inputs are controlled: React resets uncontrolled fields after a form action,
 * which would wipe everything typed on a failed attempt.
 */
export function SignUpForm({ inviteCodeRequired, passwordMinLength }: SignUpFormProps) {
  const [state, formAction, isPending] = useActionState<SignUpState, FormData>(signUpAction, { error: null });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");

  const error = isPending ? null : state.error;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {error ? (
        <Alert variant="destructive" id="sign-up-error">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={FIELD_LIMITS.name}
          className="h-10"
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={FIELD_LIMITS.email}
          className="h-10"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="organizationName">Workspace name</Label>
        <Input
          id="organizationName"
          name="organizationName"
          autoComplete="organization"
          required
          maxLength={FIELD_LIMITS.organizationName}
          className="h-10"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          readOnly={isPending}
        />
        <p className="text-xs text-muted-foreground">Your company or team — you can rename it later.</p>
      </div>

      <PasswordField
        value={password}
        onChange={setPassword}
        minLength={passwordMinLength}
        context={{ email, name, organizationName }}
        readOnly={isPending}
      />

      {inviteCodeRequired ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="inviteCode">Invite code</Label>
          <Input
            id="inviteCode"
            name="inviteCode"
            required
            maxLength={FIELD_LIMITS.inviteCode}
            autoComplete="off"
            spellCheck={false}
            className="h-10"
            readOnly={isPending}
          />
          <p className="text-xs text-muted-foreground">Sign-up is invite-only right now. Ask whoever sent you here.</p>
        </div>
      ) : null}

      <Button type="submit" size="lg" className="mt-1 h-10 w-full" disabled={isPending} aria-busy={isPending}>
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden />
            Creating your workspace…
          </>
        ) : (
          <>
            Create workspace
            <ArrowRight aria-hidden />
          </>
        )}
      </Button>
    </form>
  );
}
