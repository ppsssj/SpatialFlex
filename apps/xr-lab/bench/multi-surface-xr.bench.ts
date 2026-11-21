import { test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P1-08B3 Multi-Surface XR measurements (`multi-surface-xr.html`).
 *
 * Opt-in, never part of the regression suite or CI:
 *   pnpm --filter @spatialflex/xr-lab exec playwright test \
 *     -c playwright.bench.config.ts multi-surface-xr
 * Cross-origin isolated preview (fine `performance.now()`), production build
 * with test hooks, one page at a time. Results: docs/evidence/p1-08b3/.
 *
 * Per Surface count (2, 3, 5) and layout (side, cross): the camera orbits
 * for FRAMES frames (every frame changes every transform and clip), then
 * POINTER real clicks are made on Surface A. Reported: WorkspaceScene's own
 * timings (depth snapshot, composition incl. DOM writes, whole frame,
 * pointer decision) and the renderer's frame interval.
 */
const FRAMES = 240;
const POINTER = 20;
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/evidence/p1-08b3",
);

const stats = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number) =>
    v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))]! : NaN;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    n: v.length,
    median: r(q(0.5)),
    p95: r(q(0.95)),
    max: r(v[v.length - 1] ?? NaN),
  };
};

type Lab = Record<string, (...a: unknown[]) => unknown>;
const lab = <T>(page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(
    ([m, a]) =>
      (window as unknown as { __multiSurfaceXR: Lab }).__multiSurfaceXR[
        m as string
      ]!(...(a as unknown[])),
    [method, args] as const,
  ) as Promise<T>;

async function open(page: Page, count: number) {
  await page.goto(`/multi-surface-xr.html?surfaces=${count}`);
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(".msx-page[data-depth='resolved']").length ===
      n,
    count,
  );
}

/** Orbits the camera for n frames (each frame changes every clip). */
const orbit = (page: Page, n: number) =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        const probe = (
          window as unknown as {
            __xrHostProbe: {
              setCamera(p: number[], t: number[]): void;
              frameTimes: number[];
            };
          }
        ).__xrHostProbe;
        probe.frameTimes.length = 0;
        let i = 0;
        const step = () => {
          const a = (i / n) * Math.PI * 2;
          probe.setCamera(
            [0.35 * Math.sin(a), 1.5 + 0.1 * Math.cos(a), 1.0],
            [0, 1.4, -1.2],
          );
          if (++i < n) requestAnimationFrame(step);
          else
            requestAnimationFrame(() => {
              probe.setCamera([0, 1.5, 1.0], [0, 1.4, -1.2]);
              requestAnimationFrame(() => done());
            });
        };
        requestAnimationFrame(step);
      }),
    n,
  );

const results: Record<string, unknown>[] = [];

for (const count of [2, 3, 5])
  for (const layout of ["side", "cross"] as const)
    test(`${count} Surfaces, ${layout}`, async ({ page, browserName }) => {
      await open(page, count);
      await page.getByTestId(`layout-${layout}`).check();
      await page.waitForTimeout(500);
      await lab(page, "resetMetrics");
      await orbit(page, FRAMES);
      const m = await lab<{
        resolve: number[];
        compose: number[];
        frame: number[];
      }>(page, "metrics");
      const frameTimes = await page.evaluate(() => [
        ...(window as unknown as { __xrHostProbe: { frameTimes: number[] } })
          .__xrHostProbe.frameTimes,
      ]);
      const inspect = await lab<{
        surfaces: { clipPath: string | null; pieces: number }[];
      }>(page, "inspect");
      // Real pointer decisions: clicks on Surface A's page background.
      await lab(page, "resetMetrics");
      const p = await lab<{ x: number; y: number }>(
        page,
        "point",
        "A",
        80,
        190,
      );
      for (let i = 0; i < POINTER; i++) await page.mouse.click(p.x, p.y);
      const pm = await lab<{ pointer: number[]; counters: object }>(
        page,
        "metrics",
      );
      results.push({
        browser: browserName,
        surfaces: count,
        layout,
        frames: m.frame.length,
        depthSnapshotMs: stats(m.resolve),
        composeMs: stats(m.compose),
        sceneFrameMs: stats(m.frame),
        rendererFrameIntervalMs: stats(frameTimes),
        pointerDecisionMs: stats(pm.pointer),
        clipVertices: inspect.surfaces.map(
          (s) => (s.clipPath?.match(/[ML]/g) ?? []).length,
        ),
        pieces: inspect.surfaces.map((s) => s.pieces),
        counters: pm.counters,
      });
    });

test("lifecycle: 20 remove/re-add cycles of A", async ({
  page,
  browserName,
}) => {
  await open(page, 2);
  await page.getByTestId("A-present").click();
  for (let i = 0; i < 20; i++) {
    await page.getByTestId("toggle-A").click();
    await page.getByTestId("toggle-A").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".msx-page[data-depth='resolved']").length ===
        2,
    );
  }
  const inspect = await lab<{
    hosts: number;
    pages: number;
    captures: number;
    surfaces: unknown[];
  }>(page, "inspect");
  const surfaces = await lab<{ id: string; presentations: number }[]>(
    page,
    "surfaces",
  );
  results.push({
    browser: browserName,
    lifecycle: "20 remove/re-add cycles of A",
    liveSurfaces: inspect.surfaces.length,
    runtimeHosts: inspect.hosts,
    attachedPages: inspect.pages,
    activeGestures: inspect.captures,
    pagesInDocument: await page.locator(".msx-page").count(),
    presentations: surfaces.map((s) => `${s.id}:${s.presentations}`),
  });
});

test.afterAll(async ({ browserName }) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    resolve(OUT, `bench-${browserName}.json`),
    JSON.stringify(
      {
        note: "Exploratory, single machine, software WebGL in headless browsers; not a performance claim or threshold.",
        date: new Date().toISOString(),
        machine: {
          cpu: cpus()[0]?.model,
          cores: cpus().length,
          os: `${platform()} ${release()}`,
        },
        framesPerRun: FRAMES,
        clicksPerRun: POINTER,
        results,
      },
      null,
      2,
    ) + "\n",
  );
});
