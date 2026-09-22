"use client";

import { useActionState, useState } from "react";
import { AuthField, AuthStaticField } from "../../_components/field";
import { FormAlert, SubmitButton } from "../../_components/form-ui";
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
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {error ? <FormAlert id="accept-invite-error">{error}</FormAlert> : null}

      <AuthStaticField label="Joining as" value={email} />

      <AuthField
        name="name"
        label="Your name"
        value={name}
        onValueChange={setName}
        autoComplete="name"
        required
        maxLength={FIELD_LIMITS.name}
        readOnly={isPending}
        invalid={Boolean(error)}
        describedBy={error ? "accept-invite-error" : undefined}
      />

      <PasswordField
        value={password}
        onChange={setPassword}
        minLength={passwordMinLength}
        context={{ email, name, organizationName }}
        readOnly={isPending}
        label="Choose a password"
      />

      <div className="mt-2">
        <SubmitButton
          pending={isPending}
          label={`Join ${organizationName}`}
          pendingLabel="Setting up your account…"
        />
      </div>
    </form>
  );
}
