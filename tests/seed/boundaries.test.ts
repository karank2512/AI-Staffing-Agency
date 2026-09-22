import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The seed runs outside Next (`tsx prisma/seed.ts`), so a broken import only shows up at `npm run setup`. This
 * keeps it on the module contract: public indexes, typed contracts and the password helper — nothing else. The
 * engine helpers it replays runs with (prompts, clipping, titles, the report builder and the deliverable summary,
 * trace shapes) are re-exported by `@/server/runtime` and `@/server/models`, so there is no deep-import seam left.
 */

const ROOT = path.resolve(__dirname, "../..");

/**
 * Deep engine imports the seed may still make. Empty: adding one is a deliberate, reviewed change — ask the owning
 * module to export the helper from its index.ts first.
 */
const SANCTIONED_INTERNALS: readonly string[] = [];

function seedFiles(): string[] {
  const dir = path.join(ROOT, "prisma/seed");
  const nested = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.posix.join("prisma/seed", f.split(path.sep).join("/")));
  return ["prisma/seed.ts", ...nested].sort();
}

/** Every module specifier in a file: static imports/re-exports (multi-line too), side-effect and dynamic imports. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  const patterns = [/\b(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** Allowed from any seed file by docs/CONTRACTS.md: a module index, a types/schemas contract, or auth/password. */
function isPublic(specifier: string): boolean {
  if (!specifier.startsWith("@/server/")) return true;
  const rest = specifier.slice("@/server/".length).split("/");
  if (rest.length === 1) return true;
  if (rest[0] === "domain") return true;
  const leaf = rest.at(-1);
  return leaf === "types" || leaf === "schemas" || specifier === "@/server/auth/password";
}

describe("seed module boundaries", () => {
  it("parses the import forms the seed uses", () => {
    const source = [
      'import "dotenv/config";',
      'import { a,\n  b } from "@/server/runtime/compact";',
      'import type { C } from "@/server/models/types";',
      'export { d, type E } from "@/server/runtime/messages";',
      'const f = await import("@/server/models/persist");',
    ].join("\n");
    expect(specifiersOf(source).sort()).toEqual(["@/server/models/persist", "@/server/models/types", "@/server/runtime/compact", "@/server/runtime/messages", "dotenv/config"]);
    expect(isPublic("@/server/runtime")).toBe(true);
    expect(isPublic("@/server/db")).toBe(true);
    expect(isPublic("@/server/runtime/types")).toBe(true);
    expect(isPublic("@/server/tools/schemas")).toBe(true);
    expect(isPublic("@/server/auth/password")).toBe(true);
    expect(isPublic("@/server/runtime/compact")).toBe(false);
    expect(isPublic("@/server/models/persist")).toBe(false);
  });

  it("imports server modules only through their public surface", () => {
    const files = seedFiles();
    expect(files).toContain("prisma/seed/trace.ts");
    const violations = files.flatMap((file) =>
      specifiersOf(readFileSync(path.join(ROOT, file), "utf8"))
        .filter((s) => !isPublic(s) && !SANCTIONED_INTERNALS.includes(s))
        .map((s) => `${file} → ${s}`),
    );
    expect(violations).toEqual([]);
  });
});
