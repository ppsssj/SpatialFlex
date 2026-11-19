import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input: { app: "index.html", host: "host.html" } },
    // The bundled WebXR emulator (IWER) and its optional rooms are large,
    // lazily loaded chunks.
    chunkSizeWarningLimit: 2500,
  },
  // P1-07C benchmark only (XR_LAB_ISOLATED=1): a cross-origin isolated
  // preview, so performance.now() has fine resolution in every browser.
  // Ordinary builds, tests and previews are unchanged.
  preview:
    process.env.XR_LAB_ISOLATED === "1"
      ? {
          headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
          },
        }
      : {},
  resolve: {
    // Resolve workspace packages to their TypeScript sources so the
    // XR Lab runs without building packages/* first.
    conditions: ["source", ...defaultClientConditions],
  },
});
