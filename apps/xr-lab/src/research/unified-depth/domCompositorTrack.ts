/**
 * P1-08A2 Track B: depth-aware DOM composition (browser-independent).
 *
 * Live DOM stays live DOM: each Surface host is a CSS-transformed page
 * (`surfaceTransform`, as the SDK does today) in its own layer above a
 * WebGL canvas that draws only the Adaptive panel. A's extracted Native
 * element stays a descendant of A's page (`nativePanelTransform`).
 *
 * Compose modes:
 * - `order` (ADR 0002 baseline): layers sorted far-to-near with `z-index`
 *   by center depth; cross-surface occluders (panel, A's Native element)
 *   cut with the SDK's `occlusionClipPath`, which decides front/back per
 *   occluder by its centroid.
 * - `split` (research): every page and the Native element are clipped to
 *   the region where they are the geometric depth owner, from the
 *   renderer-neutral resolver. Intersecting planes are split along the
 *   projected intersection line; z-index no longer matters for correctness.
 */
import {
  nativePanelTransform,
  occlusionClipPath,
  surfaceTransform,
  type Occluder,
} from "../../../../../packages/dom/src/projection.js";
import {
  intersectSurface,
  cssToWorld,
} from "../../../../../packages/core/src/workspace/index.js";
import {
  NATIVE_RES,
  PANEL_RES,
  SURFACE_RES,
  VIEW,
  cameraFrame,
  modelMatrix,
  mul4,
  poseOf,
} from "./scene.js";
import { BACKGROUND, PANEL_COLOR, QuadRenderer } from "./gl.js";
import {
  corners,
  resolveVisibility,
  type DepthPlane,
  type Polygon,
  type Vec3,
} from "./depthResolver.js";
import { emptyStats, type Track, type TrackContext } from "./track.js";
import type { MountedSurface, SurfaceId } from "./surfaces.js";
import { recordHandler } from "./events.js";
import { expectedAt } from "./oracle.js";

export class DomCompositorTrack implements Track {
  readonly name = "dom-compositor";
  readonly canvasId = "gl";
  readonly stats = emptyStats();
  readonly nativeInSlot: boolean;
  readonly #ctx: TrackContext;
  readonly #mode: "order" | "split";
  readonly #canvas: HTMLCanvasElement;
  readonly #r: QuadRenderer;
  readonly #layers = new Map<SurfaceId, HTMLElement>();
  readonly #written = new Map<HTMLElement, Record<string, string>>();

