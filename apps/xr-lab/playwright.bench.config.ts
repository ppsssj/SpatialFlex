import { defineConfig, devices } from "@playwright/test";

/**
 * P1-07C performance benchmark (`pnpm bench:spatial`). Separate from the
 * regression suite (`playwright.config.ts`, testDir ./e2e): never part of
 * `pnpm test:e2e` or the required CI job. One page at a time, a production
 * build with test hooks, a cross-origin isolated preview for fine timers.
 */
const PORT = 4183;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const viewport = { width: 1280, height: 900 };

export default defineConfig({
  testDir: "./bench",
  testMatch: /.*\.bench\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    viewport,
    deviceScaleFactor: 1,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        deviceScaleFactor: 1,
        // BENCH_HEADED=1: a headed browser (hardware GPU where available).
        headless: !process.env.BENCH_HEADED,
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport,
        deviceScaleFactor: 1,
        headless:
          !process.env.XR_LAB_FIREFOX_HEADED && !process.env.BENCH_HEADED,
        launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true } },
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    env: { VITE_XR_LAB_TEST_HOOKS: "1", XR_LAB_ISOLATED: "1" },
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
