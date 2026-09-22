import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, serializeError } from "@/server/log";

/**
 * The logger is the last thing that touches an error before it leaves the process, so these tests are mostly
 * about what must NOT come out: provider keys, bearer tokens, connection-string passwords, unbounded payloads.
 */

const ORIGINAL = { ...process.env };

/** Just enough of a Vitest spy to read what was written, without importing its generics. */
type ConsoleSpy = { mock: { calls: unknown[][] } };

function captured(spy: ConsoleSpy): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

function parsed(spy: ConsoleSpy): Record<string, unknown>[] {
  return captured(spy).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** `process.env.NODE_ENV` is typed read-only; config reads it lazily, so tests need to move it. */
function setNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

describe("ops: structured logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The logger stays silent under Vitest unless RUNTIME_LOG is set, so suites are not drowned in output.
    process.env.RUNTIME_LOG = "1";
    process.env.LOG_FORMAT = "json";
    delete process.env.LOG_LEVEL;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL };
  });

  it("writes one JSON line per record with level, timestamp and bindings", () => {
    const log = createLogger({ service: "worker" }).child({ runId: "run_1", orgId: "org_1" });
    log.info("run.claimed", { attempt: 2 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [record] = parsed(logSpy);
    expect(record).toMatchObject({ level: "info", msg: "run.claimed", service: "worker", runId: "run_1", orgId: "org_1", attempt: 2 });
    expect(typeof record.time).toBe("string");
    expect(new Date(String(record.time)).getTime()).not.toBeNaN();
  });

  it("routes warn and error to their own console streams", () => {
    const log = createLogger();
    log.warn("queue.slow");
    log.error("queue.failed");
    expect(captured(warnSpy)).toHaveLength(1);
    expect(captured(errorSpy)).toHaveLength(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("drops records below the configured level", () => {
    process.env.LOG_LEVEL = "warn";
    const log = createLogger();
    log.debug("noise");
    log.info("noise");
    log.warn("kept");
    expect(logSpy).not.toHaveBeenCalled();
    expect(captured(warnSpy)).toHaveLength(1);
  });

  it("redacts secrets in the message, in fields and inside error messages", () => {
    const log = createLogger();
    log.error("call failed for sk-live-abcdef1234567890", {
      url: "https://api.example.com?token=Bearer abcdef1234567890",
      err: new Error("connect to postgresql://app:hunter2supersecret@db:5432/app failed"),
    });

    const line = captured(errorSpy)[0];
    expect(line).not.toContain("sk-live-abcdef1234567890");
    expect(line).not.toContain("hunter2supersecret");
    expect(line).toContain("[redacted]");
  });

  it("serializes errors to name/message/code and never dumps the raw object", () => {
    const prismaish = Object.assign(new Error("Invalid `db.run.findMany()` invocation"), { code: "P2021" });
    const record = serializeError(prismaish) as Record<string, unknown>;
    expect(record).toMatchObject({ name: "Error", message: "Invalid `db.run.findMany()` invocation", code: "P2021" });

    const withCause = new Error("outer", { cause: new Error("inner") });
    const nested = serializeError(withCause) as Record<string, unknown>;
    expect((nested.cause as Record<string, unknown>).message).toBe("inner");
  });

  it("survives circular, deep and oversized values instead of throwing", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const log = createLogger();

    expect(() =>
      log.info("weird", { cyclic, deep: { a: { b: { c: { d: { e: "too deep" } } } } }, long: "x".repeat(5_000), many: Array.from({ length: 50 }, (_, i) => i) }),
    ).not.toThrow();

    const [record] = parsed(logSpy);
    expect(JSON.stringify(record.cyclic)).toContain("[circular]");
    expect(String(record.long).length).toBeLessThan(2_100);
    expect((record.many as unknown[]).length).toBeLessThanOrEqual(21);
  });

  it("keeps stack traces out of production output", () => {
    const boom = new Error("boom");
    expect(serializeError(boom)).toHaveProperty("stack");

    setNodeEnv("production");
    try {
      expect(serializeError(boom)).not.toHaveProperty("stack");
    } finally {
      setNodeEnv("test");
    }
  });
});
