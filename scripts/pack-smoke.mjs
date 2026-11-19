#!/usr/bin/env node
// P1-07B package-consumption smoke test (E6).
//
// Proves that an application outside this pnpm workspace can consume the
// SpatialFlex packages from their packed artifacts, not from monorepo
// sources:
//  1. build @spatialflex/core, /dom and /react and `pnpm pack` them;
//  2. check each tarball (workspace:* rewritten, exports present, no src);
//  3. copy the reference consumer's *application* sources (no XR Lab code)
//     into a new directory under the OS temp dir, outside the workspace;
//  4. `npm install` the tarballs and the public third-party packages;
//  5. check Node ESM resolution and that every SDK import resolves inside
//     that directory's node_modules;
//  6. typecheck against the emitted declarations (skipLibCheck off);
//  7. production build; check the bundle for repository paths;
//  8. serve the build and run the consumer's E1/E5 browser tests on it.
//
// Usage: node scripts/pack-smoke.mjs [--skip-browser]
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const example = join(root, "examples/external-react-consumer");
// Evidence of the current milestone (earlier milestones keep their own).
const evidence = join(
  root,
  process.env.SMOKE_EVIDENCE ?? "docs/evidence/p1-07b2",
);
const skipBrowser = process.argv.includes("--skip-browser");
const PACKAGES = ["core", "dom", "react"];
const isWindows = process.platform === "win32";
const report = { steps: [] };

function run(command, args, cwd, options = {}) {
  console.log(
    `\n$ ${command} ${args.join(" ")}   (${relative(root, cwd) || "."})`,
  );
  return execFileSync(command, args, {
    cwd,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    shell: isWindows,
    env: { ...process.env, ...options.env },
  });
}
const step = (name, details = {}) => {
  report.steps.push({ name, ok: true, ...details });
  console.log(`✔ ${name}`);
};
const fail = (message) => {
  console.error(`✘ ${message}`);
  report.failure = message;
  writeReport();
  process.exit(1);
};
function writeReport() {
  mkdirSync(evidence, { recursive: true });
  writeFileSync(
    join(evidence, "pack-smoke.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

// 1. Build and pack.
const work = mkdtempSync(join(tmpdir(), "spatialflex-consumer-"));
if (relative(root, work).split(/[\\/]/)[0] !== "..")
  fail(`work directory ${work} is inside the repository`);
report.workDirectoryOutsideRepository = true;
const tarballs = join(work, "tarballs");
mkdirSync(tarballs);
run("pnpm", ["-r", "--filter", "./packages/*", "build"], root);
const packed = {};
for (const name of PACKAGES) {
  run(
    "pnpm",
    ["pack", "--pack-destination", tarballs],
    join(root, "packages", name),
  );
  const file = readdirSync(tarballs).find((f) =>
    f.startsWith(`spatialflex-${name}-`),
  );
  if (!file) fail(`no tarball for @spatialflex/${name}`);
  packed[name] = file;
}
step("built and packed", { tarballs: packed });

// 2. Inspect the tarballs.
for (const [name, file] of Object.entries(packed)) {
  const listing = run("tar", ["-tzf", file], tarballs, { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  const manifest = JSON.parse(
    run("tar", ["-xzOf", file, "package/package.json"], tarballs, {
      capture: true,
    }),
  );
  const deps = { ...manifest.dependencies, ...manifest.peerDependencies };
  const workspaceRefs = Object.entries(deps).filter(([, v]) =>
    String(v).startsWith("workspace:"),
  );
  if (workspaceRefs.length)
    fail(
      `${name}: unresolved workspace dependencies ${JSON.stringify(workspaceRefs)}`,
    );
  const entry = manifest.exports["."];
  for (const [subpath, exported] of Object.entries(manifest.exports))
    for (const target of [exported.types, exported.default])
      if (!listing.includes(`package/${target.replace(/^\.\//, "")}`))
        fail(
          `${name}${subpath.slice(1)}: export target ${target} is not in the tarball`,
        );
  if (listing.some((f) => f.startsWith("package/src/")))
    fail(`${name}: sources are packed`);
  step(`tarball @spatialflex/${name}`, {
    files: listing.length,
    dependencies: manifest.dependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    exports: manifest.exports,
    note: entry.source
      ? "The `source` export condition points to ./src (not packed); only workspace tooling that opts into the condition uses it."
      : undefined,
  });
}

// 3. The consumer application, copied without any XR Lab code.
const app = join(work, "app");
mkdirSync(app);
for (const entry of [
  "src",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.node.json",
])
  cpSync(join(example, entry), join(app, entry), { recursive: true });
const source = JSON.parse(readFileSync(join(example, "package.json"), "utf8"));
const tarballSpec = (name) => `file:../tarballs/${packed[name]}`;
const dependencies = { ...source.dependencies };
for (const name of PACKAGES)
  dependencies[`@spatialflex/${name}`] = tarballSpec(name);
writeFileSync(
  join(app, "package.json"),
  `${JSON.stringify(
    {
      name: "spatialflex-external-consumer",
      private: true,
      type: "module",
      dependencies,
      devDependencies: Object.fromEntries(
        Object.entries(source.devDependencies).filter(
          ([name]) => name !== "@playwright/test",
        ),
      ),
      // Inter-package dependencies ("@spatialflex/core": "0.0.0") resolve
      // to the same local tarballs: nothing is published.
      overrides: {
        "@spatialflex/core": "$@spatialflex/core",
        "@spatialflex/dom": "$@spatialflex/dom",
      },
    },
    null,
    2,
  )}\n`,
);
const appSources = readdirSync(join(app, "src"), { recursive: true })
  .filter((f) => /\.(ts|tsx)$/.test(String(f)))
  .map((f) => readFileSync(join(app, "src", String(f)), "utf8"));
const imports = [
  ...new Set(
    appSources.flatMap((code) =>
      [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]),
    ),
  ),
].sort();
const forbidden = imports.filter(
  (s) => s.includes("xr-lab") || s.startsWith("../../") || s.includes("/src/"),
);
if (forbidden.length) fail(`forbidden imports: ${forbidden.join(", ")}`);
step("consumer copied outside the workspace", {
  sdkImports: imports.filter((s) => s.startsWith("@spatialflex/")),
});

// 4. Install with npm (no workspace, no pnpm links).
run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], app);
step("installed from tarballs", {
  installed: Object.fromEntries(
    PACKAGES.map((name) => [
      `@spatialflex/${name}`,
      JSON.parse(
        readFileSync(
          join(app, "node_modules/@spatialflex", name, "package.json"),
          "utf8",
        ),
      ).version,
    ]),
  ),
});

// One React runtime: the SDK packages must use the application's React
// (a peer dependency), never a nested copy.
const nestedReact = PACKAGES.flatMap((name) =>
  ["react", "react-dom"].filter((dep) =>
    existsSync(
      join(app, "node_modules/@spatialflex", name, "node_modules", dep),
    ),
  ),
);
if (nestedReact.length)
  fail(`nested React copies under the SDK: ${nestedReact.join(", ")}`);
step("single React runtime (no nested copy under @spatialflex/*)");

// 5. Resolution: Node ESM, inside this directory.
writeFileSync(
  join(app, "check-resolution.mjs"),
  `const out = {};
for (const name of ["@spatialflex/core", "@spatialflex/dom", "@spatialflex/react", "@spatialflex/react/spatial"]) {
  const url = import.meta.resolve(name);
  const module = await import(name);
  out[name] = { url, exports: Object.keys(module).length };
}
console.log(JSON.stringify(out));
`,
);
const resolution = run("node", ["check-resolution.mjs"], app, {
  capture: true,
});
const resolved = JSON.parse(resolution.trim().split(/\r?\n/).at(-1));
for (const [name, { url }] of Object.entries(resolved)) {
  const path = fileURLToPath(url);
  if (!path.startsWith(join(app, "node_modules")) || /xr-lab/.test(path))
    fail(`${name} resolves outside the app: ${path}`);
  if (path.startsWith(root)) fail(`${name} resolves into the repository`);
}
step("Node ESM resolution inside the app's node_modules", {
  // Relative to the app directory (absolute temp paths are machine-specific).
  resolved: Object.fromEntries(
    Object.entries(resolved).map(([name, { url, exports }]) => [
      name,
      {
        path: relative(app, fileURLToPath(url)).replaceAll("\\", "/"),
        exports,
      },
    ]),
  ),
});

// 6. TypeScript against the emitted declarations.
run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], app);
step("typecheck against emitted declarations (skipLibCheck: false)");

