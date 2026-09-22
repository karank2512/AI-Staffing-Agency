import { config } from "@/server/config";

/**
 * The demo seed rebuilds a workspace with a publicly documented password (see `DEMO_USER`). That is exactly what
 * a demo needs and exactly what a production database must never contain, so the CLI refuses to run there unless
 * the operator has deliberately opted in with `ALLOW_DEMO_SEED=true` — the same flag that decides whether the
 * sign-in page offers the demo credentials.
 *
 * `seedDemo()` itself is unguarded: tests import it directly and run with `NODE_ENV=test`.
 */
export function demoSeedRefusalReason(): string | null {
  if (config.auth.allowDemoSeed) return null;
  return (
    "Refusing to seed demo data: NODE_ENV=production and ALLOW_DEMO_SEED is not set.\n" +
    "The demo workspace ships a publicly known password, so it must never be created in a real deployment.\n" +
    "If this really is a demo deployment, re-run with ALLOW_DEMO_SEED=true."
  );
}
