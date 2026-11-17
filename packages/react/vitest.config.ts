import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      // Resolve workspace packages to their TypeScript sources so tests do
      // not depend on packages/* having been built. The remaining entries are
      // Vite's default server conditions, which this option replaces.
      conditions: ["source", "module", "node", "development|production"],
    },
  },
});
