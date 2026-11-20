#!/usr/bin/env node
// SpatialFlex performance benchmark (P1-07C, extended in P1-07D): runs the browser benchmark
// (apps/xr-lab/bench, Playwright, production build) and aggregates its raw
// records into summary.json, environment.json, methodology.json,
// benchmark-report.md and SVG charts. Results are never hardcoded: every
// number comes from the raw records of this run.
//
// Usage (from the repository root):
//   pnpm bench:spatial                      full headless matrix, 3 repeats
//   pnpm bench:spatial --quick              1 repeat, short windows, subset
//   pnpm bench:spatial --headed --label gpu headed browsers (hardware GPU)
//   pnpm bench:spatial --aggregate-only     re-aggregate existing raw data
// Raw records are stored as raw/<label>/*.json.gz (every sample kept).
// Options: --repeats N --warmup-ms N --sample-ms N --seed N
//          --browsers chromium,firefox --engines three,babylon
//          --counts 1,5,10,20 --cycles N --out DIR --label NAME
//          --presentations none,native,adaptive --workloads W0,W2,...
//          --ablate page-clip   (diagnostic only; label the run accordingly)
//          --ablate face-no-redraw|face-no-upload|face-half-res|face-linear|
//                   face-no-mipmap   (P1-07D Three.js face diagnostics)
// The default output is bench-results/ (git-ignored). Committed evidence
// directories (docs/evidence/p1-07c, docs/evidence/p1-07d) are written only
// when named explicitly with --out.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { summarize, variation } from "../apps/xr-lab/src/performance/stats.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lab = join(root, "apps/xr-lab");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const quick = flag("quick");
const headed = flag("headed");
const out = resolve(root, option("out", "bench-results"));
const label = option("label", headed ? "headed" : "headless");
const rawDir = join(out, "raw", label);
const config = {
  repeats: option("repeats", quick ? "1" : "3"),
  warmupMs: option("warmup-ms", quick ? "500" : "1000"),
  sampleMs: option("sample-ms", quick ? "1500" : "3000"),
  seed: option("seed", "7"),
  browsers: option("browsers", "chromium,firefox"),
  engines: option("engines", "three,babylon"),
  counts: option("counts", quick ? "1,20" : "1,5,10,20"),
  subsetCounts: option("subset-counts", quick ? "20" : "1,10,20"),
  cycles: option("cycles", quick ? "3" : "10"),
  presentations: option("presentations", "none,native,adaptive"),
  workloads: option("workloads", "W0,W1,W2,W3,W4"),
  ablate: option("ablate", ""),
};
const sh = (cmd, a) =>
  execFileSync(cmd, a, { cwd: root, encoding: "utf8" }).trim();
const commit = sh("git", ["rev-parse", "HEAD"]);
// The benchmark's own output directory does not make the code dirty.
const dirty =
  sh("git", [
    "status",
    "--porcelain",
    "--",
    ".",
    `:(exclude)${relative(root, out).replaceAll("\\", "/")}`,
  ]).length > 0;

