import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [
      "packages/react/**/*.{ts,tsx}",
      "apps/playground/**/*.{ts,tsx}",
      "apps/xr-lab/src/**/*.{ts,tsx}",
    ],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  // XR Lab dependency direction: only the SpatialFlex integration may use the
  // SDK, and the neutral XR host depends on nothing in the lab.
  ...xrLabBoundaries({
    "apps/xr-lab/src/bridge/**": [
      "@spatialflex/*",
      "**/fixtures",
      "**/fixtures/**",
      "**/integrations/**",
      "**/shell/**",
    ],
    // Renderer-neutral contract: no engine, app, SDK or integration.
    "apps/xr-lab/src/contracts/**": [
      "@spatialflex/*",
      "three",
      "three/**",
      "@react-three/*",
      "@babylonjs/*",
      "**/fixtures",
      "**/fixtures/**",
      "**/integrations/**",
      "**/hosts/**",
      "**/shell/**",
      "**/devtools/**",
    ],
    // Shared host code (2D faces, DOM toolbar): no rendering engine.
    "apps/xr-lab/src/hosts/shared/**": [
      "@spatialflex/*",
      "three",
      "three/**",
      "@react-three/*",
      "@babylonjs/*",
      "**/hosts/three",
      "**/hosts/three/**",
      "**/hosts/babylon",
      "**/hosts/babylon/**",
      "../three",
      "../three/**",
      "../babylon",
      "../babylon/**",
      "**/fixtures/**",
      "**/integrations/**",
      "**/shell/**",
      "**/devtools/**",
    ],
    // Each engine depends on the contract and shared host code only.
    "apps/xr-lab/src/hosts/three/**": [
      "@spatialflex/*",
      "@babylonjs/*",
      "**/hosts/babylon",
      "**/hosts/babylon/**",
      "../babylon",
      "../babylon/**",
      "**/fixtures/**",
      "**/integrations/**",
      "**/shell/**",
      "**/devtools/**",
    ],
    "apps/xr-lab/src/hosts/babylon/**": [
      "@spatialflex/*",
      "three",
      "three/**",
      "@react-three/*",
      "**/hosts/three",
      "**/hosts/three/**",
      "../three",
      "../three/**",
      "**/fixtures/**",
      "**/integrations/**",
      "**/shell/**",
      "**/devtools/**",
    ],
    "apps/xr-lab/src/fixtures/**": [
      "@spatialflex/*",
      "three",
      "three/**",
      "@react-three/*",
      "@babylonjs/*",
      "**/contracts/**",
      "**/hosts/**",
      "**/integrations/**",
      "**/shell/**",
    ],
    // Integrations talk to hosts only through the contract.
    "apps/xr-lab/src/integrations/{contract.ts,common/**,baseline/**}": [
      "@spatialflex/*",
      "three",
      "three/**",
      "@react-three/*",
      "@babylonjs/*",
      "**/hosts/**",
      "**/spatialflex",
      "**/spatialflex/**",
    ],
    "apps/xr-lab/src/integrations/spatialflex/**": [
      "three",
      "three/**",
      "@react-three/*",
      "@babylonjs/*",
      "**/hosts/**",
    ],
    "apps/xr-lab/src/{shell,devtools}/**": [
      "@spatialflex/*",
      "three",
      "three/**",
      "@react-three/*",
      "@babylonjs/*",
      "**/hosts/**",
      "**/integrations/baseline",
      "**/integrations/spatialflex",
    ],
  }),
  {
    files: ["apps/xr-lab/scripts/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);

function xrLabBoundaries(rules) {
  return Object.entries(rules).map(([files, group]) => ({
    files: [files],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group,
              message:
                "Breaks the XR Lab dependency direction (see docs/xr-lab.md).",
            },
          ],
        },
      ],
    },
  }));
}
