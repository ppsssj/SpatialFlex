/**
 * P1-08A2 Track A: native HTML-in-Canvas (Chromium 157+ stable API) with a
 * raw WebGL2 renderer. No Three.js, no SDK renderer host.
 *
 * - `<canvas content="drawable">`; every Surface host is a `drawable` child;
 *   A's extracted Native element is a nested `drawable` inside A's own React
 *   tree (same DOM node, same root).
 * - `paint` event: upload changed drawables with `texElementSubImage2D` into
 *   mutable `texImage2D` storage sized from `getElementImageDefaultSize`,
 *   draw every plane into one depth buffer, then `updateElementGeometry` so
 *   the browser hit-tests the real DOM through the same 3D transform.
 * - Hit mode `order` (browser default): hit order is the drawables' order,
 *   one global order per element. Hit mode `clip`: each drawable is clipped
 *   (`clip-path`) to the region where it is the geometric depth owner, from
 *   the renderer-neutral resolver (hybrid of Designs 1 and 2).
 */
import {
  PANEL_RES,
  SURFACE_RES,
  NATIVE_RES,
  VIEW,
  cameraFrame,
  modelMatrix,
  mul4,
  viewportMatrix,
} from "./scene.js";
import { BACKGROUND, PANEL_COLOR, QuadRenderer } from "./gl.js";
import { resolveVisibility, type Polygon } from "./depthResolver.js";
import { emptyStats, type Track, type TrackContext } from "./track.js";
import type { MountedSurface, SurfaceId } from "./surfaces.js";
import { recordHandler } from "./events.js";
import { expectedAt } from "./oracle.js";

// The HTML-in-Canvas DOM/WebGL types come from the global declarations
// that @babylonjs/core ships for the WICG proposal (see the P1-08A2 doc).
type DrawableCanvas = HTMLCanvasElement;
type ElementUploadGL = WebGL2RenderingContext;
type PaintEvent = CanvasPaintEvent;

/**
 * With `nativeKeep=layout`, A's extracted Native card keeps its layout box
 * outside A's page (u 420–560, v 0–90) and A's hit clip keeps that box:
 * tests whether an ancestor's clip-path is applied to a nested drawable in
 * the ancestor's layout space rather than in canvas space.
 */
export const NATIVE_LAYOUT_LEFT = 420;

export function detectHtmlInCanvas() {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("content", "drawable");
  // Partial: the declarations exist whether or not the browser has them.
  const c = canvas as Partial<DrawableCanvas>;
  const gl = canvas.getContext("webgl2") as Partial<ElementUploadGL> | null;
  const r = {
    contentAttributeReflects: c.content === "drawable",
    requestPaint: typeof c.requestPaint === "function",
    onpaint: "onpaint" in c,
    captureElementImage: typeof c.captureElementImage === "function",
    getElementImageDefaultSize:
      typeof c.getElementImageDefaultSize === "function",
    updateElementGeometry: typeof c.updateElementGeometry === "function",
    clearElementGeometry: typeof c.clearElementGeometry === "function",
    texElementSubImage2D: typeof gl?.texElementSubImage2D === "function",
    // Pre-157 names (Three.js r187 still tests for this one).
    texElementImage2D: typeof gl?.texElementImage2D === "function",
    layoutSubtreeProperty: "layoutSubtree" in c,
    drawElementImage2D:
      typeof (
        CanvasRenderingContext2D.prototype as { drawElementImage?: unknown }
      ).drawElementImage === "function",
  };
  return {
    ...r,
    supported:
      r.contentAttributeReflects &&
      r.requestPaint &&
      r.updateElementGeometry &&
      r.texElementSubImage2D &&
      r.getElementImageDefaultSize,
  };
}

interface Drawable {
  readonly key: string;
  readonly el: HTMLElement;
  tex: WebGLTexture | null;
  w: number;
  h: number;
  uploaded: boolean;
  clip: string;
}

export class HtmlInCanvasTrack implements Track {
  readonly name = "html-in-canvas";
  readonly canvasId = "stage";
  readonly stats = emptyStats();
  readonly canvas: DrawableCanvas;
  readonly #r: QuadRenderer;
  readonly #gl: ElementUploadGL;
  readonly #drawables = new Map<string, Drawable>();
  readonly #hit: "order" | "clip" | "rect";
  readonly #ctx: TrackContext;
  readonly nativeInSlot: boolean;
  #paintPending = false;
  /** `rect` mode: whether every canvasClip equalled its exact region. */
  rectExact = true;

