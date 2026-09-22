import { afterEach, describe, expect, it } from "vitest";
import { demoSeedRefusalReason } from "../../prisma/seed/guard";

/**
 * The demo workspace ships a password that is written down in the README, so the seed must be impossible to run
 * against a production database by accident (audit OPS-14). `npm run setup` is migrations only for the same
 * reason — the seed is never part of a release path.
 */

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW = process.env.ALLOW_DEMO_SEED;

function setEnv(nodeEnv: string, allowDemoSeed?: string) {
  // `process.env.NODE_ENV` is typed read-only; config reads it lazily, so the test has to move it.
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  if (allowDemoSeed === undefined) delete process.env.ALLOW_DEMO_SEED;
  else process.env.ALLOW_DEMO_SEED = allowDemoSeed;
}

describe("ops: demo seed guard", () => {
  afterEach(() => {
    setEnv(ORIGINAL_NODE_ENV ?? "test", ORIGINAL_ALLOW);
  });

  it("refuses to seed a production database", () => {
    setEnv("production");
    const reason = demoSeedRefusalReason();
    expect(reason).toBeTruthy();
    expect(reason).toContain("ALLOW_DEMO_SEED");
  });

  it("allows a deliberate demo deployment to opt in", () => {
    setEnv("production", "true");
    expect(demoSeedRefusalReason()).toBeNull();
  });

  it("never gets in the way in development or test", () => {
    setEnv("development");
    expect(demoSeedRefusalReason()).toBeNull();
    setEnv("test");
    expect(demoSeedRefusalReason()).toBeNull();
  });
});
