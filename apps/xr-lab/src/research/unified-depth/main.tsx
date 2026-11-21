/**
 * P1-08A2 research page (`research-depth.html`): unified depth compositing
 * feasibility. Isolated from the XR Lab shell and the SDK renderer hosts.
 *
 * URL parameters:
 *   track    hic | dom | three | babylon
 *   scenario S1 … S9 (see scene.ts)
 *   hit      order | clip        (hic, three adapter)
 *   compose  order | split       (dom)
 *   three    stock | adapter     (three)
 *   mount    direct | moved      (A5: mount in the track, or mount in plain
 *                                 DOM first and move the hosts in later)
 *   tick     1: 10 Hz content updates      animate  1: S8 motion
 *
 * `window.__depthLab` is the read-mostly test API. It never dispatches
 * input; tests use real Playwright mouse and keyboard actions.
 */
import {
  SCENARIOS,
  animated,
  planesOf,
  type ScenarioId,
  type ScenarioLayout,
} from "./scene.js";
import { SurfaceHosts, type SurfaceId } from "./surfaces.js";
import { clearLog, installDispatchRecorder, log } from "./events.js";
import { expectedAt, targetMargin } from "./oracle.js";
import { resolveVisibility } from "./depthResolver.js";
import { summarize, type Track, type TrackContext } from "./track.js";
import {
  HtmlInCanvasTrack,
  NATIVE_LAYOUT_LEFT,
  detectHtmlInCanvas,
} from "./htmlInCanvasTrack.js";
import { DomCompositorTrack } from "./domCompositorTrack.js";
import { ThreeTrack } from "./threeTrack.js";
import { BabylonTrack } from "./babylonTrack.js";
import type { SurfaceRef } from "../../../../../packages/core/src/workspace/index.js";

const params = new URLSearchParams(location.search);
const trackName = params.get("track") ?? "dom";
const scenario = (params.get("scenario") ?? "S3") as ScenarioId;
const base: ScenarioLayout = SCENARIOS[scenario] ?? SCENARIOS.S3;
const animate = params.get("animate") === "1";
const moved = params.get("mount") === "moved";

let current: ScenarioLayout = base;
const stage = document.getElementById("stage-root")!;
const staging = document.getElementById("staging")!;
const hosts = new SurfaceHosts({
  ticking: params.get("tick") === "1",
  nativeExtracted: !!base.native,
  nativeDrawable: !!base.native && trackName === "hic",
  nativeLayoutLeft:
    trackName === "hic" && params.get("nativeKeep") === "layout"
      ? NATIVE_LAYOUT_LEFT
      : 0,
});
const ctx: TrackContext = {
  stage,
  hosts,
  params,
  layout: () => current,
  // Planes of mounted Surfaces (A's Native element lives and dies with A).
  planes: () =>
    planesOf(current).filter(
      (p) =>
        p.key === "panel" ||
        hosts.mounted.has((p.key === "A/native" ? "A" : p.key) as SurfaceId),
    ),
};

const unsupported: Record<string, unknown> = {};
function createTrack(): Track | null {
  if (trackName === "hic" || trackName === "three" || trackName === "babylon") {
    const cap = detectHtmlInCanvas();
    // Babylon and stock Three.js still run without the API (their own
    // fallbacks are part of what we measure); raw HTML-in-Canvas cannot.
    if (trackName === "hic" && !cap.supported) {
      Object.assign(unsupported, cap);
      return null;
    }
    if (
      trackName === "three" &&
      params.get("three") === "adapter" &&
      !cap.supported
    ) {
      Object.assign(unsupported, cap);
      return null;
    }
  }
  switch (trackName) {
    case "hic":
      return new HtmlInCanvasTrack(ctx);
    case "three":
      return new ThreeTrack(ctx);
    case "babylon":
      return new BabylonTrack(ctx);
    default:
      return new DomCompositorTrack(ctx);
  }
}

installDispatchRecorder();
const track = createTrack();

function mountSurface(id: SurfaceId) {
  const m = hosts.add(id, current[id]);
  if (moved) {
    // A5 case 2: an ordinary, already-mounted page in plain DOM.
    Object.assign(m.host.style, {
      position: "relative",
      display: "inline-block",
      margin: "10px",
    });
    staging.append(m.host);
  } else track?.adopt(m);
  return m;
}

// `surfaces=A`: the one-Surface performance control.
const initial = (params.get("surfaces") ?? "A,B")
  .split(",")
  .filter((s): s is SurfaceId => s === "A" || s === "B");
for (const id of initial) mountSurface(id);

let last = 0;
const t0 = performance.now();
function loop(now: number) {
  if (track) {
    if (last) track.stats.intervals.push(now - last);
    last = now;
    if (animate) {
      current = animated(base, (now - t0) / 1000);
      for (const id of hosts.mounted.keys())
        hosts.setPlacement(id, current[id]);
    }
    try {
      track.frame();
    } catch (err) {
      track.stats.errors.push(String(err));
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

declare global {
  interface Window {
    __depthLab: unknown;
  }
}

window.__depthLab = {
  track: track?.name ?? null,
  trackParam: trackName,
  scenario,
  unsupported: track ? null : unsupported,
  canvasId: track?.canvasId ?? null,
  capability: () => track?.capability() ?? unsupported,
  expected: (x: number, y: number) =>
    expectedAt(
      ctx.planes(),
      x,
      y,
      track?.canvasId ?? "",
      track?.nativeInSlot ?? true,
    ),
  safe: (x: number, y: number, r: number) =>
    targetMargin(
      ctx.planes(),
      x,
      y,
      track?.canvasId ?? "",
      track?.nativeInSlot ?? true,
      r,
    ),
  visibility: () =>
    ctx.planes().map((p) => {
      const v = resolveVisibility(p, ctx.planes(), [0, 1.4, 0.3]);
      return {
        key: p.key,
        hiddenBy: v.hidden.map((h) => h.by),
        vertices: v.vertices,
      };
    }),
  log,
  clearLog,
  stats: () => {
    if (!track) return null;
    const s = track.stats;
    return {
      ...s,
      composeMs: summarize(s.composeMs),
      intervals: summarize(s.intervals.slice(1)),
    };
  },
  resetStats: () => {
    if (!track) return;
    const s = track.stats;
    s.frames =
      s.paints =
      s.uploads =
      s.uploadedPixels =
      s.clipWrites =
      s.geometryCalls =
        0;
    s.composeMs.length = 0;
    s.intervals.length = 0;
  },
  inspect: () =>
    (track as { inspect?: () => unknown } | null)?.inspect?.() ?? null,
  surfaces: () =>
    [...hosts.mounted.values()].map((m) => ({
      id: m.id,
      epoch: m.ref.epoch,
      parent: m.host.parentElement?.id ?? null,
    })),
  history: () => hosts.history,
  isCurrent: (ref: SurfaceRef, itemId: string) => hosts.isCurrent(ref, itemId),
  removeSurface: (id: SurfaceId) => {
    const ok = hosts.remove(id);
    track?.release(id);
    return ok;
  },
  addSurface: (id: SurfaceId) => mountSurface(id).ref,
  /** A5 case 2: move already-mounted hosts (state, listeners) into the track. */
  adoptStaged: () => {
    for (const m of hosts.mounted.values()) {
      Object.assign(m.host.style, {
        position: "absolute",
        display: "",
        margin: "0px",
      });
      track?.adopt(m);
    }
    return [...hosts.mounted.values()].map(
      (m) => m.host.parentElement?.id ?? null,
    );
  },
};
document.documentElement.dataset.ready = "1";
