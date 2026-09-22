/**
 * Pure routing rules for the auth middleware. Edge-safe (no Prisma, bcrypt, next-auth or Next.js imports)
 * and unit-tested directly; `auth.config.ts` only translates the decision into a Response.
 */

export const SIGN_IN_PATH = "/sign-in";
export const DEFAULT_SIGNED_IN_PATH = "/workforce";

/**
 * Set by `requireSession()` when the cookie is cryptographically valid but its user no longer exists
 * (e.g. after a re-seed). The middleware can only see the cookie, so without this flag it would bounce
 * the "signed-in" visitor from /sign-in back into the app forever.
 */
export const SESSION_EXPIRED_PARAM = "expired";
export const SESSION_EXPIRED_SIGN_IN_PATH = `${SIGN_IN_PATH}?${SESSION_EXPIRED_PARAM}=1`;

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

const isUnder = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Only same-origin, path-relative targets are accepted as a post-sign-in destination; anything else
 * (absolute URLs, protocol-relative `//host`, backslash tricks, the sign-in page itself) falls back to
 * the default landing page. Prevents open redirects through `?callbackUrl=`.
 */
export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return DEFAULT_SIGNED_IN_PATH;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return DEFAULT_SIGNED_IN_PATH;
  // Control characters (tabs/newlines) are stripped by URL parsers and can turn "/\t/host" into "//host".
  if (hasControlCharacters(raw)) return DEFAULT_SIGNED_IN_PATH;
  const pathname = raw.split(/[?#]/, 1)[0] ?? "";
  if (pathname === "/" || isUnder(pathname, SIGN_IN_PATH) || isUnder(pathname, "/api")) return DEFAULT_SIGNED_IN_PATH;
  return raw;
}

export function decideAccess(req: AccessRequest): AccessDecision {
  const { pathname, search, method, isAuthenticated } = req;

  // Auth.js' own endpoints (session, csrf, callback, signout) must always be reachable.
  if (isUnder(pathname, "/api/auth")) return { kind: "allow" };

  if (isUnder(pathname, SIGN_IN_PATH)) {
    const isPageLoad = method === "GET" || method === "HEAD";
    const expired = new URLSearchParams(search).has(SESSION_EXPIRED_PARAM);
    // Server-action POSTs to /sign-in (the sign-in form itself) always pass through.
    if (isAuthenticated && isPageLoad && !expired) {
      return { kind: "redirect", to: safeCallbackUrl(new URLSearchParams(search).get("callbackUrl")) };
    }
    return { kind: "allow" };
  }

  if (isAuthenticated) return { kind: "allow" };

  // API consumers get a status code they can act on, never an HTML redirect.
  if (isUnder(pathname, "/api")) return { kind: "unauthorized" };

  const target = safeCallbackUrl(`${pathname}${search}`);
  // Keep the URL clean when the visitor was heading to the default landing page anyway.
  if (target === DEFAULT_SIGNED_IN_PATH) return { kind: "redirect", to: SIGN_IN_PATH };
  return { kind: "redirect", to: `${SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(target)}` };
}
