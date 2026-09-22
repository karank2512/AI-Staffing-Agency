import { describe, expect, it } from "vitest";
import { checkUrl, checkUrlSyntax, isBlockedIp, type LookupFn } from "@/server/tools/net-guard";

describe("net-guard: isBlockedIp", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "100.64.0.1", // CGNAT
    "192.0.2.1", // TEST-NET
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd00:ec2::254", // AWS IMDS over IPv6 (fc00::/7)
    "fdff:ffff::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe", // IPv4-mapped 169.254.169.254 in hex form
    "64:ff9b::10.0.0.1", // NAT64
    "2002:0a00:0001::", // 6to4
    "2001:db8::1", // documentation
    "fe80::1%eth0",
    "[::1]",
    "not-an-ip",
    "",
  ];
  it.each(blocked)("blocks %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  const allowed = ["8.8.8.8", "1.1.1.1", "172.15.255.255", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"];
  it.each(allowed)("allows %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("net-guard: checkUrlSyntax", () => {
  const rejected: Array<[string, RegExp]> = [
    ["ftp://example.com/file", /Only http and https/],
    ["file:///etc/passwd", /Only http and https/],
    ["javascript:alert(1)", /Only http and https|not a valid URL/],
    ["gopher://example.com", /Only http and https/],
    ["http://localhost/", /not reachable/],
    ["http://foo.localhost/", /not reachable/],
    ["http://intranet.local/", /not reachable/],
    ["http://db.internal/", /not reachable/],
    ["http://127.0.0.1/", /private or reserved/],
    ["http://10.1.2.3:80/", /private or reserved/],
    ["http://192.168.0.10/admin", /private or reserved/],
    ["http://169.254.169.254/latest/meta-data/", /private or reserved/],
    ["http://[::1]/", /private or reserved/],
    ["http://[fc00::1]/", /private or reserved/],
    ["http://[::ffff:127.0.0.1]/", /private or reserved/],
    ["http://example.com:22/", /Port 22 is not allowed/],
    ["http://example.com:3000/", /Port 3000 is not allowed/],
    ["https://example.com:6379/", /Port 6379 is not allowed/],
    ["http://user:pass@example.com/", /embedded credentials/],
    ["http://token@example.com/", /embedded credentials/],
    ["not a url", /not a valid URL/],
  ];
  it.each(rejected)("rejects %s", (url, reason) => {
    const result = checkUrlSyntax(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  const accepted = ["http://example.com/", "https://example.com/path?q=1", "https://example.com:443/", "http://example.com:8080/", "https://example.com:8443/", "http://8.8.8.8/"];
  it.each(accepted)("accepts %s", (url) => {
    expect(checkUrlSyntax(url).ok).toBe(true);
  });
});

describe("net-guard: checkUrl (DNS)", () => {
  const lookupTo =
    (...addresses: string[]): LookupFn =>
    async () =>
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("accepts a host whose every address is public", async () => {
    const result = await checkUrl("https://public.test/page", { lookup: lookupTo("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.addresses).toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
  });

  it("rejects a host when ANY resolved address is private (DNS rebinding / split-horizon)", async () => {
    const result = await checkUrl("https://sneaky.test/", { lookup: lookupTo("93.184.216.34", "10.0.0.5") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/private or reserved address \(10\.0\.0\.5\)/);
  });

  it("rejects a host that resolves to the metadata endpoint or loopback", async () => {
    expect((await checkUrl("http://metadata.test/", { lookup: lookupTo("169.254.169.254") })).ok).toBe(false);
    expect((await checkUrl("http://loop.test/", { lookup: lookupTo("::1") })).ok).toBe(false);
    expect((await checkUrl("http://ula.test/", { lookup: lookupTo("fd12:3456::1") })).ok).toBe(false);
  });

  it("reports DNS failures and empty answers as errors", async () => {
    const failing: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await checkUrl("http://nope.test/", { lookup: failing })).toEqual({ ok: false, reason: 'Could not resolve host "nope.test"' });
    expect(await checkUrl("http://empty.test/", { lookup: lookupTo() })).toEqual({ ok: false, reason: 'Host "empty.test" has no addresses' });
  });

  it("does not resolve IP literals and never calls DNS for rejected syntax", async () => {
    let calls = 0;
    const counting: LookupFn = async () => {
      calls++;
      return [{ address: "8.8.8.8", family: 4 }];
    };
    expect((await checkUrl("http://8.8.8.8/", { lookup: counting })).ok).toBe(true);
    expect((await checkUrl("ftp://example.com/", { lookup: counting })).ok).toBe(false);
    expect((await checkUrl("http://127.0.0.1/", { lookup: counting })).ok).toBe(false);
    expect(calls).toBe(0);
  });
});