// 7. Production build.
run("npx", ["vite", "build"], app);
const bundle = readdirSync(join(app, "dist/assets"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(app, "dist/assets", f), "utf8"))
  .join("\n");
const leaks = ["apps/xr-lab", "xr-lab/src", root.replaceAll("\\", "/")].filter(
  (needle) => bundle.includes(needle),
);
if (leaks.length) fail(`bundle references the repository: ${leaks.join(", ")}`);
if (!bundle.includes("data-spatial-visibility"))
  fail("bundle does not contain the SpatialFlex DOM runtime");
step("production build", { bundleBytes: bundle.length });

// 8. Runtime: the consumer's browser tests against this build.
if (!skipBrowser) {
  const port = 4187;
  const vite = join(app, "node_modules/vite/bin/vite.js");
  const server = spawn(
    process.execPath,
    [
      vite,
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: app, stdio: "ignore" },
  );
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base)).ok) break;
      } catch {
        // not up yet
      }
      if (i > 60) fail("preview server did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
    run(
      "npx",
      ["playwright", "test", "-g", "E[15] ", "--project=chromium"],
      example,
      {
        env: {
          CONSUMER_BASE_URL: base,
          CONSUMER_EVIDENCE: join(work, "evidence"),
        },
      },
    );
    step("browser tests E1 and E5 against the packaged build (Chromium)");
  } finally {
    server.kill();
  }
}

report.ok = true;
writeReport();
if (existsSync(work)) rmSync(work, { recursive: true, force: true });
console.log("\nPackage smoke test passed.");
