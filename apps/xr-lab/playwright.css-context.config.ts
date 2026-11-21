import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./bench",
  testMatch: "**/*.css-context.spec.ts",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4187",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4187 --strictPort",
    url: "http://127.0.0.1:4187/research-css-context.html",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
