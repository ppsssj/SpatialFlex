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
    "apps/xr-lab/src/host/**": [
      "@spatialflex/*",
      "**/fixtures",
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
      "**/host",
      "**/host/**",
      "**/integrations/**",
      "**/shell/**",
    ],
    "apps/xr-lab/src/integrations/{contract.ts,common/**,baseline/**}": [
      "@spatialflex/*",
      "**/spatialflex",
      "**/spatialflex/**",
    ],
    "apps/xr-lab/src/{shell,devtools}/**": [
      "@spatialflex/*",
      "**/integrations/baseline",
      "**/integrations/spatialflex",
    ],
  }),
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
