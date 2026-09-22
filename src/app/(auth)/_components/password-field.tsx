"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FIELD_LIMITS, passwordChecklist, type PasswordCheckContext } from "../schema";

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
 * and additionally refuses breached passwords, keyboard runs and counting sequences.
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
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name="password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          maxLength={FIELD_LIMITS.password}
          className="h-10 pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          aria-describedby={`${id}-checklist`}
        />
        <div className="absolute inset-y-0 right-1.5 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
          >
            {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
      </div>

      <ul id={`${id}-checklist`} className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
        {checks.map((check) => (
          <li key={check.id} className="flex items-start gap-1.5">
            {check.ok ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            ) : (
              <Minus className="mt-0.5 size-3.5 shrink-0 opacity-50" aria-hidden />
            )}
            <span className={check.ok ? "text-foreground" : undefined}>{check.label}</span>
            <span className="sr-only">{check.ok ? " — met" : " — not met yet"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
