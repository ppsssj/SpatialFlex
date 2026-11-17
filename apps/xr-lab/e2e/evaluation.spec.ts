import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  incrementCalls,
  locate,
  MODES,
  openLab,
  probe,
  showInXR,
  watchConsole,
  webCount,
} from "./lab";

// Comparative measurements: the same workload, browser and configuration in
// every mode. The test asserts correctness only (no duplicated actions, no
// errors); the numbers are recorded as JSON attachments for comparison and
// must not be read as a performance claim from a single run.

const CLICKS = 20;
const IDLE_SAMPLE_MS = 3000;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN;
};
const p95 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!
    : NaN;
};
const round = (value: number) => Math.round(value * 10) / 10;

for (const mode of MODES) {
  test(`evaluation — ${mode}`, async ({ page, browserName }, info) => {
    // 20 clicks, a 3 s sampling window and a cold software-GL start.
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await openLab(page, mode);
    await showInXR(page, "shared-counter");
    await showInXR(page, "live-chart");

    // Timestamps (performance.now, in the page) of the pointer press on the
    // canvas, the web counter's DOM update and the 3D panel's redraw.
    await page.evaluate(() => {
      const w = window as unknown as {
        __eval: { down: number[]; web: number[] };
      };
      w.__eval = { down: [], web: [] };
      document
        .querySelector("canvas")!
        .addEventListener(
          "pointerdown",
          () => w.__eval.down.push(performance.now()),
          { capture: true },
        );
      const counter = document.querySelector('[data-testid="web-count"]')!;
      new MutationObserver(() => w.__eval.web.push(performance.now())).observe(
        counter,
        {
          childList: true,
          characterData: true,
          subtree: true,
        },
      );
    });

    const xrDrawn: number[] = [];
    for (let i = 1; i <= CLICKS; i++) {
      const { x, y } = await locate(page, "shared-counter", "button:increment");
      await page.mouse.click(x, y);
      await expect(webCount(page)).toHaveText(String(i));
      await expect
        .poll(async () => (await probe(page, "drawn"))["shared-counter"]?.text)
        .toBe(`Shared count=${i}`);
      xrDrawn.push((await probe(page, "drawn"))["shared-counter"]!.at);
    }
    await expect(incrementCalls(page)).toHaveText(String(CLICKS));

    const timing = await page.evaluate(
      () =>
        (window as unknown as { __eval: { down: number[]; web: number[] } })
          .__eval,
    );
    const webLatency = timing.web.map((t, i) => t - timing.down[i]!);
    const xrLatency = xrDrawn.map((t, i) => t - timing.down[i]!);

    // Idle frame times with two panels shown. This wait is a measurement
    // window, not synchronization.
    await page.evaluate(() => {
      (
        window as unknown as { __xrHostProbe: { frameTimes: number[] } }
      ).__xrHostProbe.frameTimes = [];
    });
    await page.waitForTimeout(IDLE_SAMPLE_MS);
    const frameTimes = await probe(page, "frameTimes");

    const resources = await page.evaluate(() => {
      const scripts = performance
        .getEntriesByType("resource")
        .filter((entry) =>
          entry.name.endsWith(".js"),
        ) as PerformanceResourceTiming[];
      const memory = (
        performance as unknown as { memory?: { usedJSHeapSize: number } }
      ).memory;
      return {
        scripts: scripts.length,
        scriptBytes: scripts.reduce(
          (sum, entry) => sum + entry.decodedBodySize,
          0,
        ),
        usedJSHeapSize: memory?.usedJSHeapSize ?? null,
      };
    });

    const result = {
      mode,
      browser: browserName,
      repeat: info.repeatEachIndex,
      clicks: CLICKS,
      domainActions: Number(await incrementCalls(page).textContent()),
      duplicateActions:
        Number(await incrementCalls(page).textContent()) - CLICKS,
      consoleProblems: problems.length,
      latencyMs: {
        webMedian: round(median(webLatency)),
        webP95: round(p95(webLatency)),
        xrRedrawMedian: round(median(xrLatency)),
        xrRedrawP95: round(p95(xrLatency)),
      },
      frameTimeMs: {
        median: round(median(frameTimes)),
        p95: round(p95(frameTimes)),
        samples: frameTimes.length,
      },
      scriptsLoaded: resources.scripts,
      scriptBytes: resources.scriptBytes,
      usedJSHeapMB:
        resources.usedJSHeapSize === null
          ? null
          : round(resources.usedJSHeapSize / 1048576),
    };
    const file = info.outputPath("metrics.json");
    writeFileSync(file, JSON.stringify(result, null, 2));
    await info.attach("metrics", {
      path: file,
      contentType: "application/json",
    });

    expect(result.duplicateActions).toBe(0);
    expect(webLatency).toHaveLength(CLICKS);
    expect(problems, "console errors/warnings").toEqual([]);
  });
}
