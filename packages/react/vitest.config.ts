import { defineConfig } from "vitest/config";

// Resolve workspace packages to their TypeScript sources so tests do not
// depend on packages/* having been built. These options replace Vite's
// default conditions, so the defaults are repeated after "source".
export default defineConfig({
  resolve: {
    // Used by tests in the jsdom environment.
    conditions: ["source", "module", "browser", "development|production"],
  },
  ssr: {
    resolve: {
      // Used by tests in the node environment.
      conditions: ["source", "module", "node", "development|production"],
    },
  },
});
