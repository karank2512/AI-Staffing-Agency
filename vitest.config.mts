import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Tests always run against the dedicated test database in Simulated mode.
dotenv.config({ path: path.resolve(import.meta.dirname, ".env.test"), override: true, quiet: true });

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    setupFiles: ["tests/setup/env.ts"],
    passWithNoTests: true,
    // DB-backed tests share one Postgres database; isolation is per-organization (see tests/helpers/factory.ts).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // next-auth imports "next/server" without an extension, which Node ESM can't resolve when externalized.
    server: { deps: { inline: [/next-auth/, /@auth\/core/] } },
  },
});
