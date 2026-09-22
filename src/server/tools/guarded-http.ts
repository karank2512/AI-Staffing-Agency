import type { LookupAddress, LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { pipeline, Readable } from "node:stream";
import zlib from "node:zlib";
import { defaultLookup, isBlockedIp, type LookupFn } from "./net-guard";

/**
 * The HTTP client behind live `fetch_url`. It exists for one reason: the network guard's DNS check must apply to
 * the SAME resolution the socket connects to. With the global fetch, `checkUrl` resolves the host, then fetch
 * resolves it again on its own — a hostname with TTL 0 can answer a public IP the first time and 169.254.169.254
 * or 10.x the second (DNS rebinding). Here the connection's own `lookup` re-runs the guard on every address it is
 * about to use, so whatever DNS says at connect time, a blocked address is never dialled. TLS/SNI still use the
 * hostname. The result is a standard `Response` so the caller's redirect/streaming/caps code is unchanged.
 */

export type FetchLike = (url: string, init: { method: string; redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export class BlockedAddressError extends Error {
  readonly code = "EBLOCKEDADDRESS";
  constructor(hostname: string, address: string) {
    super(`Host "${hostname}" resolves to a private or reserved address (${address})`);
    this.name = "BlockedAddressError";
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

export interface GuardOptions {
  lookup?: LookupFn;
  /** Test seam only (to reach a loopback test server); production always uses the network guard's rule. */
  isBlocked?: (ip: string) => boolean;
}

/** A net.connect-compatible `lookup` that refuses to hand out any address the network guard blocks. */
export function guardedLookup(opts: GuardOptions = {}) {
  const resolve = opts.lookup ?? defaultLookup;
  const isBlocked = opts.isBlocked ?? isBlockedIp;
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    resolve(hostname).then(
      (records) => {
        const blocked = records.find((r) => isBlocked(r.address));
        if (blocked) return callback(new BlockedAddressError(hostname, blocked.address), "");
        const wanted = options.family === 4 || options.family === 6 ? records.filter((r) => r.family === options.family) : records;
        if (wanted.length === 0) {
          return callback(Object.assign(new Error(`Host "${hostname}" has no usable addresses`), { code: "ENOTFOUND" }), "");
        }
        if (options.all) return callback(null, wanted.map((r) => ({ address: r.address, family: r.family })));
        return callback(null, wanted[0].address, wanted[0].family);
      },
      (e: unknown) => callback(Object.assign(e instanceof Error ? e : new Error(String(e)), { code: "ENOTFOUND" }), ""),
    );
  };
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function decoder(encoding: string): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null {
  if (encoding === "gzip" || encoding === "x-gzip") return zlib.createGunzip();
  if (encoding === "deflate") return zlib.createInflate();
  if (encoding === "br") return zlib.createBrotliDecompress();
  return null;
}

/** The body as the caller should read it: decompressed like fetch would, errors on either side propagated. */
function decoded(res: http.IncomingMessage): { stream: Readable; decodedFrom?: string } {
  const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const z = decoder(encoding);
  if (!z) return { stream: res };
  pipeline(res, z, () => undefined);
  return { stream: z, decodedFrom: encoding };
}

function toHeaders(res: http.IncomingMessage, decodedFrom?: string): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  if (decodedFrom) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  return headers;
}

/** One GET without following redirects, resolved through `guardedLookup`. Rejects like fetch does (error.cause). */
export function guardedFetch(url: string, init: Parameters<FetchLike>[1], opts: GuardOptions = {}): Promise<Response> {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  return new Promise<Response>((resolve, reject) => {
    const req = client.request(
      target,
      {
        method: init.method,
        headers: { ...init.headers, "accept-encoding": "gzip, deflate, br" },
        signal: init.signal,
        lookup: guardedLookup(opts),
        // A fresh agent per request: no pooled socket from an earlier resolution is ever reused.
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          res.resume();
          return reject(new TypeError("fetch failed", { cause: new Error(`Unexpected HTTP status ${status}`) }));
        }
        const { stream, decodedFrom } = decoded(res);
        const body = NULL_BODY_STATUSES.has(status) || init.method === "HEAD" ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>);
        if (body === null) res.resume();
        resolve(new Response(body, { status, statusText: res.statusMessage, headers: toHeaders(res, decodedFrom) }));
      },
    );
    req.on("error", (e) => reject(new TypeError("fetch failed", { cause: e })));
    req.end();
  });
}

/** Indirection so tests can stand in for the network without touching globals. */
export const transport: { fetch: (url: string, init: Parameters<FetchLike>[1], opts?: GuardOptions) => Promise<Response> } = {
  fetch: guardedFetch,
};
