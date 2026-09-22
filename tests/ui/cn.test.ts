import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/**
 * `cn()` is tailwind-merge underneath, and tailwind-merge reads any `text-<unknown>` as a text *colour*. Without
 * the font-size registration in src/lib/utils.ts, `cn("text-footnote", "text-muted-foreground")` would silently
 * drop the size and the element would render at whatever it inherited — a bug that shows up only in a browser.
 */
describe("cn()", () => {
  it("keeps a type-scale utility and a text colour together", () => {
    expect(cn("text-footnote", "text-muted-foreground")).toBe("text-footnote text-muted-foreground");
    expect(cn("text-title-2 text-balance text-foreground")).toBe("text-title-2 text-balance text-foreground");
    expect(cn("text-metric-xl", "text-tertiary")).toBe("text-metric-xl text-tertiary");
    expect(cn("text-body-app", "text-link")).toBe("text-body-app text-link");
  });

  it("still treats two type-scale utilities as one size — last wins", () => {
    expect(cn("text-footnote", "text-title-2")).toBe("text-title-2");
    expect(cn("text-body-app", "text-[15px]")).toBe("text-[15px]");
    expect(cn("text-sm", "text-callout")).toBe("text-callout");
  });

  it("still merges colours, and everything else, normally", () => {
    expect(cn("text-muted-foreground", "text-foreground")).toBe("text-foreground");
    expect(cn("h-9 px-4", "h-auto px-0")).toBe("h-auto px-0");
    expect(cn("rounded-full", "rounded-sm")).toBe("rounded-sm");
    expect(cn("p-6", false && "p-0", undefined, ["gap-3"])).toBe("p-6 gap-3");
  });

  it("registers every `@utility text-*` that globals.css defines", async () => {
    const css = await readFile(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    const roles = [...css.matchAll(/@utility text-([a-z0-9-]+) \{/g)].map((m) => m[1]!);
    expect(roles.length).toBeGreaterThan(10);
    for (const role of roles) {
      // If the role were missing from the config, the colour would win and the size class would be dropped.
      expect(cn(`text-${role}`, "text-muted-foreground"), role).toContain(`text-${role}`);
    }
  });

  it("is the only cn in the codebase — no component imports the unconfigured one", async () => {
    const root = new URL("../../src/", import.meta.url);
    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(new URL(dir, root), { withFileTypes: true });
      const nested = await Promise.all(
        entries.map(async (e) =>
          e.isDirectory() ? walk(`${dir}${e.name}/`) : e.name.endsWith(".tsx") || e.name.endsWith(".ts") ? [`${dir}${e.name}`] : [],
        ),
      );
      return nested.flat();
    }
    for (const file of await walk("")) {
      if (file === "lib/utils.ts") continue;
      const source = await readFile(new URL(file, root), "utf8");
      expect(source, file).not.toMatch(/from ["']cn["']/);
    }
  });
});
