import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
// The edge-safe config only type-imports next-auth, so this does not load the next-auth index.
import { authConfig } from "@/server/auth/auth.config";

const { authorized, jwt, session } = authConfig.callbacks;

type JwtParams = Parameters<typeof jwt>[0];
type SessionParams = Parameters<typeof session>[0];
type AuthorizedParams = Parameters<typeof authorized>[0];

const signedIn = {
  user: { id: "user_1", organizationId: "org_1", role: "OWNER", email: "a@example.test", name: "A" },
  expires: new Date(Date.now() + 60_000).toISOString(),
} as AuthorizedParams["auth"];

const gate = (url: string, auth: AuthorizedParams["auth"], init?: { method?: string }) =>
  authorized({ request: new NextRequest(url, init), auth });

describe("authConfig", () => {
  it("uses JWT sessions, the custom sign-in page and no edge-unsafe providers", () => {
    expect(authConfig.session.strategy).toBe("jwt");
    expect(authConfig.pages.signIn).toBe("/sign-in");
    expect(authConfig.providers).toEqual([]);
  });
});

describe("jwt + session callbacks", () => {
  it("copies userId, organizationId and role onto the token at sign-in", async () => {
    const token = await jwt({
      token: { sub: "user_1" },
      user: { id: "user_1", email: "a@example.test", name: "A", organizationId: "org_1", role: "ADMIN" },
    } as JwtParams);
    expect(token).toMatchObject({ userId: "user_1", organizationId: "org_1", role: "ADMIN" });
  });

  it("leaves the token untouched on later requests (no user)", async () => {
    const existing = { sub: "user_1", userId: "user_1", organizationId: "org_1", role: "ADMIN" };
    const token = await jwt({ token: { ...existing }, user: undefined } as unknown as JwtParams);
    expect(token).toEqual(existing);
  });

  it("copies the token's identity onto session.user", async () => {
    const result = await session({
      session: { user: { name: "A", email: "a@example.test" }, expires: "2099-01-01T00:00:00.000Z" },
      token: { userId: "user_1", organizationId: "org_1", role: "MEMBER" },
    } as unknown as SessionParams);
    expect(result.user).toMatchObject({ id: "user_1", organizationId: "org_1", role: "MEMBER", email: "a@example.test" });
  });

  it("yields a session without user.id for a token that lacks our identity fields", async () => {
    const result = await session({
      session: { user: { name: "A", email: "a@example.test" }, expires: "2099-01-01T00:00:00.000Z" },
      token: { sub: "someone" },
    } as unknown as SessionParams);
    expect(result.user && "id" in result.user ? result.user.id : undefined).toBeUndefined();
  });
});

describe("authorized callback (middleware gate)", () => {
  it("lets signed-in requests through", async () => {
    expect(await gate("http://localhost:3000/workforce", signedIn)).toBe(true);
  });

  it("redirects signed-out page requests to /sign-in with a callbackUrl on the same origin", async () => {
    const res = await gate("http://localhost:3000/approvals?status=pending", null);
    expect(res).toBeInstanceOf(Response);
    const location = new URL((res as Response).headers.get("location") ?? "");
    expect((res as Response).status).toBeGreaterThanOrEqual(300);
    expect((res as Response).status).toBeLessThan(400);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("callbackUrl")).toBe("/approvals?status=pending");
  });

  it("answers signed-out API requests with 401 JSON", async () => {
    const res = (await gate("http://localhost:3000/api/runs/run_1", null)) as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Not signed in", code: "UNAUTHENTICATED" });
  });

  it("treats a session without our identity fields as signed out", async () => {
    const foreign = { user: { email: "a@example.test" }, expires: signedIn?.expires } as AuthorizedParams["auth"];
    const res = (await gate("http://localhost:3000/api/runs/run_1", foreign)) as Response;
    expect(res.status).toBe(401);
  });

  it("sends signed-in visitors away from /sign-in, but not the form's POST", async () => {
    const res = (await gate("http://localhost:3000/sign-in", signedIn)) as Response;
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/workforce");
    expect(await gate("http://localhost:3000/sign-in", signedIn, { method: "POST" })).toBe(true);
  });
});
