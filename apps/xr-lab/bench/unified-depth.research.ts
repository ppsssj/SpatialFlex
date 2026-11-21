import { test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * P1-08A2 research benchmark (opt-in: `pnpm research:depth` in apps/xr-lab;
 * BENCH_HEADED=1 for a headed browser / hardware GPU). Not a CI gate and no
 * thresholds: it records measured numbers only.
 *
 * Per configuration (track × scenario), REPEATS runs of: warm-up, reset,
 * a fixed measurement window with a few real clicks, then read the page's
 * own counters (rAF intervals, per-frame compose CPU, uploads, uploaded
 * pixels, clip writes and vertices, texture bytes, mounts) and, in
 * Chromium, CDP Performance metrics (layout / style recalc counts and
 * durations, script duration, JS heap).
 *
 * Output: docs/evidence/p1-08a2/perf-<browser>-<headless|headed>.json
 */
const REPEATS = Number(process.env.RESEARCH_REPEATS ?? 3);
const WINDOW_MS = Number(process.env.RESEARCH_WINDOW_MS ?? 4000);
const WARMUP_MS = 1500;
const OUT = "../../docs/evidence/p1-08a2";

const SCENES = [
  { id: "one-surface", query: "scenario=S1&surfaces=A" },
  { id: "two-side-by-side", query: "scenario=S1" },
  { id: "two-overlapping", query: "scenario=S2" },
  { id: "two-interpenetrating", query: "scenario=S3" },
  { id: "two-dynamic", query: "scenario=S8&tick=1&animate=1" },
];
const TRACKS = [
  { id: "dom-order", query: "track=dom&compose=order", needsHic: false },
  { id: "dom-split", query: "track=dom&compose=split", needsHic: false },
  { id: "hic-order", query: "track=hic&hit=order", needsHic: true },
  { id: "hic-clip", query: "track=hic&hit=clip", needsHic: true },
  {
    id: "three-adapter-clip",
    query: "track=three&three=adapter&hit=clip",
    needsHic: true,
  },
  { id: "babylon", query: "track=babylon", needsHic: false },
];

interface Lab {
  expected(x: number, y: number): { target: string };
  safe(x: number, y: number, r: number): boolean;
  resetStats(): void;
  clearLog(): void;
  stats(): Record<string, unknown>;
  log: {
    dispatch: { type: string; t: number; timeStamp: number }[];
    handler: unknown[];
    lifecycle: { kind: string }[];
  };
}
declare global {
  interface Window {
    __depthLab: unknown;
  }
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

async function cdpMetrics(page: Page, browserName: string) {
  if (browserName !== "chromium") return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  return {
    read: async () => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    },
  };
}

async function one(page: Page, browserName: string, query: string) {
  await page.goto(`/research-depth.html?${query}`);
  await page.waitForFunction(
    () => document.documentElement.dataset.ready === "1",
  );
  await page.waitForTimeout(WARMUP_MS);
  // A press target that exists in every scene (A's left button).
  const target = await page.evaluate(() => {
    const L = window.__depthLab as Lab;
    for (let y = 20; y < 700; y += 8)
      for (let x = 20; x < 1000; x += 8)
        if (L.expected(x, y).target === "A-left" && L.safe(x, y, 20))
          return { x, y };
    return null;
  });
  const cdp = await cdpMetrics(page, browserName);
  const before = cdp ? await cdp.read() : null;
  await page.evaluate(() => {
    const L = window.__depthLab as Lab;
    L.resetStats();
    L.clearLog();
    // Time from each pointerdown to the next animation frame.
    const w = window as unknown as { __toFrame: number[] };
    w.__toFrame = [];
    window.addEventListener(
      "pointerdown",
      (e) => requestAnimationFrame((t) => w.__toFrame.push(t - e.timeStamp)),
      true,
    );
  });
  const clicks = 5;
  const started = Date.now();
  for (let i = 0; i < clicks && target; i++) {
    await page.waitForTimeout(WINDOW_MS / (clicks + 1));
    await page.mouse.click(target.x, target.y);
  }
  await page.waitForTimeout(Math.max(0, WINDOW_MS - (Date.now() - started)));
  const elapsed = (Date.now() - started) / 1000;
  const after = cdp ? await cdp.read() : null;
  const page_ = await page.evaluate(() => {
    const L = window.__depthLab as Lab;
    const s = L.stats();
    const d = L.log.dispatch.filter((x) => x.type === "pointerdown");
    return {
      stats: s,
      queueDelay: d.map((x) => x.t - x.timeStamp),
      toFrame: (window as unknown as { __toFrame: number[] }).__toFrame,
      handlers: L.log.handler.length,
      mounts: L.log.lifecycle.filter((l) => l.kind === "mount").length,
      unmounts: L.log.lifecycle.filter((l) => l.kind === "unmount").length,
      heap:
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? null,
    };
  });
  const delta = (k: string) =>
    before && after ? (after[k] ?? 0) - (before[k] ?? 0) : null;
  const s = page_.stats as {
    uploads: number;
    uploadedPixels: number;
    clipWrites: number;
    clipVertices: number;
    textureBytes: number;
    texturesLive: number;
    geometryCalls: number;
    errors: string[];
    intervals: { p95: number; median: number; p99: number };
    composeMs: { p95: number; median: number; p99: number };
  };
  return {
    seconds: elapsed,
    frameInterval: s.intervals,
    composeMs: s.composeMs,
    uploadsPerSec: s.uploads / elapsed,
    uploadedMpxPerSec: s.uploadedPixels / elapsed / 1e6,
    clipWritesPerSec: s.clipWrites / elapsed,
    clipVertices: s.clipVertices,
    textureBytes: s.textureBytes,
    texturesLive: s.texturesLive,
    geometryCallsPerSec: s.geometryCalls / elapsed,
    pressesDelivered: page_.handlers,
    pressesSent: target ? clicks : 0,
    inputQueueDelayMs: {
      median: median(page_.queueDelay),
      max: Math.max(...page_.queueDelay, 0),
    },
    pressToNextFrameMs: {
      median: median(page_.toFrame),
      max: Math.max(...page_.toFrame, 0),
    },
    mounts: page_.mounts,
    unmounts: page_.unmounts,
    jsHeapBytes: page_.heap,
    cdp: before
      ? {
          layoutCount: delta("LayoutCount"),
          recalcStyleCount: delta("RecalcStyleCount"),
          layoutMs: (delta("LayoutDuration") ?? 0) * 1000,
          recalcStyleMs: (delta("RecalcStyleDuration") ?? 0) * 1000,
          scriptMs: (delta("ScriptDuration") ?? 0) * 1000,
          taskMs: (delta("TaskDuration") ?? 0) * 1000,
          jsHeapUsed: after?.JSHeapUsedSize ?? null,
        }
      : null,
    errors: s.errors,
  };
}

test("P1-08A2 unified depth performance", async ({
  page,
  browserName,
  browser,
}) => {
  await page.goto("/research-depth.html?track=dom");
  const hic = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.setAttribute("content", "drawable");
    return (c as { content?: string }).content === "drawable";
  });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl
      ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
      : null;
  });
  const results: Record<string, unknown>[] = [];
  for (const track of TRACKS) {
    if (track.needsHic && !hic) {
      results.push({ track: track.id, status: "UNSUPPORTED" });
      continue;
    }
    for (const scene of SCENES) {
      const runs = [];
      for (let r = 0; r < REPEATS; r++)
        runs.push(
          await one(page, browserName, `${track.query}&${scene.query}`),
        );
      results.push({ track: track.id, scene: scene.id, runs });
      console.log(
        track.id,
        scene.id,
        runs
          .map(
            (x) =>
              `p95=${x.frameInterval.p95?.toFixed(1)} compose.p95=${x.composeMs.p95?.toFixed(2)} up/s=${x.uploadsPerSec.toFixed(1)} clip/s=${x.clipWritesPerSec.toFixed(1)}`,
          )
          .join(" | "),
      );
    }
  }
  const mode = process.env.BENCH_HEADED ? "headed" : "headless";
  await mkdir(OUT, { recursive: true });
  await writeFile(
    `${OUT}/perf-${browserName}-${mode}.json`,
    JSON.stringify(
      {
        milestone: "P1-08A2",
        browser: browserName,
        browserVersion: browser.version(),
        mode,
        webglRenderer: gpu,
        repeats: REPEATS,
        windowMs: WINDOW_MS,
        note: "Measured on the author's workstation; software WebGL (SwiftShader) in headless Chromium is not representative of hardware XR.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
});