  constructor(ctx: TrackContext) {
    this.#ctx = ctx;
    this.#mode = ctx.params.get("compose") === "split" ? "split" : "order";
    this.nativeInSlot = !ctx.layout().native;
    Object.assign(ctx.stage.style, {
      position: "relative",
      width: `${VIEW.width}px`,
      height: `${VIEW.height}px`,
      overflow: "hidden",
    });
    const canvas = document.createElement("canvas");
    canvas.id = this.canvasId;
    canvas.width = VIEW.width;
    canvas.height = VIEW.height;
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: `${VIEW.width}px`,
      height: `${VIEW.height}px`,
      zIndex: "0",
    });
    ctx.stage.append(canvas);
    this.#canvas = canvas;
    this.#r = new QuadRenderer(canvas);
    canvas.addEventListener("click", (e) => {
      const hit = expectedAt(
        ctx.planes(),
        e.clientX,
        e.clientY,
        this.canvasId,
        this.nativeInSlot,
      );
      if (hit.owner === "panel") recordHandler("panel", 1, "panel");
    });
  }

  capability() {
    return {
      supported: true,
      cssTransform3d: CSS.supports(
        "transform",
        "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)",
      ),
      clipPathPath: CSS.supports(
        "clip-path",
        'path(nonzero, "M0 0 L1 0 L1 1 Z")',
      ),
      webgl2: !!document.createElement("canvas").getContext("webgl2"),
    };
  }

  adopt(m: MountedSurface) {
    const layer = document.createElement("div");
    layer.id = `layer-${m.id}`;
    Object.assign(layer.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
    });
    Object.assign(m.host.style, {
      transformOrigin: "0 0",
      pointerEvents: "auto",
    });
    layer.append(m.host);
    this.#ctx.stage.append(layer);
    this.#layers.set(m.id, layer);
    this.frame();
  }

  release(id: SurfaceId) {
    this.#layers.get(id)?.remove();
    this.#layers.delete(id);
  }

  #write(
    el: HTMLElement,
    prop: "transform" | "clipPath" | "zIndex",
    value: string,
  ) {
    const w = this.#written.get(el) ?? {};
    if (w[prop] === value) return;
    w[prop] = value;
    this.#written.set(el, w);
    el.style[prop] = value;
    if (prop === "clipPath") this.stats.clipWrites++;
  }

  frame() {
    const t0 = performance.now();
    this.stats.frames++;
    this.stats.paints++;
    const layout = this.#ctx.layout();
    const planes = this.#ctx.planes();
    const frame = cameraFrame();
    const eye = frame.eye as Vec3;
    const byKey = new Map(planes.map((p) => [p.key, p]));
    let vertices = 0;

    // Layer order far-to-near by center distance (baseline in both modes).
    const dist = (p: DepthPlane) => {
      const c = p.geometry.pose.position;
      return Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
    };
    const surfaces = [...this.#layers.keys()]
      .map((id) => byKey.get(id))
      .filter((p): p is DepthPlane => !!p)
      .sort((a, b) => dist(b) - dist(a));
    surfaces.forEach((p, i) =>
      this.#write(
        this.#layers.get(p.key as SurfaceId)!,
        "zIndex",
        String(i + 1),
      ),
    );

    for (const id of this.#layers.keys()) {
      const host = this.#ctx.hosts.mounted.get(id)?.host;
      const self = byKey.get(id);
      if (!host || !self) continue;
      const placement = layout[id];
      const pose = poseOf(placement, SURFACE_RES);
      const t = surfaceTransform(frame, pose, SURFACE_RES);
      if (t.visibility !== "visible") {
        this.#write(host, "transform", "scale(0)");
        continue;
      }
      this.#write(host, "transform", t.matrix3d);

      const native =
        id === "A" && layout.native
          ? host.querySelector<HTMLElement>("#A-native")
          : null;
      let nativePlane: DepthPlane | undefined;
      if (native && layout.native) {
        nativePlane = byKey.get("A/native");
        const nt = nativePanelTransform(
          frame,
          { pose, resolution: SURFACE_RES, border: 0 },
          { pose: poseOf(layout.native, NATIVE_RES), resolution: NATIVE_RES },
        );
        Object.assign(native.style, { transformOrigin: "0 0" });
        this.#write(
          native,
          "transform",
          nt.visibility === "visible" ? nt.matrix3d : "scale(0)",
        );
      }

      if (this.#mode === "order") {
        // ADR 0002 baseline: occluders of *other* planes (panel, other
        // Surface's or own Native element), front/back by centroid.
        const occluders: Occluder[] = planes
          .filter(
            (p) =>
              p.key !== id &&
              p.key !== "B" &&
              p.key !== "A" &&
              !(id === "A" && p.key === "A/native"),
          )
          .map((p) => corners(p.geometry) as unknown as Occluder);
        this.#write(
          host,
          "clipPath",
          occlusionClipPath(frame, pose, SURFACE_RES, occluders),
        );
        if (native && nativePlane) this.#write(native, "clipPath", "none");
        continue;
      }

      // split: depth-owner regions. A's page keeps its Native element's
      // visible footprint (clip-path clips descendants too).
      const keep: Polygon[] = [];
      if (native && nativePlane) {
        const nvis = resolveVisibility(nativePlane, planes, eye);
        vertices += nvis.vertices;
        this.#write(native, "clipPath", nvis.clipPath);
        for (const piece of nvis.pieces) {
          const mapped = piece.map(([u, v]) => {
            const x = cssToWorld(nativePlane!.geometry, u, v);
            const hit = intersectSurface(self.geometry, {
              origin: eye,
              direction: [x[0] - eye[0], x[1] - eye[1], x[2] - eye[2]],
            });
            return hit ? ([hit.u, hit.v] as const) : null;
          });
          if (mapped.every((p) => p)) keep.push(mapped as Polygon);
        }
      }
      // The page competes with every other plane except its own Native
      // element (which is drawn above it by DOM order, inside its keep).
      const competitors = planes.filter(
        (p) => !(id === "A" && p.key === "A/native"),
      );
      const vis = resolveVisibility(self, competitors, eye, keep);
      vertices += vis.vertices;
      this.#write(host, "clipPath", vis.clipPath);
    }
    this.stats.clipVertices = vertices;

    // Renderer: only the Adaptive panel (live DOM is never a texture here).
    this.#r.begin(BACKGROUND);
    const panel = byKey.get("panel");
    if (panel)
      this.#r.draw(
        mul4(frame.viewProjection, modelMatrix(panel.geometry)),
        PANEL_RES,
        PANEL_COLOR,
      );
    this.stats.composeMs.push(performance.now() - t0);
  }

  dispose() {
    for (const id of [...this.#layers.keys()]) this.release(id);
    this.#canvas.remove();
  }
}
