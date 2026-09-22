"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_LIMITS, passwordChecklist, type PasswordCheckContext } from "../schema";
import { AuthField, ShowToggle } from "./field";

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  minLength: number;
  /** The account's own details, so the checklist can warn about echoing them back. */
  context: PasswordCheckContext;
  readOnly?: boolean;
  label?: string;
  id?: string;
}

/**
 * Password input with a live checklist. The list is guidance only — `@/server/account` re-checks every rule
 * and additionally refuses breached passwords, keyboard runs and counting sequences, and its refusal comes
 * back as the form's inline error.
 */
export function PasswordField({
  value,
  onChange,
  minLength,
  context,
  readOnly = false,
  label = "Password",
  id = "password",
}: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  const checks = passwordChecklist(value, minLength, context);

  return (
    <div>
      <AuthField
        id={id}
        name="password"
        label={label}
        type={show ? "text" : "password"}
        value={value}
        onValueChange={onChange}
        autoComplete="new-password"
        required
        maxLength={FIELD_LIMITS.password}
        readOnly={readOnly}
        describedBy={`${id}-checklist`}
        trailing={<ShowToggle shown={show} onToggle={() => setShow((v) => !v)} />}
      />

      <ul id={`${id}-checklist`} className="mt-3 flex flex-col gap-1.5">
        {checks.map((check) => (
          <li
            key={check.id}
            className={cn(
              "flex items-start gap-2 text-[13px] leading-[18px] transition-colors duration-200 ease-standard",
              check.ok ? "text-success" : "text-muted-foreground",
            )}
          >
            <span className="flex size-[18px] shrink-0 items-center justify-center" aria-hidden>
              {check.ok ? (
                <Check className="size-3.5" />
              ) : (
                <span className="size-[5px] rounded-full bg-current opacity-45" />
              )}
            </span>
            <span>{check.label}</span>
            <span className="sr-only">{check.ok ? " — met" : " — not met yet"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
