import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNED_IN_PATH,
  SESSION_EXPIRED_SIGN_IN_PATH,
  decideAccess,
  safeCallbackUrl,
  type AccessRequest,
} from "@/server/auth/access";

const request = (overrides: Partial<AccessRequest>): AccessRequest => ({
  pathname: "/workforce",
  search: "",
  method: "GET",
  isAuthenticated: false,
  ...overrides,
});

describe("decideAccess — signed out", () => {
  it("redirects page requests to the sign-in page with a relative callbackUrl", () => {
    expect(decideAccess(request({ pathname: "/workers/abc", search: "?tab=cost" }))).toEqual({
      kind: "redirect",
      to: `/sign-in?callbackUrl=${encodeURIComponent("/workers/abc?tab=cost")}`,
    });
  });

  it("keeps the sign-in URL clean when heading to the default landing page", () => {
    expect(decideAccess(request({ pathname: "/workforce" }))).toEqual({ kind: "redirect", to: "/sign-in" });
  });

  it("lets the public pages through: the landing page, sign-up, invite links and the ops probes", () => {
    for (const pathname of ["/", "/sign-up", "/invite/abc123", "/api/health", "/api/ready"]) {
      expect(decideAccess(request({ pathname }))).toEqual({ kind: "allow" });
    }
    expect(decideAccess(request({ pathname: "/sign-up", method: "POST" }))).toEqual({ kind: "allow" });
    expect(decideAccess(request({ pathname: "/invite/abc123", method: "POST" }))).toEqual({ kind: "allow" });
  });

  it("does not let look-alikes of the public paths through", () => {
    expect(decideAccess(request({ pathname: "/invited" })).kind).toBe("redirect");
    expect(decideAccess(request({ pathname: "/sign-upgrade" })).kind).toBe("redirect");
    expect(decideAccess(request({ pathname: "/api/healthz" }))).toEqual({ kind: "unauthorized" });
  });

  it("answers /api/* with 401 instead of a redirect", () => {
    expect(decideAccess(request({ pathname: "/api/runs/run_1" }))).toEqual({ kind: "unauthorized" });
    expect(decideAccess(request({ pathname: "/api/runs/run_1", method: "POST" }))).toEqual({ kind: "unauthorized" });
  });

  it("always lets Auth.js' own endpoints through", () => {
    expect(decideAccess(request({ pathname: "/api/auth/session" }))).toEqual({ kind: "allow" });
    expect(decideAccess(request({ pathname: "/api/auth/callback/credentials", method: "POST" }))).toEqual({
      kind: "allow",
    });
  });

  it("does not treat look-alike paths as public", () => {
    expect(decideAccess(request({ pathname: "/api/authentic" }))).toEqual({ kind: "unauthorized" });
    expect(decideAccess(request({ pathname: "/sign-in-help" })).kind).toBe("redirect");
  });

  it("allows the sign-in page and its server-action POST", () => {
    expect(decideAccess(request({ pathname: "/sign-in" }))).toEqual({ kind: "allow" });
    expect(decideAccess(request({ pathname: "/sign-in", method: "POST" }))).toEqual({ kind: "allow" });
  });
});

describe("decideAccess — signed in", () => {
  it("allows pages and API routes", () => {
    expect(decideAccess(request({ isAuthenticated: true }))).toEqual({ kind: "allow" });
    expect(decideAccess(request({ pathname: "/api/runs/run_1", isAuthenticated: true }))).toEqual({ kind: "allow" });
  });

  it("sends visitors on /sign-up into the app too", () => {
    expect(decideAccess(request({ pathname: "/sign-up", isAuthenticated: true }))).toEqual({
      kind: "redirect",
      to: DEFAULT_SIGNED_IN_PATH,
    });
    // …but never its form POST.
    expect(decideAccess(request({ pathname: "/sign-up", method: "POST", isAuthenticated: true }))).toEqual({
      kind: "allow",
    });
  });

  it("leaves an invite link reachable while signed in (they may be joining a second workspace)", () => {
    expect(decideAccess(request({ pathname: "/invite/abc123", isAuthenticated: true }))).toEqual({ kind: "allow" });
  });

  it("sends visitors on /sign-in into the app, honouring a safe callbackUrl", () => {
    expect(decideAccess(request({ pathname: "/sign-in", isAuthenticated: true }))).toEqual({
      kind: "redirect",
      to: DEFAULT_SIGNED_IN_PATH,
    });
    expect(
      decideAccess(request({ pathname: "/sign-in", search: "?callbackUrl=%2Fapprovals", isAuthenticated: true })),
    ).toEqual({ kind: "redirect", to: "/approvals" });
    expect(
      decideAccess(
        request({ pathname: "/sign-in", search: "?callbackUrl=https%3A%2F%2Fevil.example", isAuthenticated: true }),
      ),
    ).toEqual({ kind: "redirect", to: DEFAULT_SIGNED_IN_PATH });
  });

  it("does not bounce a stale session off the sign-in page (no redirect loop with requireSession)", () => {
    const [pathname, search] = SESSION_EXPIRED_SIGN_IN_PATH.split("?");
    expect(decideAccess(request({ pathname, search: `?${search}`, isAuthenticated: true }))).toEqual({ kind: "allow" });
  });

  it("never redirects the sign-in form's POST", () => {
    expect(decideAccess(request({ pathname: "/sign-in", method: "POST", isAuthenticated: true }))).toEqual({
      kind: "allow",
    });
  });
});

describe("safeCallbackUrl", () => {
  it("accepts same-origin relative paths, with query and hash", () => {
    expect(safeCallbackUrl("/approvals")).toBe("/approvals");
    expect(safeCallbackUrl("/workers/w1?tab=chat#latest")).toBe("/workers/w1?tab=chat#latest");
  });

  it.each([
    ["absolute URL", "https://evil.example/phish"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["control characters", "/\t/evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["relative path without a leading slash", "workforce"],
    ["the root", "/"],
    ["the sign-in page itself", "/sign-in?callbackUrl=%2Fsign-in"],
    ["the sign-up page", "/sign-up"],
    ["an invite link", "/invite/abc123"],
    ["an API route", "/api/runs/run_1"],
    ["empty string", ""],
    ["an absurdly long value", `/${"a".repeat(3000)}`],
  ])("falls back to the default for %s", (_label, value) => {
    expect(safeCallbackUrl(value)).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it("falls back to the default for non-string input (FormData can hold Files)", () => {
    expect(safeCallbackUrl(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeCallbackUrl(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeCallbackUrl(["/approvals"])).toBe(DEFAULT_SIGNED_IN_PATH);
  });
});
