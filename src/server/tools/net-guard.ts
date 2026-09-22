import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, isIPv4, isIPv6 } from "node:net";

/**
 * URL / IP safety for `fetch_url`. A worker can ask to fetch anything the model dreams up, so before any live
 * request we (1) accept only http(s) on a small port allow-list, (2) resolve the host ourselves and (3) refuse
 * every address that points inside the network we run in: loopback, RFC 1918, link-local (incl. the
 * 169.254.169.254 cloud metadata endpoint), CGNAT, unique-local / site-local IPv6, tunnels that embed an IPv4
 * address, multicast, reserved and documentation ranges. ALL resolved addresses must pass — one bad A/AAAA
 * record rejects the whole host.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };
export type HostCheck = { ok: true; url: URL; addresses: string[] } | { ok: false; reason: string };

export const ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443]);

const BLOCKED_HOST_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "localdomain"];

const blockList = new BlockList();
// IPv4
blockList.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network
blockList.addSubnet("10.0.0.0", 8, "ipv4"); // private
blockList.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT (shared address space)
blockList.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blockList.addSubnet("169.254.0.0", 16, "ipv4"); // link-local + cloud metadata (169.254.169.254)
blockList.addSubnet("172.16.0.0", 12, "ipv4"); // private
blockList.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blockList.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1
blockList.addSubnet("192.168.0.0", 16, "ipv4"); // private
blockList.addSubnet("198.18.0.0", 15, "ipv4"); // benchmarking
blockList.addSubnet("198.51.100.0", 24, "ipv4"); // TEST-NET-2
blockList.addSubnet("203.0.113.0", 24, "ipv4"); // TEST-NET-3
blockList.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blockList.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast
// IPv6
blockList.addSubnet("::", 128, "ipv6"); // unspecified
blockList.addSubnet("::1", 128, "ipv6"); // loopback
// NOT "::ffff:0:0/96": BlockList matches plain IPv4 addresses as IPv4-mapped IPv6, so that rule would block every
// IPv4 address. Mapped / NAT64 addresses are unwrapped by `embeddedIpv4` and checked against the IPv4 rules instead.
blockList.addSubnet("::", 96, "ipv6"); // IPv4-compatible (deprecated)
blockList.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 well-known prefix
blockList.addSubnet("64:ff9b:1::", 48, "ipv6"); // local-use NAT64
blockList.addSubnet("100::", 64, "ipv6"); // discard-only
blockList.addSubnet("2001::", 32, "ipv6"); // Teredo tunnels
blockList.addSubnet("2001:db8::", 32, "ipv6"); // documentation
blockList.addSubnet("2002::", 16, "ipv6"); // 6to4 tunnels
blockList.addSubnet("fc00::", 7, "ipv6"); // unique local (fc00::/7 — includes AWS IMDS fd00:ec2::254)
blockList.addSubnet("fe80::", 10, "ipv6"); // link-local
blockList.addSubnet("fec0::", 10, "ipv6"); // site-local (deprecated)
blockList.addSubnet("ff00::", 8, "ipv6"); // multicast

/** IPv4 embedded in the low 32 bits of an IPv6 address (`::ffff:a.b.c.d`, `::ffff:7f00:1`, `64:ff9b::a.b.c.d`). */
function embeddedIpv4(ipv6: string): string | undefined {
  const lower = ipv6.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return undefined;
}

/** True when `ip` (v4 or v6, any textual form) must never be contacted. Malformed input counts as blocked. */
export function isBlockedIp(ip: string): boolean {
  const address = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, ""); // strip brackets + zone id
  if (isIPv4(address)) return blockList.check(address, "ipv4");
  if (isIPv6(address)) {
    const inner = embeddedIpv4(address);
    if (inner && (!isIPv4(inner) || blockList.check(inner, "ipv4"))) return true;
    return blockList.check(address, "ipv6");
  }
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Syntax-level checks only (no I/O): scheme, credentials, port, obviously-internal hosts and IP literals. */
export function checkUrlSyntax(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `"${raw}" is not a valid URL` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Only http and https URLs can be fetched (got ${url.protocol.replace(/:$/, "")})` };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  if (!url.hostname) return { ok: false, reason: "URL has no host" };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: `Port ${port} is not allowed (only 80, 443, 8080 and 8443)` };
  if (isBlockedHostname(url.hostname)) return { ok: false, reason: `Host "${url.hostname}" is not reachable from here` };
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && isBlockedIp(literal)) return { ok: false, reason: `Address ${literal} is private or reserved` };
  return { ok: true, url };
}

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Full check for a live request: syntax, then DNS. Every resolved address must be public. The resolved
 * addresses are returned so callers can log them; the request itself still goes to the hostname (TLS + SNI).
 */
export async function checkUrl(raw: string, opts: { lookup?: LookupFn } = {}): Promise<HostCheck> {
  const syntax = checkUrlSyntax(raw);
  if (!syntax.ok) return syntax;
  const { url } = syntax;
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return { ok: true, url, addresses: [literal] };

  let records: Array<{ address: string; family: number }>;
  try {
    records = await (opts.lookup ?? defaultLookup)(url.hostname);
  } catch {
    return { ok: false, reason: `Could not resolve host "${url.hostname}"` };
  }
  if (records.length === 0) return { ok: false, reason: `Host "${url.hostname}" has no addresses` };
  const addresses = records.map((r) => r.address);
  const blocked = addresses.find((a) => isBlockedIp(a));
  if (blocked) return { ok: false, reason: `Host "${url.hostname}" resolves to a private or reserved address (${blocked})` };
  return { ok: true, url, addresses };
}
