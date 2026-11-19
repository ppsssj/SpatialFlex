import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * P1-07C performance benchmark. Run through `pnpm bench:spatial`
 * (scripts/bench-spatialflex.mjs), which sets the configuration below,
 * then aggregates the raw records it writes.
 *
 * Every repeat is a fresh page (fresh renderer, runtime and React tree).
 * Inside a page the workloads run in a seeded order; scenario order is
 * shuffled with the same seed. Measured windows start after a warm-up and
 * are delimited by explicit collector start/stop calls. Nothing is
 * discarded: invalid runs are written with their issues.
 */

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const CONFIG = {
  repeats: Number(env("BENCH_REPEATS", "3")),
  warmupMs: Number(env("BENCH_WARMUP_MS", "1000")),
  sampleMs: Number(env("BENCH_SAMPLE_MS", "3000")),
  seed: Number(env("BENCH_SEED", "7")),
  out: env("BENCH_OUT", "../../docs/evidence/p1-07c/raw"),
  commit: env("BENCH_COMMIT", "unknown"),
  engines: env("BENCH_ENGINES", "three,babylon").split(","),
  counts: env("BENCH_COUNTS", "1,5,10,20").split(",").map(Number),
  /** Panel counts that also run W1 (data) and W3 (manipulation). */
  subsetCounts: env("BENCH_SUBSET_COUNTS", "1,10,20").split(",").map(Number),
  lifecycleCycles: Number(env("BENCH_LIFECYCLE_CYCLES", "10")),
  /** W1 update interval. */
  dataIntervalMs: 100,
  /** W3: pointer steps per drag, one per animation frame. */
  dragSteps: 30,
};

type Kind = "native" | "adaptive";
type Presentation = Kind | "none";
type Workload = "W0" | "W1" | "W2" | "W3";

/** Seeded PRNG (mulberry32) for reproducible orders. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface Scenario {
  engine: string;
  presentation: Presentation;
  panels: number;
}
const scenarios: Scenario[] = shuffle(
  CONFIG.engines.flatMap((engine) => [
    { engine, presentation: "none" as const, panels: 0 },
    ...(["native", "adaptive"] as const).flatMap((presentation) =>
      CONFIG.counts.map((panels) => ({ engine, presentation, panels })),
    ),
  ]),
  prng(CONFIG.seed),
);

const BENCH_CAMERA = { position: [0, 1.42, 4], target: [0, 1.42, -0.4] };

async function open(page: Page, engine: string, panels: number) {
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=website&fixture=benchmark&panels=${panels}`,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as unknown as { __spatialBench?: unknown }).__spatialBench,
      ),
    )
    .toBe(true);
  await expect(page.getByTestId("surface-status")).toHaveAttribute(
    "data-value",
    "visible",
  );
  await page.evaluate(
    ({ position, target }) =>
      (
        window as unknown as {
          __spatialBench: { setCamera(p: number[], t: number[]): boolean };
        }
      ).__spatialBench.setCamera(position, target),
    BENCH_CAMERA,
  );
}

/** Evaluates `body` with `b` = the harness and `a` = the argument. */
function bench<T>(page: Page, body: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ([source, a]) =>
      new Function("b", "a", source)(
        (window as unknown as { __spatialBench: unknown }).__spatialBench,
        a,
      ) as T,
    [body, arg] as const,
  );
}
const frames = (page: Page, n: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () =>
          --left <= 0 ? resolve() : requestAnimationFrame(step);
        requestAnimationFrame(step);
      }),
    n,
  );

async function environment(page: Page, testInfo: TestInfo) {
  const browser = page.context().browser();
  const info = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    let renderer: string | null = null;
    let vendor: string | null = null;
    if (gl) {
      renderer = String(gl.getParameter(gl.RENDERER));
      vendor = String(gl.getParameter(gl.VENDOR));
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      if (debug) {
        renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
        vendor = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL));
      }
    }
    // Smallest observable performance.now() step.
    let resolution = Infinity;
    let last = performance.now();
    for (let i = 0; i < 200_000 && resolution > 0.0001; i++) {
      const now = performance.now();
      if (now > last) resolution = Math.min(resolution, now - last);
      last = now;
    }
    const xr = document.querySelector('[data-testid="xr-canvas"]');
    const rect = xr?.getBoundingClientRect();
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvas: rect ? { width: rect.width, height: rect.height } : null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      crossOriginIsolated: window.crossOriginIsolated,
      timerResolutionMs: Number.isFinite(resolution) ? resolution : null,
      webgl: { renderer, vendor },
      longTasksSupported: (
        PerformanceObserver.supportedEntryTypes ?? []
      ).includes("longtask"),
    };
  });
  return {
    browser: testInfo.project.name,
    browserVersion: browser?.version() ?? null,
    headless: testInfo.project.use.headless ?? true,
    ...info,
  };
}

