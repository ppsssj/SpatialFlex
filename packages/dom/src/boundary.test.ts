/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The SDK runtime must stay renderer-neutral: neither the DOM runtime nor
// core may import React, Three.js or Babylon.js, or declare them.
const packages = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FORBIDDEN =
  /^(react|react-dom|three|@react-three\/|@babylonjs\/|@spatialflex\/react)/;

// Every non-test source, subdirectories included (P1-08A added
// core/src/workspace).
const sources = (pkg: string) =>
  readdirSync(join(packages, pkg, "src"), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(packages, pkg, "src", f), "utf8"));

describe("SDK runtime boundary", () => {
  it.each(["core", "dom"])("%s imports no framework or renderer", (pkg) => {
    const specifiers = sources(pkg).flatMap((code) =>
      [...code.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1]!),
    );
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => FORBIDDEN.test(s))).toEqual([]);
    // Relative imports carry explicit extensions (Node ESM).
    expect(
      specifiers.filter((s) => s.startsWith(".") && !s.endsWith(".js")),
    ).toEqual([]);
  });

  it.each(["core", "dom"])("%s declares no framework or renderer", (pkg) => {
    const manifest = JSON.parse(
      readFileSync(join(packages, pkg, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    });
    expect(declared.filter((d) => FORBIDDEN.test(d))).toEqual([]);
  });

  // P1-08A A8: the Multi-Surface primitives are renderer-, framework- and
  // DOM-free, and depend on core modules only.
  it("core/src/workspace depends on relative core modules only", () => {
    const dir = join(packages, "core", "src", "workspace");
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = readFileSync(join(dir, file), "utf8");
      for (const [, specifier] of code.matchAll(/from\s+"([^"]+)"/g))
        expect(specifier, `${file}: ${specifier}`).toMatch(
          /^\.\.?\/[\w./]+\.js$/,
        );
      // Code only (comments may mention documents and the DOM).
      const code_ = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code_, file).not.toMatch(
        /\b(HTMLElement|Element|Document|document|window|EventTarget)\b/,
      );
    }
  });
});
