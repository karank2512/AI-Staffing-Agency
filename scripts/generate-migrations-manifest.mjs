#!/usr/bin/env node
/**
 * Bakes the list of migration directory names into `src/generated/migrations.json` at build time (npm `prebuild`).
 *
 * `/api/ready` compares this list against `_prisma_migrations` in the database, so a container that boots against
 * a database the release job has not migrated yet reports "not ready" instead of serving requests that will fail
 * on a missing column. The file is committed so `tsc`, tests and `next dev` work without running a build first.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "prisma", "migrations");
const outFile = join(root, "src", "generated", "migrations.json");

const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const next = `${JSON.stringify({ migrations }, null, 2)}\n`;

let current = "";
try {
  current = readFileSync(outFile, "utf8");
} catch {
  // First run: the file does not exist yet.
}

if (current === next) {
  console.log(`migrations manifest up to date (${migrations.length} migrations)`);
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, next);
  console.log(`wrote src/generated/migrations.json (${migrations.length} migrations)`);
}
