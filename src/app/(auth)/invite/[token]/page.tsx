import type { Metadata } from "next";
import Link from "next/link";
import { BriefcaseBusiness, LinkIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInvitationByToken } from "@/server/account";
import { SIGN_IN_PATH } from "@/server/auth";
import { config } from "@/server/config";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = { title: "Join a workspace" };

const ROLE_COPY: Record<string, string> = {
  MEMBER: "You'll be able to run workers, review their work and decide approvals.",
  ADMIN: "You'll be able to scope jobs, hire and manage workers, and invite teammates.",
  OWNER: "You'll be able to manage the workspace, its members and its budget.",
};

/**
 * Invite acceptance. Unknown, expired, revoked and already-used links are indistinguishable here — the
 * lookup returns null for all four, so a stranger cannot probe for live invitations.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await getInvitationByToken(token);

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
            <h1>{invitation ? `Join ${invitation.organizationName}` : "This invite isn't valid"}</h1>
          </CardTitle>
          <CardDescription>
            {invitation
              ? ROLE_COPY[invitation.role]
              : "Invite links expire, and each one can only be used once."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitation ? (
            <AcceptInviteForm
              token={token}
              email={invitation.email}
              organizationName={invitation.organizationName}
              passwordMinLength={config.auth.passwordMinLength}
            />
          ) : (
            <Alert>
              <LinkIcon aria-hidden />
              <AlertDescription>
                Ask whoever invited you to send a fresh link from their workspace settings.
              </AlertDescription>
            </Alert>
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
