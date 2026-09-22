import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { guardedFetch, guardedLookup, transport } from "@/server/tools/guarded-http";
import { fetchUrlLive } from "@/server/tools/impl/fetch-url";
import type { LookupFn } from "@/server/tools/net-guard";

/**
 * The connection-time half of the SSRF guard: whatever DNS answers when the socket connects is checked again,
 * so a rebinding host (public for the pre-check, private for the connection) never reaches a private address.
 * A loopback test server stands in for "an internal service"; only the test seam `isBlocked` lets a request in.
 */

let server: http.Server;
let port = 0;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/gzip") {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      res.end(gzipSync("compressed hello"));
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/next" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-multi": ["a", "b"] });
    res.end("<title>Internal</title><p>secret</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  hits.length = 0;
  vi.restoreAllMocks();
});

const init = () => ({ method: "GET", redirect: "manual" as const, signal: new AbortController().signal, headers: { accept: "*/*" } });
const loopback: LookupFn = async () => [{ address: "127.0.0.1", family: 4 }];

describe("guardedLookup", () => {
  const call = (lookup: LookupFn, options: { family?: number; all?: boolean }) =>
    new Promise<{ err: Error | null; address: unknown; family?: number }>((resolve) =>
      guardedLookup({ lookup })("host.test", options, (err, address, family) => resolve({ err, address, family })),
    );

  it("refuses when ANY address the socket would use is blocked", async () => {
    const mixed: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    const out = await call(mixed, {});
    expect(out.err?.message).toContain("private or reserved address (169.254.169.254)");
  });

  it("answers in the shape net.connect asked for (single address or all, by family)", async () => {
    const dual: LookupFn = async () => [
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ];
    expect(await call(dual, { family: 4 })).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
    expect(await call(dual, { all: true })).toMatchObject({ err: null, address: [{ family: 6 }, { family: 4 }] });
    const v4only: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    expect((await call(v4only, { family: 6 })).err?.message).toContain("no usable addresses");
    expect((await call(async () => Promise.reject(new Error("SERVFAIL")), {})).err?.message).toBe("SERVFAIL");
  });
});

describe("guardedFetch", () => {
  it("never connects to a blocked address, even when the host resolved to a public one a moment earlier (DNS rebinding)", async () => {
    let lookups = 0;
    const rebinding: LookupFn = async () => (++lookups === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
    // fetchUrlLive's pre-check sees the public answer; the socket's own lookup then sees loopback and refuses.
    await expect(fetchUrlLive(`http://rebind.test:8080/`, { lookup: rebinding })).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: expect.stringContaining("private or reserved address (127.0.0.1)"),
    });
    expect(lookups).toBe(2);

    await expect(guardedFetch(`http://rebind.test:${port}/`, init(), { lookup: loopback })).rejects.toMatchObject({
      cause: expect.objectContaining({ name: "BlockedAddressError" }),
    });
    expect(hits).toEqual([]);
  });

  it("returns a standard Response: status, headers, streamed body, gzip decoded, redirects not followed", async () => {
    const open = { lookup: loopback, isBlocked: () => false };
    const page = await guardedFetch(`http://internal.test:${port}/page`, init(), open);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("x-multi")).toBe("a, b");
    expect(await page.text()).toBe("<title>Internal</title><p>secret</p>");

    const zipped = await guardedFetch(`http://internal.test:${port}/gzip`, init(), open);
    expect(zipped.headers.get("content-encoding")).toBeNull();
    expect(await zipped.text()).toBe("compressed hello");

    const moved = await guardedFetch(`http://internal.test:${port}/redirect`, init(), open);
    expect(moved.status).toBe(302);
    expect(moved.headers.get("location")).toBe("/next");
    expect(hits).toEqual(["/page", "/gzip", "/redirect"]);
  });

  it("rejects like fetch on network errors and aborts", async () => {
    const open = { lookup: loopback, isBlocked: () => false };
    const controller = new AbortController();
    controller.abort();
    await expect(guardedFetch(`http://internal.test:${port}/`, { ...init(), signal: controller.signal }, open)).rejects.toBeInstanceOf(TypeError);
    await expect(guardedFetch("http://127.0.0.1:1/", init(), { isBlocked: () => false })).rejects.toMatchObject({ message: "fetch failed" });
  });

  it("is what live fetch_url uses by default", async () => {
    const spy = vi.spyOn(transport, "fetch").mockImplementation(async () => new Response("<title>Hi</title><p>ok</p>", { headers: { "content-type": "text/html" } }));
    const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const result = await fetchUrlLive("https://public.test/a", { lookup: publicLookup });
    expect(result).toEqual({ url: "https://public.test/a", title: "Hi", text: "ok" });
    expect(spy).toHaveBeenCalledWith("https://public.test/a", expect.objectContaining({ method: "GET", redirect: "manual" }), { lookup: publicLookup });
  });
});
