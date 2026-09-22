/**
 * Pure routing rules for the auth middleware. Edge-safe (no Prisma, bcrypt, next-auth or Next.js imports)
 * and unit-tested directly; `auth.config.ts` only translates the decision into a Response.
 */

export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";
export const INVITE_PATH = "/invite";
export const DEFAULT_SIGNED_IN_PATH = "/workforce";

/**
 * Set by `requireSession()` when the cookie is cryptographically valid but its user no longer exists
 * (e.g. after a re-seed), was disabled, or carries a revoked `sessionVersion`. The middleware can only see
 * the cookie, so without this flag it would bounce the "signed-in" visitor from /sign-in back into the app
 * forever.
 */
export const SESSION_EXPIRED_PARAM = "expired";
export const SESSION_EXPIRED_SIGN_IN_PATH = `${SIGN_IN_PATH}?${SESSION_EXPIRED_PARAM}=1`;

/**
 * Reachable without a session. `/` is the landing page (it still forwards into the app for now), the two
 * account-creation flows have to work for people who have no account yet, and the ops probes must answer a
 * load balancer that never carries a cookie.
 *
 * `/api/auth/*` is handled separately below: Auth.js' own endpoints are always allowed, signed in or not.
 */
const PUBLIC_PATHS = ["/", SIGN_UP_PATH, INVITE_PATH, "/api/health", "/api/ready"] as const;

/** Pages a signed-in visitor has no business seeing — they get sent into the app instead. */
const SIGNED_OUT_ONLY_PATHS = [SIGN_IN_PATH, SIGN_UP_PATH] as const;

export type AccessDecision =
  | { kind: "allow" }
  /** `to` is always a same-origin relative URL. */
  | { kind: "redirect"; to: string }
  | { kind: "unauthorized" };

export interface AccessRequest {
  pathname: string;
  /** Query string including the leading "?" (or ""). */
  search: string;
  method: string;
  isAuthenticated: boolean;
}

const isUnder = (pathname: string, base: string) =>
  base === "/" ? pathname === "/" : pathname === base || pathname.startsWith(`${base}/`);

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Only same-origin, path-relative targets are accepted as a post-sign-in destination; anything else
 * (absolute URLs, protocol-relative `//host`, backslash tricks, the signed-out pages themselves) falls back
 * to the default landing page. Prevents open redirects through `?callbackUrl=`.
 */
export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return DEFAULT_SIGNED_IN_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_SIGNED_IN_PATH;
  // Control characters (tabs/newlines) are stripped by URL parsers and can turn "/\t/host" into "//host".
  if (hasControlCharacters(raw)) return DEFAULT_SIGNED_IN_PATH;
  const pathname = raw.split(/[?#]/, 1)[0] ?? "";
  // Bouncing a freshly signed-in user back to /sign-in, /sign-up or an invite link is never what they wanted.
  const rejected = ["/", SIGN_IN_PATH, SIGN_UP_PATH, INVITE_PATH, "/api"];
  if (rejected.some((base) => isUnder(pathname, base))) return DEFAULT_SIGNED_IN_PATH;
  return raw;
}

export function decideAccess(req: AccessRequest): AccessDecision {
  const { pathname, search, method, isAuthenticated } = req;

  // Auth.js' own endpoints (session, csrf, callback, signout) must always be reachable.
  if (isUnder(pathname, "/api/auth")) return { kind: "allow" };

  if (SIGNED_OUT_ONLY_PATHS.some((base) => isUnder(pathname, base))) {
    const isPageLoad = method === "GET" || method === "HEAD";
    const expired = new URLSearchParams(search).has(SESSION_EXPIRED_PARAM);
    // Server-action POSTs to these pages (the sign-in / sign-up forms themselves) always pass through.
    if (isAuthenticated && isPageLoad && !expired) {
      return { kind: "redirect", to: safeCallbackUrl(new URLSearchParams(search).get("callbackUrl")) };
    }
    return { kind: "allow" };
  }

  if (PUBLIC_PATHS.some((base) => isUnder(pathname, base))) return { kind: "allow" };

  if (isAuthenticated) return { kind: "allow" };

  // API consumers get a status code they can act on, never an HTML redirect.
  if (isUnder(pathname, "/api")) return { kind: "unauthorized" };

  const target = safeCallbackUrl(`${pathname}${search}`);
  // Keep the URL clean when the visitor was heading to the default landing page anyway.
  if (target === DEFAULT_SIGNED_IN_PATH) return { kind: "redirect", to: SIGN_IN_PATH };
  return { kind: "redirect", to: `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(target)}` };
}