/** JS heap via the Chromium DevTools protocol; null elsewhere. */
async function heap(page: Page, forceGc: boolean) {
  if (page.context().browser()?.browserType().name() !== "chromium")
    return { usedBytes: null, source: "unsupported", forcedGc: false };
  const cdp = await page.context().newCDPSession(page);
  try {
    if (forceGc) await cdp.send("HeapProfiler.collectGarbage");
    const usage = (await cdp.send("Runtime.getHeapUsage")) as {
      usedSize: number;
    };
    return {
      usedBytes: usage.usedSize,
      source: "CDP Runtime.getHeapUsage (JS heap of the page only)",
      forcedGc: forceGc,
    };
  } finally {
    await cdp.detach();
  }
}

const round = (v: unknown): unknown =>
  typeof v === "number"
    ? Math.round(v * 10_000) / 10_000
    : Array.isArray(v)
      ? v.map(round)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
        : v;

async function drag(
  page: Page,
  from: { x: number; y: number },
  delta: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= CONFIG.dragSteps; i++) {
    await page.mouse.move(
      from.x + (delta.x * i) / CONFIG.dragSteps,
      from.y + (delta.y * i) / CONFIG.dragSteps,
    );
    await frames(page, 1);
  }
  await page.mouse.up();
}

async function measure(
  page: Page,
  scenario: Scenario,
  workload: Workload,
): Promise<Record<string, unknown>> {
  const { presentation } = scenario;
  // Validity at the stationary benchmark camera, before the workload:
  // exactly N presentations, visible, inside the canvas, not overlapping.
  const validity =
    presentation === "none"
      ? { valid: true, issues: [] as string[] }
      : await bench<{ valid: boolean; issues: string[] }>(
          page,
          "return b.validate(a)",
          presentation,
        );
  // Setup (not measured).
  if (workload === "W1")
    await bench(page, "b.data.start(a)", CONFIG.dataIntervalMs);
  if (workload === "W2") await bench(page, "b.cameraPath(true)");
  await page.waitForTimeout(CONFIG.warmupMs);
  const heapBefore = await heap(page, false);
  await bench(page, "b.collector.start()");
  const startedAt = new Date().toISOString();
  if (workload === "W3") {
    // Move, rotate and uniform scale on the first panel, real mouse, one
    // pointer step per animation frame.
    for (const [mode, delta] of [
      ["translate", { x: 60, y: 30 }],
      ["rotate", { x: 50, y: 0 }],
      ["resize", { x: 30, y: 20 }],
    ] as const) {
      const point = await bench<{ x: number; y: number } | null>(
        page,
        "return b.handlePoint(b.ids[0], a)",
        mode,
      );
      if (point) await drag(page, point, delta);
    }
  } else await page.waitForTimeout(CONFIG.sampleMs);
  const result = await bench<Record<string, unknown>>(
    page,
    "return b.collector.stop()",
  );
  const heapAfter = await heap(page, false);
  if (workload === "W1") await bench(page, "b.data.stop()");
  if (workload === "W2") await bench(page, "b.cameraPath(false)");
  await frames(page, 3);
  const issues = [...validity.issues];
  if (workload === "W3" && presentation !== "none") {
    const latency = result.latency as { inputToCommit: { count: number } };
    if (latency.inputToCommit.count === 0)
      issues.push("W3: no manipulation commits were observed");
  }
  return {
    startedAt,
    valid: issues.length === 0,
    issues,
    metrics: {
      ...result,
      memory: { before: heapBefore, after: heapAfter },
      state: await bench(page, "return b.state()"),
    },
  };
}

const workloadsFor = (s: Scenario): Workload[] =>
  s.presentation !== "none" && CONFIG.subsetCounts.includes(s.panels)
    ? ["W0", "W1", "W2", "W3"]
    : ["W0", "W2"];

test.describe.configure({ mode: "serial" });

