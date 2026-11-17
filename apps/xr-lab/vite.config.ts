import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // The bundled WebXR emulator (IWER) and its optional rooms are large,
    // lazily loaded chunks.
    chunkSizeWarningLimit: 2500,
  },
  resolve: {
    // Resolve workspace packages to their TypeScript sources so the
    // XR Lab runs without building packages/* first.
    conditions: ["source", ...defaultClientConditions],
  },
});
