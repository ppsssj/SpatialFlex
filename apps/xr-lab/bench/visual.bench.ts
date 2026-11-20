import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * P1-07D visual evidence. Opt-in and skipped in every other benchmark run:
 *
 *   BENCH_VISUAL=1 npx playwright test -c playwright.bench.config.ts
 *     bench/visual.bench.ts
 *
 * Captures the rendered Adaptive panel faces of a fixed, deterministic
 * scene state as PNG files (BENCH_VISUAL_OUT) and, when
 * BENCH_VISUAL_BASELINE names an earlier capture of another build,
 * measures the per-pixel difference from it (decoded in the browser; same
 * browser and viewport only).
 *
 * States: `values` (5 panels, tick 37), `hovered` (panel 2's "+1" button
 * under the pointer), `selected` (panel 2 selected).
 */

const OUT = process.env.BENCH_VISUAL_OUT ?? "../../bench-results/visual";
const BASELINE = process.env.BENCH_VISUAL_BASELINE ?? "";
const ENGINES = (process.env.BENCH_ENGINES ?? "three,babylon").split(",");
const PANELS = 5;
const TICK = 37;

test.skip(!process.env.BENCH_VISUAL, "visual evidence is opt-in");

type Point = { x: number; y: number };
type Probe = {
  worldPosition(id: string, part: string): number[] | null;
  project(p: number[]): Point | null;
  locate(id: string, part: string): Point | null;
  hovered(id: string, part: string): boolean;
  drawn: Record<string, { text: string }>;
};
type Bench = {
  setCamera(p: number[], t: number[]): boolean;
  extractAll(kind: string): boolean[];
  validate(kind: string): { issues: string[] };
  data: { step(): void };
};

const frames = (page: Page, n: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const next = () =>
          --left <= 0 ? resolve() : requestAnimationFrame(next);
        requestAnimationFrame(next);
      }),
    n,
  );

/** The screen rectangle that contains every panel face. */
async function region(page: Page) {
  const points = await page.evaluate((n) => {
    const p = (window as unknown as { __xrHostProbe: Probe }).__xrHostProbe;
    const out: Point[] = [];
    for (let i = 1; i <= n; i++) {
      const c = p.worldPosition(`bench-${i}`, "background")!;
      for (const [dx, dy] of [
        [-0.32, -0.22],
        [0.32, 0.22],
      ])
        out.push(p.project([c[0]! + dx!, c[1]! + dy!, c[2]!])!);
    }
    return out;
  }, PANELS);
  const x = Math.floor(Math.min(...points.map((p) => p.x)));
  const y = Math.floor(Math.min(...points.map((p) => p.y)));
  return {
    x,
    y,
    width: Math.ceil(Math.max(...points.map((p) => p.x))) - x,
    height: Math.ceil(Math.max(...points.map((p) => p.y))) - y,
  };
}

async function compare(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([first, second]) => {
      const decode = async (data: string) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${data}`)).blob(),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([decode(first), decode(second)]);
      if (x.width !== y.width || x.height !== y.height)
        return { sameSize: false };
      const hist = [0, 0, 0, 0, 0]; // max channel diff: 0, 1-2, 3-8, 9-32, >32
      let sum = 0;
      let max = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        let m = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(x.data[i + c]! - y.data[i + c]!);
          sum += d;
          if (d > m) m = d;
        }
        if (m > max) max = m;
        hist[m === 0 ? 0 : m <= 2 ? 1 : m <= 8 ? 2 : m <= 32 ? 3 : 4]!++;
      }
      const pixels = x.data.length / 4;
      return {
        sameSize: true,
        pixels,
        meanAbsChannel: sum / (pixels * 3),
        maxChannel: max,
        share: {
          identical: hist[0]! / pixels,
          upTo2: hist[1]! / pixels,
          upTo8: hist[2]! / pixels,
          upTo32: hist[3]! / pixels,
          over32: hist[4]! / pixels,
        },
      };
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

for (const engine of ENGINES) {
  test(`visual ${engine}`, async ({ page, browserName }) => {
    const dir = OUT;
    mkdirSync(dir, { recursive: true });
    await page.goto(
      `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=website&fixture=benchmark&panels=${PANELS}`,
    );
    await expect
      .poll(() => page.evaluate(() => "__spatialBench" in window))
      .toBe(true);
    // The same camera in every engine, once the host's camera exists.
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { __spatialBench: Bench }
          ).__spatialBench.setCamera([0, 1.42, 4], [0, 1.42, -0.4]),
        ),
      )
      .toBe(true);
    await page.mouse.move(2, 2);
    await page.evaluate((tick) => {
      const b = (window as unknown as { __spatialBench: Bench }).__spatialBench;
      for (let i = 0; i < tick; i++) b.data.step();
      b.extractAll("adaptive");
    }, TICK);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as { __spatialBench: Bench }
            ).__spatialBench.validate("adaptive").issues,
        ),
      )
      .toEqual([]);
    await frames(page, 10);
    const clip = await region(page);
    const results: Record<string, unknown> = { engine, browserName, clip };
    const shot = async (state: string) => {
      await frames(page, 10);
      const png = await page.screenshot({ clip });
      const name = `${browserName}-${engine}-${state}.png`;
      writeFileSync(join(dir, name), png);
      if (BASELINE && existsSync(join(BASELINE, name)))
        results[state] = await compare(
          page,
          png,
          readFileSync(join(BASELINE, name)),
        );
    };
    await shot("values");
    const button = (await page.evaluate(() =>
      (window as unknown as { __xrHostProbe: Probe }).__xrHostProbe.locate(
        "bench-2",
        "button:bump",
      ),
    ))!;
    await page.mouse.move(button.x, button.y);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __xrHostProbe: Probe }).__xrHostProbe.hovered(
            "bench-2",
            "button:bump",
          ),
        ),
      )
      .toBe(true);
    await shot("hovered");
    const face = (await page.evaluate(() =>
      (window as unknown as { __xrHostProbe: Probe }).__xrHostProbe.locate(
        "bench-2",
        "background",
      ),
    ))!;
    await page.mouse.click(face.x, face.y - 40);
    await page.mouse.move(2, 2);
    await shot("selected");
    writeFileSync(
      join(dir, `${browserName}-${engine}.json`),
      `${JSON.stringify(results, null, 2)}\n`,
    );
  });
}
