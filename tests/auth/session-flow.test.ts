import { Auth, skipCSRFCheck, type AuthConfig } from "@auth/core";
import Credentials from "@auth/core/providers/credentials";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authConfig } from "@/server/auth/auth.config";
import { authorizeCredentials } from "@/server/auth/authorize";
import { TEST_PASSWORD, createOrgWithPassword } from "./helpers";

/**
 * End-to-end through the real Auth.js core (no Next.js, no next-auth index): credentials → encrypted JWT
 * cookie → session. Proves the token/session contract — the session carries userId, organizationId and role —
 * with the same edge-safe callbacks the middleware uses and the same authorize function as `index.ts`.
 */
const config: AuthConfig = {
  ...authConfig,
  secret: "session-flow-test-secret-0123456789abcdef",
  trustHost: true,
  basePath: "/api/auth",
  skipCSRFCheck,
  logger: { error: () => undefined }, // wrong-password attempts are expected here; keep the test output quiet
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: (c) => authorizeCredentials(c?.email as string, c?.password as string),
    }),
  ],
};

const ORIGIN = "http://localhost:3000";

async function postCredentials(email: string, password: string): Promise<Response> {
  return Auth(
    new Request(`${ORIGIN}/api/auth/callback/credentials`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password, callbackUrl: "/approvals" }),
    }),
    config,
  );
}

async function readSession(cookie: string): Promise<{ user?: Record<string, unknown> } | null> {
  const res = await Auth(new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie } }), config);
  return (await res.json()) as { user?: Record<string, unknown> } | null;
}

const cookieHeader = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

describe("credentials → JWT cookie → session", () => {
  let org: Awaited<ReturnType<typeof createOrgWithPassword>>;

  beforeAll(async () => {
    org = await createOrgWithPassword("auth-flow");
  });

  afterAll(async () => {
    await org?.cleanup();
  });

  it("signs in, redirects to the callbackUrl and exposes userId / organizationId / role on the session", async () => {
    const res = await postCredentials(`  ${org.user.email.toUpperCase()} `, TEST_PASSWORD);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/approvals`);

    const cookie = cookieHeader(res);
    expect(cookie).toContain("authjs.session-token=");
    // The cookie is an encrypted JWT — no identity in the clear.
    expect(cookie).not.toContain(org.user.id);

    const session = await readSession(cookie);
    expect(session?.user).toMatchObject({
      id: org.user.id,
      organizationId: org.organization.id,
      role: "OWNER",
      email: org.user.email,
      name: org.user.name,
    });
  });

  it("issues no session for a wrong password and points back at the sign-in page", async () => {
    const res = await postCredentials(org.user.email, "definitely-wrong");
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("error")).toBe("CredentialsSignin");
    expect(cookieHeader(res)).not.toContain("authjs.session-token=ey");
  });

  it("treats a missing or tampered cookie as signed out", async () => {
    expect(await readSession("")).toBeNull();
    expect(await readSession("authjs.session-token=not-a-valid-jwe")).toBeNull();
  });
});
