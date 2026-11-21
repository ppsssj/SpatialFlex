import { defineConfig, devices } from "@playwright/test";

/**
 * P1-08A2 unified depth research benchmark (`pnpm research:depth` in
 * apps/xr-lab). Separate from the regression suite and from the P1-07C
 * benchmark (`playwright.bench.config.ts` runs only *.bench.ts): never part
 * of `pnpm test:e2e`, `pnpm bench:spatial` or any CI job. Cross-origin
 * isolated preview for fine timers, as the P1-07C benchmark.
 */
const PORT = 4184;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const viewport = { width: 1000, height: 700 };

export default defineConfig({
  testDir: "./bench",
  testMatch: /.*\.research\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60 * 60_000,
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
