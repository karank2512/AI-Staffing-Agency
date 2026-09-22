"use client";

import { useActionState, useState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordField } from "../../_components/password-field";
import { acceptInviteAction } from "../../actions";
import { FIELD_LIMITS, type AcceptInviteState } from "../../schema";

interface AcceptInviteFormProps {
  token: string;
  /** Fixed by the invitation — shown, never editable. */
  email: string;
  organizationName: string;
  passwordMinLength: number;
}

export function AcceptInviteForm({ token, email, organizationName, passwordMinLength }: AcceptInviteFormProps) {
  const [state, formAction, isPending] = useActionState<AcceptInviteState, FormData>(acceptInviteAction, {
    error: null,
  });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const error = isPending ? null : state.error;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />

      {error ? (
        <Alert variant="destructive" id="accept-invite-error">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="invited-email">Email</Label>
        <Input id="invited-email" value={email} readOnly disabled className="h-10" autoComplete="username" />
      </div>

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

      <PasswordField
        value={password}
        onChange={setPassword}
        minLength={passwordMinLength}
        context={{ email, name, organizationName }}
        readOnly={isPending}
        label="Choose a password"
      />

      <Button type="submit" size="lg" className="mt-1 h-10 w-full" disabled={isPending} aria-busy={isPending}>
        {isPending ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden />
            Setting up your account…
          </>
        ) : (
          <>
            Join {organizationName}
            <ArrowRight aria-hidden />
          </>
        )}
      </Button>
    </form>
  );
}