// --- 1. Run ---------------------------------------------------------------
if (!flag("aggregate-only")) {
  rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  const env = {
    ...process.env,
    BENCH_REPEATS: config.repeats,
    BENCH_WARMUP_MS: config.warmupMs,
    BENCH_SAMPLE_MS: config.sampleMs,
    BENCH_SEED: config.seed,
    BENCH_ENGINES: config.engines,
    BENCH_COUNTS: config.counts,
    BENCH_SUBSET_COUNTS: config.subsetCounts,
    BENCH_LIFECYCLE_CYCLES: config.cycles,
    BENCH_PRESENTATIONS: config.presentations,
    BENCH_WORKLOADS: config.workloads,
    BENCH_ABLATE: config.ablate,
    BENCH_OUT: rawDir,
    BENCH_COMMIT: commit,
    ...(headed && { BENCH_HEADED: "1", XR_LAB_FIREFOX_HEADED: "1" }),
  };
  const projects = config.browsers.split(",").flatMap((b) => ["--project", b]);
  const started = Date.now();
  const run = spawnSync(
    "npx",
    ["playwright", "test", "-c", "playwright.bench.config.ts", ...projects],
    { cwd: lab, env, stdio: "inherit", shell: process.platform === "win32" },
  );
  writeFileSync(
    join(rawDir, "_run.json"),
    `${JSON.stringify(
      {
        commit,
        workingTreeDirty: dirty,
        label,
        headed,
        config,
        exitCode: run.status,
        wallClockMs: Date.now() - started,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  if (run.status !== 0)
    console.error(
      `Benchmark run exited with ${run.status}; aggregating what was recorded.`,
    );
}

// --- 2. Aggregate -----------------------------------------------------------
const labels = existsSync(join(out, "raw"))
  ? readdirSync(join(out, "raw")).filter((d) =>
      existsSync(join(out, "raw", d, "_run.json")),
    )
  : [];
if (labels.length === 0) {
  console.error(`No raw benchmark data under ${relative(root, out)}/raw.`);
  process.exit(1);
}

const median = (values) => summarize(values).median;
const r3 = (v) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? null
    : Math.round(v * 1000) / 1000;

/** Per-run scalar metrics extracted from one raw record (null = missing). */
function runMetrics(record) {
  const m = record.metrics;
  const span = (name, stat) => m.spans[name]?.[stat] ?? null;
  const count = (name) => m.counters[name] ?? 0;
  const frames = m.frames.samples || null;
  return {
    frameMedianMs: m.frames.medianIntervalMs,
    frameP95Ms: m.frames.p95IntervalMs,
    frameP99Ms: m.frames.p99IntervalMs,
    observedFps: m.frames.observedFps,
    overBudgetRatio: m.frames.overBudgetRatio,
    compositeMedianMs: span("dom.composite", "median"),
    compositeP95Ms: span("dom.composite", "p95"),
    compositeP99Ms: span("dom.composite", "p99"),
    hostFrameMedianMs: span("dom.hostFrame", "median"),
    surfaceFrameMedianMs: span("lab.surfaceFrame", "median"),
    surfaceFrameP95Ms: span("lab.surfaceFrame", "p95"),
    renderMedianMs: span(`render.${record.renderer}`, "median"),
    renderP95Ms: span(`render.${record.renderer}`, "p95"),
    manipulationUpdateMedianMs: span("core.manipulationUpdate", "median"),
    itemSyncMedianMs: span("core.itemSync", "median"),
    inputToCommitMedianMs: m.latency.inputToCommit.median,
    inputToCommitP95Ms: m.latency.inputToCommit.p95,
    inputToNextFrameMedianMs: m.latency.inputToNextFrame.median,
    inputToNextFrameP95Ms: m.latency.inputToNextFrame.p95,
    longTasks: m.longTasks.supported ? m.longTasks.count : null,
    longTaskMs: m.longTasks.supported ? m.longTasks.totalMs : null,
    heapUsedMB:
      m.memory.after.usedBytes === null
        ? null
        : m.memory.after.usedBytes / 1048576,
    domNodes: m.state.domNodes,
    panelRendersPerFrame: frames ? count("react.panel.render") / frames : null,
    shellRenders: count("react.shell.render"),
    pageRenders: count("react.page.render"),
    instrumentationCostMs: m.instrumentationCostMs,
    // P1-07D texture pipeline (null in records without these spans:
    // P1-07C raw data aggregates unchanged). Rates are per second of the
    // sample window; "ms/s" is summed synchronous CPU per second.
    ...textureMetrics(m),
  };
}

function textureMetrics(m) {
  const seconds = m.durationMs > 0 ? m.durationMs / 1000 : null;
  // Records without any texture-pipeline event (P1-07C data, or a window
  // with no texture work at all) report null rather than zero.
  const texture = (k) => /^(gl|three|babylon)\./.test(k);
  const has =
    Object.keys(m.counters).some(texture) || Object.keys(m.spans).some(texture);
  const rate = (n) => (has && seconds ? n / seconds : null);
  const total = (name) => {
    const s = m.spans[name];
    return s && s.count ? s.count * s.mean : 0;
  };
  const count = (name) => m.counters[name] ?? 0;
  const span = (name, stat) => m.spans[name]?.[stat] ?? null;
  return {
    faceDrawsPerSec: rate(m.spans["three.panelFaceDraw"]?.count ?? 0),
    faceDrawMedianMs: span("three.panelFaceDraw", "median"),
    faceDrawP95Ms: span("three.panelFaceDraw", "p95"),
    faceDrawMsPerSec: rate(total("three.panelFaceDraw")),
    faceDrawUnchangedPerSec: rate(count("three.faceDraw.unchanged")),
    textureDirtyPerSec: rate(count("three.textureDirty")),
    uploadCallsPerSec: rate(count("gl.uploadCalls")),
    uploadMPixelsPerSec: rate(count("gl.uploadPixels") / 1e6),
    uploadCallMedianMs:
      span("gl.texSubImage2D", "median") ?? span("gl.texImage2D", "median"),
    uploadCallMsPerSec: rate(
      total("gl.texSubImage2D") + total("gl.texImage2D"),
    ),
    mipmapMsPerSec: rate(total("gl.generateMipmap")),
    babylonTextureUpdateMsPerSec: rate(total("babylon.textureUpdate")),
    textureCreatesPerSec: rate(count("gl.createTexture")),
    textureDeletesPerSec: rate(count("gl.deleteTexture")),
    threePanelRendersPerSec: rate(count("three.panelRender")),
    threeSceneRendersPerSec: rate(count("three.sceneRender")),
    renderMsPerSec:
      has && seconds
        ? (total("render.three") + total("render.babylon")) / seconds
        : null,
  };
}

const environments = {};
const groups = new Map();
const invalid = [];
const lifecycle = [];
for (const lbl of labels) {
  const dir = join(out, "raw", lbl);
  const run = JSON.parse(readFileSync(join(dir, "_run.json"), "utf8"));
  environments[lbl] = { run, browsers: {} };
  // Raw records are kept gzip-compressed (every sample, ~8x smaller).
  for (const file of readdirSync(dir).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_"),
  )) {
    writeFileSync(
      join(dir, `${file}.gz`),
      gzipSync(readFileSync(join(dir, file)), { level: 9 }),
    );
    rmSync(join(dir, file));
  }
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json.gz"))
    .sort()) {
    const data = JSON.parse(
      gunzipSync(readFileSync(join(dir, file))).toString("utf8"),
    );
    if (data.environment)
      environments[lbl].browsers[data.environment.browser] ??= data.environment;
    if (data.schema === "spatialflex-bench-lifecycle/1") {
      lifecycle.push({ label: lbl, ...data, environment: undefined });
      continue;
    }
    for (const record of data.records) {
      if (!record.valid || !record.metrics) {
        invalid.push({
          label: lbl,
          scenarioId: record.scenarioId,
          repeat: record.repeat,
          issues: record.issues,
        });
        continue;
      }
      const key = [
        lbl,
        record.browser,
        record.renderer,
        record.presentation,
        record.panels,
        record.workload,
      ].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(runMetrics(record));
    }
  }
}

const scenarios = [...groups].map(([key, runs]) => {
  const [lbl, browser, renderer, presentation, panels, workload] =
    key.split("|");
  const metrics = {};
  for (const name of Object.keys(runs[0])) {
    const values = runs.map((r) => r[name]).filter((v) => v !== null);
    metrics[name] = values.length
      ? {
          median: r3(median(values)),
          min: r3(Math.min(...values)),
          max: r3(Math.max(...values)),
          cv: r3(variation(values)),
          runs: values.length,
        }
      : null; // not measured / unsupported: never reported as 0
  }
  return {
    label: lbl,
    browser,
    renderer,
    presentation,
    panels: Number(panels),
    workload,
    validRuns: runs.length,
    metrics,
  };
});
scenarios.sort(
  (a, b) =>
    a.label.localeCompare(b.label) ||
    a.workload.localeCompare(b.workload) ||
    a.browser.localeCompare(b.browser) ||
    a.renderer.localeCompare(b.renderer) ||
    a.presentation.localeCompare(b.presentation) ||
    a.panels - b.panels,
);

const lifecycleSummary = lifecycle.map((l) => {
  const heaps = l.cycles.map((c) => c.heap.usedBytes);
  const finite = heaps.filter((h) => h !== null);
  return {
    label: l.label,
    browser: l.browser,
    renderer: l.renderer,
    presentation: l.presentation,
    panels: l.panels,
    cycles: l.cycles.length,
    heapMB: {
      initial:
        l.initial.heap.usedBytes === null
          ? null
          : r3(l.initial.heap.usedBytes / 1048576),
      perCycle: finite.length ? heaps.map((h) => r3(h / 1048576)) : null,
      final:
        l.final.heap.usedBytes === null
          ? null
          : r3(l.final.heap.usedBytes / 1048576),
      source: l.initial.heap.source,
      forcedGc: l.initial.heap.forcedGc,
      // Least-squares slope over cycles (MB per cycle), forced-GC heap.
      slopePerCycle:
        finite.length > 2 ? r3(slope(finite.map((h) => h / 1048576))) : null,
    },
    timingMs: {
      extract: summarize(l.cycles.map((c) => c.timing.extractMs)),
      switch: summarize(l.cycles.map((c) => c.timing.switchMs)),
      restore: summarize(l.cycles.map((c) => c.timing.restoreMs)),
    },
    validityIssues: l.cycles.flatMap((c) => c.timing.validIssues ?? []),
    domNodes: {
      initial: l.initial.state.domNodes,
      final: l.final.state.domNodes,
      perCycle: l.cycles.map((c) => c.state.domNodes),
    },
    finalState: l.final.state,
    initialState: l.initial.state,
    hostCycles: l.hostCycles.map((h) => ({
      unmountedTextures: h.unmounted.liveTextures,
      unmountedHosts: h.unmounted.activeHosts,
      remountedTextures: h.remounted.liveTextures,
      remountedHosts: h.remounted.activeHosts,
      remountedPresentations: h.remounted.presentations,
    })),
  };
});

function slope(ys) {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return num / den;
}

const host = {
  os: `${platform()} ${release()} (${arch()})`,
  cpu: cpus()[0]?.model.trim() ?? null,
  logicalCpus: cpus().length,
  ramGB: Math.round((totalmem() / 1073741824) * 10) / 10,
  node: process.version,
  ci: !!process.env.CI,
  note: process.env.CI
    ? "CI-host measurement: shared virtual hardware, software WebGL; not representative of consumer GPUs or headsets."
    : "Local workstation measurement.",
};
rmSync(join(out, "charts"), { recursive: true, force: true });
mkdirSync(join(out, "charts"), { recursive: true });
writeFileSync(
  join(out, "environment.json"),
  `${JSON.stringify({ commit, host, labels: environments }, null, 2)}\n`,
);
writeFileSync(
  join(out, "methodology.json"),
  `${JSON.stringify(methodology(), null, 2)}\n`,
);
writeFileSync(
  join(out, "summary.json"),
  `${JSON.stringify(
    {
      // /2 (P1-07D): adds the optional texture-pipeline metrics (null when
      // a record has none); every /1 field is unchanged.
      schema: "spatialflex-bench-summary/2",
      commit,
      generatedAt: new Date().toISOString(),
      exclusionRule:
        "Runs whose validity check failed (wrong presentation count, a panel not visible, outside the canvas or overlapping, extraction refused, or W3 without any observed manipulation commit) are excluded from aggregates and listed in invalidRuns. Nothing else is excluded.",
      aggregation:
        "Per run: median/P95/P99 over the run's samples. Per scenario: median of the per-run values across repeats, with min, max and coefficient of variation (cv). null = not measured or unsupported, never zero.",
      scenarios,
      lifecycle: lifecycleSummary,
      invalidRuns: invalid,
    },
    null,
    1,
  )}\n`,
);
writeCharts();
writeReport();
console.log(
  `\nAggregated ${scenarios.length} scenarios (${invalid.length} invalid runs), ${lifecycleSummary.length} lifecycle runs → ${relative(root, out)}`,
);

// --- Methodology --------------------------------------------------------------
function methodology() {
  return {
    command: "pnpm bench:spatial [options] (scripts/bench-spatialflex.mjs)",
    build:
      "Production build (vite build) of apps/xr-lab with VITE_XR_LAB_TEST_HOOKS=1, served by vite preview with COOP/COEP headers (cross-origin isolated: fine performance.now() resolution).",
    fixture:
      "?fixture=benchmark&panels=N: N real React components (local state, a button, fixed 160x100 CSS px, deterministic data, declared XR Adaptive view). Presentations are started through the lab's LabIntegration at deterministic non-overlapping grid positions (5 columns, 0.7 m x 0.62 m pitch, z = -0.4 m); camera at (0, 1.42, 4) looking at (0, 1.42, -0.4) in both engines.",
    workloads: {
      W0: "Idle: panels presented, camera stationary, no data updates.",
      W1: "Dynamic data: every panel's value changes every 100 ms (setInterval).",
      W2: "Camera motion: yaw orbit of ±0.14 rad around the target with a 240-frame period, set every animation frame through the hosts' setCamera test hook.",
      W3: "Manipulation: real mouse drags on panel 1's translate, rotate and resize handles (30 pointer steps each, one per animation frame). Always the last workload of a page, since it changes poses.",
      W4: "Lifecycle stress (20 panels): N cycles of extract all → switch all to the other strategy → restore all, then 5 workspace (renderer host) unmount/mount cycles; heap with forced GC (Chromium CDP) after each cycle.",
    },
    matrix:
      "Renderers three/babylon × browsers chromium/firefox × Native/Adaptive × 1/5/10/20 panels (W0, W2), plus 0-panel controls; W1 and W3 for the subset counts; W4 at 20 panels.",
    order:
      "Scenario order shuffled with a seeded PRNG (mulberry32, seed recorded); W0/W1/W2 order per page shuffled with a derived seed; W3 last.",
    repeats:
      "Each repeat is a fresh page load (fresh renderer, runtime and React tree). Warm-up before every measured window; explicit collector start/stop markers.",
    metrics: {
      frames:
        "requestAnimationFrame timestamps of the page (browser frame cadence). Over-budget: interval > 1.5 × the run's own median interval. Not GPU time.",
      spans:
        "Synchronous JavaScript time (performance.now() around a call) of SDK methods wrapped on their prototypes in benchmark mode: dom.composite (NativeCompositor.composite), dom.hostFrame (PresentationHost.frame), dom.setTargets, core.itemSync, core.manipulationUpdate; lab.surfaceFrame (the page surface's whole frame: page transform, host frame, page clip); render.three (WebGLRenderer.render) / render.babylon (Scene.render): CPU submission time, not GPU execution. None include the browser's later style, layout, paint or compositing work.",
      latency:
        "inputToCommit: manipulation store notification time minus the triggering event's timeStamp. inputToNextFrame: first rAF callback after that commit minus the event timeStamp.",
      memory:
        "Chromium only: CDP Runtime.getHeapUsage (page JS heap, not total browser or GPU memory). Firefox: unsupported (null). W4 forces GC (HeapProfiler.collectGarbage) before each sample.",
      longTasks:
        "PerformanceObserver 'longtask' where supported (Chromium); unsupported elsewhere (null, not zero).",
      react:
        "Render invocations counted in component bodies (react.panel.render, react.page.render, react.shell.render) and commits in layout effects (react.panel.commit).",
    },
    instrumentationCost:
      "instrumentationCostMs: median cost of one empty timed call in the same page, reported per run.",
  };
}

// --- Charts (SVG, no dependencies) ------------------------------------------
function lineChart({ title, yLabel, series, file }) {
  if (!series.some((s) => s.points.some((p) => p[1] !== null))) return;
  const W = 640;
  const H = 360;
  const m = { l: 60, r: 180, t: 36, b: 44 };
  const xs = [0, 1, 5, 10, 20];
  const all = series.flatMap((s) => s.points.map((p) => p[1]));
  const yMax = Math.max(1e-9, ...all) * 1.1;
  const x = (v) => m.l + (xs.indexOf(v) / (xs.length - 1)) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
  const colors = [
    "#1f77b4",
    "#d62728",
    "#2ca02c",
    "#9467bd",
    "#ff7f0e",
    "#8c564b",
    "#e377c2",
    "#17becf",
  ];
  const ticks = Array.from({ length: 5 }, (_, i) => (yMax * i) / 4);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="11">`,
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<text x="${m.l}" y="20" font-size="13" font-weight="bold">${title}</text>`,
    ...ticks.map(
      (t) =>
        `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e5e5"/><text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(t < 10 ? 2 : 0)}</text>`,
    ),
    ...xs.map(
      (v) =>
        `<text x="${x(v)}" y="${H - m.b + 16}" text-anchor="middle">${v}</text>`,
    ),
    `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle">panels</text>`,
    `<text transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${yLabel}</text>`,
    ...series.flatMap((s, i) => {
      const c = colors[i % colors.length];
      const pts = s.points.filter((p) => p[1] !== null);
      return [
        `<polyline fill="none" stroke="${c}" stroke-width="2" points="${pts.map((p) => `${x(p[0])},${y(p[1])}`).join(" ")}"/>`,
        ...pts.map(
          (p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="3" fill="${c}"/>`,
        ),
        `<rect x="${W - m.r + 12}" y="${m.t + i * 18}" width="10" height="10" fill="${c}"/><text x="${W - m.r + 26}" y="${m.t + i * 18 + 9}">${s.name}</text>`,
      ];
    }),
    "</svg>",
  ];
  writeFileSync(join(out, "charts", file), `${svg.join("\n")}\n`);
}

function seriesOf(lbl, workload, metric, filter = () => true) {
  const keys = new Map();
  for (const s of scenarios)
    if (s.label === lbl && s.workload === workload && filter(s)) {
      const name = `${s.renderer} ${s.browser} ${s.presentation}`;
      if (s.presentation === "none") continue;
      if (!keys.has(name)) keys.set(name, []);
      keys.get(name).push([s.panels, s.metrics[metric]?.median ?? null]);
    }
  // The 0-panel control, shared by both presentations of an environment.
  for (const s of scenarios)
    if (s.label === lbl && s.workload === workload && s.presentation === "none")
      for (const [name, pts] of keys)
        if (name.startsWith(`${s.renderer} ${s.browser} `))
          pts.push([0, s.metrics[metric]?.median ?? null]);
  return [...keys].map(([name, points]) => ({
    name,
    points: points.sort((a, b) => a[0] - b[0]),
  }));
}

function writeCharts() {
  for (const lbl of labels) {
    const p = (f) => `${lbl}-${f}`;
    lineChart({
      title: `Median frame interval vs panels (W2 camera motion, ${lbl})`,
      yLabel: "ms",
      series: seriesOf(lbl, "W2", "frameMedianMs"),
      file: p("frame-median-w2.svg"),
    });
    lineChart({
      title: `P95 frame interval vs panels (W2 camera motion, ${lbl})`,
      yLabel: "ms",
      series: seriesOf(lbl, "W2", "frameP95Ms"),
      file: p("frame-p95-w2.svg"),
    });
    lineChart({
      title: `Median frame interval vs panels (W0 idle, ${lbl})`,
      yLabel: "ms",
      series: seriesOf(lbl, "W0", "frameMedianMs"),
      file: p("frame-median-w0.svg"),
    });
    lineChart({
      title: `NativeCompositor.composite CPU median (W2, ${lbl})`,
      yLabel: "ms (JS only)",
      series: seriesOf(
        lbl,
        "W2",
        "compositeMedianMs",
        (s) => s.presentation === "native",
      ),
      file: p("composite-w2.svg"),
    });
    lineChart({
      title: `Input → next frame, median (W3 manipulation, ${lbl})`,
      yLabel: "ms",
      series: seriesOf(lbl, "W3", "inputToNextFrameMedianMs"),
      file: p("latency-w3.svg"),
    });
    lineChart({
      title: `Renderer CPU submission median (W1 data updates, ${lbl})`,
      yLabel: "ms (JS only)",
      series: seriesOf(lbl, "W1", "renderMedianMs"),
      file: p("render-w1.svg"),
    });
  }
  // Lifecycle heap per cycle (Chromium, forced GC).
  const cyc = lifecycleSummary.filter((l) => l.heapMB.perCycle);
  if (cyc.length) {
    const W = 640;
    const H = 360;
    const m = { l: 60, r: 200, t: 36, b: 44 };
    const n = Math.max(...cyc.map((l) => l.heapMB.perCycle.length));
    const all = cyc.flatMap((l) => [l.heapMB.initial, ...l.heapMB.perCycle]);
    const yMin = Math.min(...all) * 0.95;
    const yMax = Math.max(...all) * 1.05;
    const x = (i) => m.l + (i / n) * (W - m.l - m.r);
    const y = (v) => H - m.b - ((v - yMin) / (yMax - yMin)) * (H - m.t - m.b);
    const colors = [
      "#1f77b4",
      "#d62728",
      "#2ca02c",
      "#9467bd",
      "#ff7f0e",
      "#8c564b",
    ];
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="11">`,
      `<rect width="${W}" height="${H}" fill="#fff"/>`,
      `<text x="${m.l}" y="20" font-size="13" font-weight="bold">JS heap after each W4 cycle (forced GC, Chromium CDP)</text>`,
      ...[yMin, (yMin + yMax) / 2, yMax].map(
        (t) =>
          `<text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(1)}</text><line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e5e5e5"/>`,
      ),
      `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle">cycle (0 = before)</text>`,
      `<text transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">MB</text>`,
      ...cyc.flatMap((l, i) => {
        const c = colors[i % colors.length];
        const pts = [l.heapMB.initial, ...l.heapMB.perCycle];
        return [
          `<polyline fill="none" stroke="${c}" stroke-width="2" points="${pts.map((v, j) => `${x(j)},${y(v)}`).join(" ")}"/>`,
          `<rect x="${W - m.r + 12}" y="${m.t + i * 18}" width="10" height="10" fill="${c}"/><text x="${W - m.r + 26}" y="${m.t + i * 18 + 9}">${l.label} ${l.renderer} ${l.presentation}</text>`,
        ];
      }),
      "</svg>",
    ];
    writeFileSync(
      join(out, "charts", "lifecycle-heap.svg"),
      `${svg.join("\n")}\n`,
    );
  }
}

// --- Report -------------------------------------------------------------------
function writeReport() {
  const fmt = (v) => (v === null || v === undefined ? "n/a" : String(v));
  const cell = (s, metric) => {
    const v = s?.metrics[metric];
    return v
      ? `${fmt(v.median)}${v.cv !== null && v.cv > 0.2 ? "*" : ""}`
      : "n/a";
  };
  const lines = [
    "# SpatialFlex benchmark report (generated)",
    "",
    `Commit \`${commit}\`. Generated by \`scripts/bench-spatialflex.mjs\` from \`raw/\`; do not edit by hand.`,
    "Values: median across repeats of per-run statistics. `*` = run-to-run coefficient of variation > 20 %. `n/a` = not measured or unsupported (never zero).",
    "",
  ];
  const find = (lbl, browser, renderer, presentation, panels, workload) =>
    scenarios.find(
      (s) =>
        s.label === lbl &&
        s.browser === browser &&
        s.renderer === renderer &&
        s.presentation === presentation &&
        s.panels === panels &&
        s.workload === workload,
    );
  for (const lbl of labels) {
    const env = environments[lbl];
    lines.push(`## Environment: ${lbl}`, "");
    for (const [b, e] of Object.entries(env.browsers))
      lines.push(
        `- ${b} ${e.browserVersion} (${e.headless ? "headless" : "headed"}), WebGL: ${e.webgl.renderer}; DPR ${e.devicePixelRatio}; canvas ${e.canvas?.width}×${e.canvas?.height}; timer resolution ${e.timerResolutionMs} ms; long tasks ${e.longTasksSupported ? "supported" : "unsupported"}`,
      );
    lines.push(
      `- Host: ${host.os}, ${host.cpu} (${host.logicalCpus} logical), ${host.ramGB} GB RAM, Node ${host.node}. ${host.note}`,
      `- Repeats ${env.run.config.repeats}, warm-up ${env.run.config.warmupMs} ms, sample ${env.run.config.sampleMs} ms, seed ${env.run.config.seed}.`,
      "",
    );
    const browsers = Object.keys(env.browsers).sort();
    const renderers = config.engines.split(",");
    const counts = [0, ...config.counts.split(",").map(Number)];
    for (const [title, workload, metrics] of [
      [
        "Frame interval and composition (W0 idle)",
        "W0",
        [
          "frameMedianMs",
          "frameP95Ms",
          "observedFps",
          "compositeMedianMs",
          "surfaceFrameMedianMs",
          "renderMedianMs",
        ],
      ],
      [
        "Frame interval and composition (W2 camera motion)",
        "W2",
        [
          "frameMedianMs",
          "frameP95Ms",
          "frameP99Ms",
          "observedFps",
          "overBudgetRatio",
          "compositeMedianMs",
          "compositeP95Ms",
          "surfaceFrameMedianMs",
          "renderMedianMs",
          "longTasks",
        ],
      ],
      [
        "Dynamic data (W1)",
        "W1",
        [
          "frameMedianMs",
          "frameP95Ms",
          "renderMedianMs",
          "compositeMedianMs",
          "panelRendersPerFrame",
          "longTasks",
        ],
      ],
      [
        "Manipulation (W3)",
        "W3",
        [
          "inputToCommitMedianMs",
          "inputToNextFrameMedianMs",
          "inputToNextFrameP95Ms",
          "manipulationUpdateMedianMs",
          "compositeMedianMs",
          "frameMedianMs",
        ],
      ],
    ]) {
      lines.push(`### ${title}`, "");
      for (const presentation of ["native", "adaptive"]) {
        lines.push(
          `**${presentation === "native" ? "Native DOM" : "XR Adaptive"}**`,
          "",
        );
        lines.push(
          `| browser | renderer | panels | ${metrics.join(" | ")} |`,
          `| --- | --- | ---: | ${metrics.map(() => "---:").join(" | ")} |`,
        );
        for (const browser of browsers)
          for (const renderer of renderers)
            for (const n of counts) {
              const s =
                n === 0
                  ? find(lbl, browser, renderer, "none", 0, workload)
                  : find(lbl, browser, renderer, presentation, n, workload);
              if (!s) continue;
              lines.push(
                `| ${browser} | ${renderer} | ${n === 0 ? "0 (control)" : n} | ${metrics.map((m) => cell(s, m)).join(" | ")} |`,
              );
            }
        lines.push("");
      }
    }
    const texture = [
      "faceDrawsPerSec",
      "faceDrawMedianMs",
      "faceDrawMsPerSec",
      "faceDrawUnchangedPerSec",
      "uploadCallsPerSec",
      "uploadMPixelsPerSec",
      "uploadCallMsPerSec",
      "mipmapMsPerSec",
      "babylonTextureUpdateMsPerSec",
      "renderMsPerSec",
      "threePanelRendersPerSec",
      "textureCreatesPerSec",
    ];
    const textureRows = scenarios.filter(
      (x) =>
        x.label === lbl &&
        x.presentation === "adaptive" &&
        x.metrics.uploadCallsPerSec !== null,
    );
    if (textureRows.length) {
      lines.push(
        "### Texture pipeline (XR Adaptive, P1-07D)",
        "",
        "Per second of the sample window. CPU = synchronous main-thread time of the call (not GPU execution).",
        "",
        `| workload | browser | renderer | panels | ${texture.join(" | ")} |`,
        `| --- | --- | --- | ---: | ${texture.map(() => "---:").join(" | ")} |`,
      );
      for (const s of textureRows)
        lines.push(
          `| ${s.workload} | ${s.browser} | ${s.renderer} | ${s.panels} | ${texture.map((m) => cell(s, m)).join(" | ")} |`,
        );
      lines.push("");
    }
    lines.push(`### Memory and React (W0 / W2, ${lbl})`, "");
    lines.push(
      "| browser | renderer | presentation | panels | heap MB (W0) | DOM nodes | shell renders during W2 | page renders during W2 |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const s of scenarios.filter(
      (x) => x.label === lbl && x.workload === "W0",
    )) {
      const w2 = find(
        lbl,
        s.browser,
        s.renderer,
        s.presentation,
        s.panels,
        "W2",
      );
      lines.push(
        `| ${s.browser} | ${s.renderer} | ${s.presentation} | ${s.panels} | ${cell(s, "heapUsedMB")} | ${cell(s, "domNodes")} | ${cell(w2, "shellRenders")} | ${cell(w2, "pageRenders")} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Lifecycle stress (W4, 20 panels)", "");
  lines.push(
    "| env | browser | renderer | presentation | cycles | heap MB initial → final (forced GC) | slope MB/cycle | extract ms (median) | switch ms | restore ms | DOM nodes initial → final | final presentations / targets / SDK-marked / textures / subscriptions |",
    "| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | --- |",
  );
  for (const l of lifecycleSummary)
    lines.push(
      `| ${l.label} | ${l.browser} | ${l.renderer} | ${l.presentation} | ${l.cycles} | ${fmt(l.heapMB.initial)} → ${fmt(l.heapMB.final)} | ${fmt(l.heapMB.slopePerCycle)} | ${fmt(r3(l.timingMs.extract.median))} | ${fmt(r3(l.timingMs.switch.median))} | ${fmt(r3(l.timingMs.restore.median))} | ${l.domNodes.initial} → ${l.domNodes.final} | ${l.finalState.presentations.native + l.finalState.presentations.adaptive} / ${l.finalState.manipulationTargets} / ${l.finalState.sdkMarkedElements} / ${l.finalState.liveTextures} / ${l.finalState.dataSubscriptions} |`,
    );
  lines.push("", `## Invalid runs (${invalid.length})`, "");
  for (const i of invalid)
    lines.push(
      `- ${i.label} ${i.scenarioId} repeat ${i.repeat}: ${i.issues.join("; ")}`,
    );
  if (invalid.length === 0) lines.push("None.");
  writeFileSync(join(out, "benchmark-report.md"), `${lines.join("\n")}\n`);
}
