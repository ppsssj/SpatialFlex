import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./bench",
  testMatch: "**/*.react-ownership.spec.ts",
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4188",
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4188 --strictPort",
    url: "http://127.0.0.1:4188/research-react-ownership.html",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
