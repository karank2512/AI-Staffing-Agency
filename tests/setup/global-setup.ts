import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Apply migrations to the test database once per test run. Several agents/processes may run suites
 * concurrently against the same DB, so tolerate the advisory-lock race with a short retry.
 */
export default async function globalSetup() {
  const root = path.resolve(__dirname, "../..");
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error(`Refusing to run tests: DATABASE_URL must point at a *_test database (got ${process.env.DATABASE_URL})`);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execSync("npx prisma migrate deploy", { cwd: root, stdio: "pipe", env: process.env });
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastError;
}
