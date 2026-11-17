import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve workspace packages to their TypeScript sources so the
    // playground runs without building packages/* first.
    conditions: ["source", ...defaultClientConditions],
  },
});