  constructor(ctx: TrackContext) {
    this.#ctx = ctx;
    const hit = ctx.params.get("hit");
    this.#hit = hit === "clip" || hit === "rect" ? hit : "order";
    this.nativeInSlot = !ctx.layout().native;
    const canvas = document.createElement("canvas") as DrawableCanvas;
    canvas.id = this.canvasId;
    canvas.width = VIEW.width;
    canvas.height = VIEW.height;
    canvas.setAttribute("content", "drawable");
    Object.assign(canvas.style, {
      width: `${VIEW.width}px`,
      height: `${VIEW.height}px`,
      display: "block",
    });
    ctx.stage.append(canvas);
    this.canvas = canvas;
    this.#r = new QuadRenderer(canvas);
    this.#gl = this.#r.gl as ElementUploadGL;
    canvas.addEventListener("paint", (e) => this.#paint(e as PaintEvent));
    // The Adaptive panel is renderer-drawn: the geometric router owns it.
    canvas.addEventListener("click", (e) => {
      if (e.target !== canvas) return;
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
    return detectHtmlInCanvas();
  }

  adopt(m: MountedSurface) {
    m.host.setAttribute("drawable", "");
    this.canvas.append(m.host);
    this.#drawables.set(m.id, this.#newDrawable(m.id, m.host));
    this.canvas.requestPaint();
  }

  #newDrawable(key: string, el: HTMLElement): Drawable {
    return { key, el, tex: null, w: 0, h: 0, uploaded: false, clip: "none" };
  }

  release(id: SurfaceId) {
    for (const key of id === "A" ? ["A", "A/native"] : [id]) {
      const d = this.#drawables.get(key);
      if (!d) continue;
      if (d.tex) {
        this.#gl.deleteTexture(d.tex);
        this.stats.texturesDeleted++;
        this.stats.texturesLive--;
        this.stats.textureBytes -= d.w * d.h * 4;
      }
      this.#drawables.delete(key);
    }
  }

  frame() {
    this.stats.frames++;
    if (!this.#paintPending) {
      this.#paintPending = true;
      this.canvas.requestPaint();
    }
  }

  #upload(d: Drawable, changed: readonly Element[] | undefined) {
    const gl = this.#gl;
    if (
      d.uploaded &&
      changed &&
      !changed.some((c) => c === d.el || d.el.contains(c))
    )
      return;
    let size: { width: number; height: number };
    try {
      size = this.canvas.getElementImageDefaultSize(d.el);
    } catch {
      // No paint record yet: retry on the next paint.
      return;
    }
    const w = Math.ceil(size.width);
    const h = Math.ceil(size.height);
    if (w === 0 || h === 0) return;
    if (!d.tex) {
      d.tex = gl.createTexture();
      this.stats.texturesAllocated++;
      this.stats.texturesLive++;
    }
    gl.bindTexture(gl.TEXTURE_2D, d.tex);
    if (d.w !== w || d.h !== h) {
      // Mutable storage: the element can change size.
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      this.stats.textureBytes += (w * h - d.w * d.h) * 4;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      d.w = w;
      d.h = h;
    }
    try {
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, d.el, {
        width: w,
        height: h,
      });
      d.uploaded = true;
      this.stats.uploads++;
      this.stats.uploadedPixels += w * h;
    } catch (err) {
      this.stats.errors.push(`upload ${d.key}: ${String(err)}`);
    }
  }

  #paint(e: PaintEvent) {
    this.#paintPending = false;
    // React 19 renders asynchronously: A's nested Native drawable appears
    // after `adopt`, so it is discovered here.
    const a = this.#drawables.get("A");
    if (a && this.#ctx.layout().native && !this.#drawables.has("A/native")) {
      const native = a.el.querySelector<HTMLElement>("#A-native");
      if (native)
        this.#drawables.set("A/native", this.#newDrawable("A/native", native));
    }
    const t0 = performance.now();
    this.stats.paints++;
    const planes = this.#ctx.planes();
    const frame = cameraFrame();
    const VP = frame.viewProjection;
    const VPORT = viewportMatrix();