for (const [index, scenario] of scenarios.entries()) {
  const id = `${scenario.engine}-${scenario.presentation}-${scenario.panels}`;
  test(`scaling ${id}`, async ({ page }, testInfo) => {
    const browser = testInfo.project.name;
    const random = prng(CONFIG.seed + index * 101 + browser.length);
    const records: Record<string, unknown>[] = [];
    let env: Record<string, unknown> | null = null;
    for (let repeat = 0; repeat < CONFIG.repeats; repeat++) {
      await open(page, scenario.engine, scenario.panels);
      env ??= await environment(page, testInfo);
      let setupIssue: string | null = null;
      if (scenario.presentation !== "none") {
        const done = await bench<boolean[]>(
          page,
          "return b.extractAll(a)",
          scenario.presentation,
        );
        if (!done.every(Boolean))
          setupIssue = `extraction refused for ${done.filter((d) => !d).length} panels`;
        await frames(page, 5);
      }
      // W3 changes poses, so it runs last; the others in a seeded order.
      const workloads = workloadsFor(scenario);
      const order = [
        ...shuffle(
          workloads.filter((w) => w !== "W3"),
          random,
        ),
        ...workloads.filter((w) => w === "W3"),
      ];
      for (const [position, workload] of order.entries()) {
        const run = setupIssue
          ? { valid: false, issues: [setupIssue], metrics: null }
          : await measure(page, scenario, workload);
        records.push({
          schema: "spatialflex-bench/1",
          scenarioId: `${browser}-${id}-${workload}`,
          commit: CONFIG.commit,
          renderer: scenario.engine,
          browser,
          presentation: scenario.presentation,
          panels: scenario.panels,
          workload,
          repeat,
          orderInPage: position,
          scenarioOrder: index,
          seed: CONFIG.seed,
          warmupMs: CONFIG.warmupMs,
          sampleMs: workload === "W3" ? null : CONFIG.sampleMs,
          ...(round(run) as Record<string, unknown>),
        });
      }
    }
    await mkdir(CONFIG.out, { recursive: true });
    await writeFile(
      join(CONFIG.out, `${browser}-${id}.json`),
      `${JSON.stringify({ environment: env, config: CONFIG, records }, null, 1)}\n`,
    );
  });
}

// --- W4 lifecycle stress (representative subset: 20 panels) --------------

for (const engine of CONFIG.engines)
  for (const kind of ["native", "adaptive"] as const)
    test(`lifecycle ${engine}-${kind}-20`, async ({ page }, testInfo) => {
      const browser = testInfo.project.name;
      await open(page, engine, 20);
      const env = await environment(page, testInfo);
      const cycles: Record<string, unknown>[] = [];
      const snapshot = async (label: string, cycle: number) => ({
        label,
        cycle,
        heap: await heap(page, true),
        state: await bench(page, "return b.state()"),
      });
      const initial = await snapshot("initial", -1);
      const other = kind === "native" ? "adaptive" : "native";
      for (let cycle = 0; cycle < CONFIG.lifecycleCycles; cycle++) {
        const t0 = Date.now();
        const timing = await bench<{ extractMs: number; restoreMs: number }>(
          page,
          `const t0 = performance.now(); b.extractAll(a.kind);
           const t1 = performance.now();
           return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
             const valid = b.validate(a.kind);
             const switchStart = performance.now(); b.extractAll(a.other);
             const switchMs = performance.now() - switchStart;
             requestAnimationFrame(() => {
               const t2 = performance.now(); b.restoreAll();
               resolve({ extractMs: t1 - t0, switchMs, restoreMs: performance.now() - t2, validIssues: valid.issues });
             });
           })));`,
          { kind, other },
        );
        await frames(page, 2);
        cycles.push({
          ...(await snapshot("after-cycle", cycle)),
          timing,
          wallMs: Date.now() - t0,
        });
      }
      // Host mount/unmount cycles with the presentations of this kind.
      await bench(page, "b.extractAll(a)", kind);
      await frames(page, 3);
      const hostCycles: Record<string, unknown>[] = [];
      for (let cycle = 0; cycle < 5; cycle++) {
        await page.getByRole("button", { name: "Unmount workspace" }).click();
        await frames(page, 3);
        const unmounted = await bench(page, "return b.state()");
        await page.getByRole("button", { name: "Mount workspace" }).click();
        await expect(page.getByTestId("surface-status")).toHaveAttribute(
          "data-value",
          "visible",
        );
        await frames(page, 5);
        hostCycles.push({
          cycle,
          unmounted,
          remounted: await bench(page, "return b.state()"),
        });
      }
      await bench(page, "b.restoreAll()");
      await frames(page, 3);
      const final = await snapshot("final", CONFIG.lifecycleCycles);
      await mkdir(CONFIG.out, { recursive: true });
      await writeFile(
        join(CONFIG.out, `${browser}-lifecycle-${engine}-${kind}-20.json`),
        `${JSON.stringify(
          round({
            environment: env,
            schema: "spatialflex-bench-lifecycle/1",
            commit: CONFIG.commit,
            browser,
            renderer: engine,
            presentation: kind,
            panels: 20,
            workload: "W4",
            initial,
            cycles,
            hostCycles,
            final,
          }),
          null,
          1,
        )}\n`,
      );
    });
