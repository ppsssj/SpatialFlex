import { defineConfig, devices } from "@playwright/test";

// The reference consumer is tested from its production build. By default
// it is built and previewed here; the package smoke test (scripts/
// pack-smoke.mjs at the repository root) instead serves a copy built
// outside the workspace from packed tarballs and sets CONSUMER_BASE_URL.
// Not 4190: Firefox blocks that port (ManageSieve) as unsafe.
const PORT = 4186;
const external = process.env.CONSUMER_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 900 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1400, height: 900 },
        // As in the XR Lab: GPU-less Linux CI runs Firefox headed under Xvfb.
        headless: !process.env.XR_LAB_FIREFOX_HEADED,
        launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true } },
      },
    },
  ],
  webServer: external
    ? undefined
    : {
        // In this repository the SDK packages are built first: the app
        // resolves them through their package exports (dist), never sources.
        command: `pnpm --dir ../.. -r --filter "./packages/*" build && pnpm build && pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
