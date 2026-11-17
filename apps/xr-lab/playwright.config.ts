import { defineConfig, devices } from "@playwright/test";

// Fixed port with --strictPort and no server reuse: the tests always run
// against a fresh production build of this checkout, never against a stale
// dev server from another session. If the port is taken, the run fails.
const PORT = 4180;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // One page at a time: headless browsers render WebGL in software, and
  // parallel pages starve each other until interactions time out.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 900 },
        // Headless Firefox on GPU-less Linux cannot create a WebGL context.
        // CI runs this project headed under Xvfb (XR_LAB_FIREFOX_HEADED=1).
        // Test environment only, identical for every integration mode.
        headless: !process.env.XR_LAB_FIREFOX_HEADED,
        launchOptions: {
          firefoxUserPrefs: { "webgl.force-enabled": true },
        },
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
