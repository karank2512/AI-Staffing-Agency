import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefcaseBusiness, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_SIGNED_IN_PATH, SIGN_IN_PATH, getSession } from "@/server/auth";
import { config } from "@/server/config";
import { SIGN_UP_MESSAGES } from "../schema";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create a workspace" };

/**
 * Self-serve sign-up. `SIGNUP_MODE` decides whether this page can do anything at all — and the same check
 * runs inside `signUp()`, so a direct POST to the action gets the identical refusal.
 */
export default async function SignUpPage() {
  if (await getSession()) redirect(DEFAULT_SIGNED_IN_PATH);

  const mode = config.auth.signupMode;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm ring-1 ring-foreground/10">
          <BriefcaseBusiness className="size-5" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-heading text-xl font-semibold tracking-tight">AI Staffing Agency</p>
          <p className="text-sm text-muted-foreground">Hire AI workers like contractors.</p>
        </div>
      </header>

      <Card className="shadow-sm [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle>
            <h1>{mode === "closed" ? "Sign-up is closed" : "Create your workspace"}</h1>
          </CardTitle>
          <CardDescription>
            {mode === "closed"
              ? "New workspaces aren't open on this deployment."
              : "You'll be the owner: you can invite the rest of your team once you're in."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mode === "closed" ? (
            <Alert>
              <Lock aria-hidden />
              <AlertDescription>{SIGN_UP_MESSAGES.closed}.</AlertDescription>
            </Alert>
          ) : (
            <SignUpForm inviteCodeRequired={mode === "invite"} passwordMinLength={config.auth.passwordMinLength} />
          )}
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={SIGN_IN_PATH} className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
