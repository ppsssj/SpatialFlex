import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Deliberately plain: no `source` condition and no aliases. SpatialFlex is
// resolved through its package exports (the built `dist`), exactly as an
// application outside this repository resolves it.
export default defineConfig({
  plugins: [react()],
});
