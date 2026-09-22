import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefcaseBusiness } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SESSION_EXPIRED_PARAM, SIGN_UP_PATH, getSession, safeCallbackUrl } from "@/server/auth";
import { DEMO_USER } from "@/server/auth/types";
import { config } from "@/server/config";
import { SIGN_IN_MESSAGES } from "../schema";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function SignInPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(first(params.callbackUrl));

  // The middleware already turns away visitors with a valid cookie; this DB-verified check also covers
  // the `?expired=1` escape hatch being opened by someone whose session is in fact fine.
  if (await getSession()) redirect(callbackUrl);

  const sessionExpired = first(params[SESSION_EXPIRED_PARAM]) !== undefined;

  // Auth.js appends `?error=<type>` when a sign-in made through its HTTP endpoint (not our form action) fails.
  const errorType = first(params.error);
  const initialError =
    errorType === undefined
      ? null
      : errorType === "CredentialsSignin"
        ? SIGN_IN_MESSAGES.invalidCredentials
        : SIGN_IN_MESSAGES.unexpected;

  // Demo credentials are printed on the page ONLY for a deployment that opted in (DEMO_MODE=true).
  // Anywhere else the fields start empty and nothing hints at a shared account.
  const demoMode = config.auth.demoMode;
  const signUpOpen = config.auth.signupMode !== "closed";

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
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>Your workforce is ready when you are.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm
            defaultEmail={demoMode ? DEMO_USER.email : ""}
            defaultPassword={demoMode ? DEMO_USER.password : ""}
            demoMode={demoMode}
            callbackUrl={callbackUrl}
            sessionExpired={sessionExpired}
            initialError={initialError}
          />
        </CardContent>
      </Card>

      {signUpOpen ? (
        <p className="text-center text-sm text-muted-foreground">
          No workspace yet?{" "}
          <Link href={SIGN_UP_PATH} className="font-medium text-foreground underline underline-offset-4">
            Create one
          </Link>
        </p>
      ) : null}

      {demoMode ? (
        <p className="text-center text-xs text-balance text-muted-foreground">
          You&apos;re signing in to the {DEMO_USER.organizationName} demo workspace. The credentials are pre-filled —
          nothing to remember.
        </p>
      ) : null}
    </div>
  );
}