    // Hit regions first (clip mode): a clip change is itself a content
    // change, re-captured on the next paint.
    if (this.#hit === "clip") {
      let vertices = 0;
      for (const d of this.#drawables.values()) {
        const self = planes.find((p) => p.key === d.key);
        if (!self) continue;
        // A's page must not cut its nested Native drawable's hit area.
        const keep: Polygon[] =
          d.key === "A" &&
          this.#drawables.has("A/native") &&
          this.#ctx.params.get("nativeKeep") === "layout"
            ? [
                [
                  [NATIVE_LAYOUT_LEFT, 0],
                  [NATIVE_LAYOUT_LEFT + NATIVE_RES.width, 0],
                  [NATIVE_LAYOUT_LEFT + NATIVE_RES.width, NATIVE_RES.height],
                  [NATIVE_LAYOUT_LEFT, NATIVE_RES.height],
                ],
              ]
            : [];
        const vis = resolveVisibility(self, planes, frame.eye, keep);
        vertices += vis.vertices;
        if (vis.clipPath !== d.clip) {
          d.el.style.clipPath = vis.clipPath;
          d.clip = vis.clipPath;
          this.stats.clipWrites++;
        }
      }
      this.stats.clipVertices = vertices;
    }

    for (const d of this.#drawables.values())
      this.#upload(d, e.changedElements);

    this.#r.begin(BACKGROUND);
    for (const p of planes) {
      const mvp = mul4(VP, modelMatrix(p.geometry));
      if (p.key === "panel") {
        this.#r.draw(mvp, PANEL_RES, PANEL_COLOR);
        continue;
      }
      const d = this.#drawables.get(p.key);
      if (d?.tex && d.uploaded)
        this.#r.draw(
          mvp,
          p.key === "A/native" ? NATIVE_RES : SURFACE_RES,
          d.tex,
        );
    }
    // Geometry: fixed order every paint (A, B, A/native), as the
    // InteractionManager pattern does. The browser hit-tests with it.
    // Hit mode `rect`: the proposal's `canvasClip` (a rectangle in element
    // space): the bounding box of the depth-owner region, exact only when
    // that region is itself an axis-aligned rectangle.
    let rectExact = true;
    for (const d of this.#drawables.values()) {
      const p = planes.find((q) => q.key === d.key);
      if (!p) continue;
      const m = mul4(VPORT, mul4(VP, modelMatrix(p.geometry)));
      const options: UpdateElementGeometryOptions = {
        canvasTransform: new DOMMatrix(m),
      };
      if (this.#hit === "rect") {
        const vis = resolveVisibility(p, planes, frame.eye);
        const pts = vis.pieces.flat();
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        const rect = pts.length
          ? {
              x: Math.min(...xs),
              y: Math.min(...ys),
              width: Math.max(...xs) - Math.min(...xs),
              height: Math.max(...ys) - Math.min(...ys),
            }
          : { x: 0, y: 0, width: 0, height: 0 };
        // `rectspace=canvas`: the same box mapped to canvas CSS pixels;
        // `rectspace=zero`: an empty clip (does the browser honor it at all?).
        const space = this.#ctx.params.get("rectspace");
        if (space === "zero")
          options.canvasClip = { x: 0, y: 0, width: 0, height: 0 };
        else if (space === "canvas") {
          const q = pts.map(([u, v]) =>
            new DOMPoint(u, v, 0, 1).matrixTransform(new DOMMatrix(m)),
          );
          const cx = q.map((p) => p.x / p.w);
          const cy = q.map((p) => p.y / p.w);
          options.canvasClip = {
            x: Math.min(...cx),
            y: Math.min(...cy),
            width: Math.max(...cx) - Math.min(...cx),
            height: Math.max(...cy) - Math.min(...cy),
          };
        } else options.canvasClip = rect;
        const exact =
          vis.pieces.length <= 1 &&
          (vis.pieces[0]?.length ?? 4) === 4 &&
          (vis.pieces[0] ?? []).every(
            ([u, v]) =>
              (Math.abs(u - rect.x) < 0.01 ||
                Math.abs(u - rect.x - rect.width) < 0.01) &&
              (Math.abs(v - rect.y) < 0.01 ||
                Math.abs(v - rect.y - rect.height) < 0.01),
          );
        rectExact &&= exact;
      }
      this.canvas.updateElementGeometry(d.el, options);
      this.stats.geometryCalls++;
    }
    this.rectExact = rectExact;
    this.stats.composeMs.push(performance.now() - t0);
  }

  dispose() {
    for (const id of ["A", "B"] as const) this.release(id);
    this.canvas.remove();
  }
}
