/**
 * P1-08A2 Track A3: Three.js r187 (the installed version) and HTML-in-Canvas.
 *
 * Mode `stock`: the r187 public API exactly as documented, unmodified:
 *   `material.map = new THREE.HTMLTexture(element)` and the
 *   `InteractionManager` addon. r187's WebGL upload only runs
 *   `if ('texElementImage2D' in gl)`; Chromium 157+ removed that method in
 *   favour of `texElementSubImage2D` (upstream PR mrdoob/three.js#34732,
 *   open, milestone r188). We record what actually happens.
 *
 * Mode `adapter`: an isolated research adapter, NOT production code and no
 *   renderer patching: the page owns a WebGL texture, uploads it with the
 *   current API in the canvas `paint` event, hands it to Three.js through
 *   the public `THREE.ExternalTexture`, and calls `renderer.resetState()`
 *   after its raw GL calls. Hit geometry uses `updateElementGeometry` from
 *   the same matrices Three.js renders with.
 */
import {
  ExternalTexture,
  HTMLTexture,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Color,
  Matrix4,
  WebGLRenderer,
  LinearSRGBColorSpace,
  SRGBColorSpace,
  type Texture,
} from "three";
import { InteractionManager } from "three/addons/interaction/InteractionManager.js";
import {
  EYE,
  MPP,
  PANEL_RES,
  SURFACE_RES,
  VIEW,
  mul4,
  viewportMatrix,
} from "./scene.js";
import { resolveVisibility } from "./depthResolver.js";
import { emptyStats, type Track, type TrackContext } from "./track.js";
import type { MountedSurface, SurfaceId } from "./surfaces.js";
import { detectHtmlInCanvas } from "./htmlInCanvasTrack.js";
import { recordHandler } from "./events.js";
import { expectedAt } from "./oracle.js";

type DrawableCanvas = HTMLCanvasElement;
type UploadGL = WebGL2RenderingContext;

interface Entry {
  readonly key: string;
  readonly el: HTMLElement;
  readonly mesh: Mesh;
  readonly texture: Texture;
  glTex: WebGLTexture | null;
  uploaded: boolean;
  w: number;
  h: number;
  clip: string;
}

export class ThreeTrack implements Track {
  readonly name: string;
  readonly canvasId = "stage";
  readonly stats = emptyStats();
  readonly nativeInSlot: boolean;
  readonly #ctx: TrackContext;
  readonly #mode: "stock" | "adapter";
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera: PerspectiveCamera;
  readonly #entries = new Map<string, Entry>();
  readonly #panel: Mesh;
  readonly #interactions: InteractionManager | null = null;
  readonly canvas: DrawableCanvas;
  #pending = false;
  readonly #hit: "order" | "clip";

  constructor(ctx: TrackContext) {
    this.#ctx = ctx;
    this.#mode = ctx.params.get("three") === "adapter" ? "adapter" : "stock";
    this.#hit = ctx.params.get("hit") === "clip" ? "clip" : "order";
    this.name = `three-r187-${this.#mode}`;
    this.nativeInSlot = true;
    const canvas = document.createElement("canvas") as DrawableCanvas;
    canvas.id = this.canvasId;
    Object.assign(canvas.style, {
      width: `${VIEW.width}px`,
      height: `${VIEW.height}px`,
      display: "block",
    });
    ctx.stage.append(canvas);
    this.canvas = canvas;
    if (this.#mode === "adapter") canvas.setAttribute("content", "drawable");
    this.#renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    this.#renderer.setPixelRatio(1);
    // Adapter: unlit page pixels pass through as-is (an SRGB8_ALPHA8 upload
    // target is the slow P1-07D path).
    if (this.#mode === "adapter")
      this.#renderer.outputColorSpace = LinearSRGBColorSpace;
    this.#renderer.setSize(VIEW.width, VIEW.height, false);
    // Same displayed colors in both modes (stock: sRGB output encoding).
    const rgb = (r: number, g: number, b: number) =>
      new Color().setRGB(
        r / 255,
        g / 255,
        b / 255,
        this.#mode === "adapter" ? LinearSRGBColorSpace : SRGBColorSpace,
      );
    this.#scene.background = rgb(200, 200, 200);
    this.#camera = new PerspectiveCamera(
      50,
      VIEW.width / VIEW.height,
      0.1,
      100,
    );
    this.#camera.position.set(...EYE);
    this.#camera.lookAt(0, 1.4, -1);
    this.#camera.updateMatrixWorld();
    this.#panel = new Mesh(
      new PlaneGeometry(PANEL_RES.width * MPP, PANEL_RES.height * MPP),
      new MeshBasicMaterial({ color: rgb(40, 180, 80) }),
    );
    this.#panel.visible = false;
    this.#scene.add(this.#panel);
    if (this.#mode === "stock") {
      this.#interactions = new InteractionManager();
      this.#interactions.connect(this.#renderer, this.#camera);
    } else {
      canvas.addEventListener("paint", (e) => this.#paint(e.changedElements));
    }
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
    const gl = this.#renderer.getContext() as Partial<UploadGL>;
    return {
      ...detectHtmlInCanvas(),
      threeRevision: "187",
      rendererHasTexElementImage2D: "texElementImage2D" in gl,
      rendererHasTexElementSubImage2D:
        typeof gl.texElementSubImage2D === "function",
      mode: this.#mode,
    };
  }

  /** What stock r187 did to the DOM and GL (A3 evidence). */
  inspect() {
    const gl = this.#renderer.getContext();
    return {
      canvasLayoutSubtree: this.canvas.getAttribute("layoutsubtree"),
      canvasContent: this.canvas.getAttribute("content"),
      hosts: [...this.#entries.values()].map((e) => ({
        key: e.key,
        parentIsCanvas: e.el.parentElement === this.canvas,
        drawable: e.el.hasAttribute("drawable"),
        transform: e.el.style.transform.slice(0, 40),
        textureVersion: e.texture.version,
      })),
      glError: gl.getError(),
      renderInfo: {
        ...this.#renderer.info.memory,
        calls: this.#renderer.info.render.calls,
      },
    };
  }

  adopt(m: MountedSurface) {
    const geometry = new PlaneGeometry(
      SURFACE_RES.width * MPP,
      SURFACE_RES.height * MPP,
    );
    let texture: Texture;
    if (this.#mode === "stock") {
      // Exactly the documented usage: a detached element; r187 appends it
      // to the canvas itself, but only inside its texElementImage2D branch.
      texture = new HTMLTexture(m.host);
    } else {
      m.host.setAttribute("drawable", "");
      this.canvas.append(m.host);
      texture = new ExternalTexture(null);
      // Element rows are uploaded top-first; PlaneGeometry has v = 1 at the top.
      texture.repeat.set(1, -1);
      texture.offset.set(0, 1);
      // Page pixels are sRGB already. r187 ignores `colorSpace` on an
      // ExternalTexture (sRGB decode comes from the GL internal format), so
      // the adapter writes them through unencoded (see constructor).
    }
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: texture }));
    this.#scene.add(mesh);
    if (this.#interactions) this.#interactions.add(mesh);
    this.#entries.set(m.id, {
      key: m.id,
      el: m.host,
      mesh,
      texture,
      glTex: null,
      uploaded: false,
      w: 0,
      h: 0,
      clip: "none",
    });
  }

  release(id: SurfaceId) {
    const e = this.#entries.get(id);
    if (!e) return;
    this.#scene.remove(e.mesh);
    this.#interactions?.remove(e.mesh);
    e.texture.dispose();
    if (e.glTex) {
      this.#renderer.getContext().deleteTexture(e.glTex);
      this.stats.texturesDeleted++;
      this.stats.texturesLive--;
      this.stats.textureBytes -= e.w * e.h * 4;
    }
    (e.mesh.geometry as PlaneGeometry).dispose();
    this.#entries.delete(id);
  }

  #place() {
    const planes = this.#ctx.planes();
    for (const p of planes) {
      const target =
        p.key === "panel" ? this.#panel : this.#entries.get(p.key)?.mesh;
      if (!target) continue;
      target.position.set(...p.geometry.pose.position);
      target.quaternion.copy(new Quaternion(...p.geometry.pose.rotation));
      target.visible = true;
      target.updateMatrixWorld();
    }
  }

  frame() {
    this.stats.frames++;
    this.#place();
    if (this.#mode === "stock") {
      const t0 = performance.now();
      this.#interactions?.update();
      this.#renderer.render(this.#scene, this.#camera);
      this.stats.paints++;
      this.stats.composeMs.push(performance.now() - t0);
      return;
    }
    if (!this.#pending) {
      this.#pending = true;
      this.canvas.requestPaint();
    }
  }

  #paint(changed: readonly Element[]) {
    this.#pending = false;
    const t0 = performance.now();
    this.stats.paints++;
    const gl = this.#renderer.getContext() as UploadGL;
    const planes = this.#ctx.planes();
    const eye = EYE;
    if (this.#hit === "clip") {
      let vertices = 0;
      for (const e of this.#entries.values()) {
        const self = planes.find((p) => p.key === e.key);
        if (!self) continue;
        const vis = resolveVisibility(self, planes, eye);
        vertices += vis.vertices;
        if (vis.clipPath !== e.clip) {
          e.el.style.clipPath = vis.clipPath;
          e.clip = vis.clipPath;
          this.stats.clipWrites++;
        }
      }
      this.stats.clipVertices = vertices;
    }
    for (const e of this.#entries.values()) {
      if (e.uploaded && !changed.some((c) => c === e.el || e.el.contains(c)))
        continue;
      let size;
      try {
        size = this.canvas.getElementImageDefaultSize(e.el);
      } catch {
        continue;
      }
      const w = Math.ceil(size.width);
      const h = Math.ceil(size.height);
      if (!e.glTex) {
        e.glTex = gl.createTexture();
        this.stats.texturesAllocated++;
        this.stats.texturesLive++;
        (e.texture as ExternalTexture).sourceTexture = e.glTex;
      }
      gl.bindTexture(gl.TEXTURE_2D, e.glTex);
      if (e.w !== w || e.h !== h) {
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
        this.stats.textureBytes += (w * h - e.w * e.h) * 4;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        e.w = w;
        e.h = h;
      }
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e.el, {
        width: w,
        height: h,
      });
      e.uploaded = true;
      this.stats.uploads++;
      this.stats.uploadedPixels += w * h;
    }
    // Raw GL above changed bindings behind Three.js's state cache.
    this.#renderer.resetState();
    this.#renderer.render(this.#scene, this.#camera);
    const VP = new Matrix4().multiplyMatrices(
      this.#camera.projectionMatrix,
      this.#camera.matrixWorldInverse,
    );
    // Element CSS (u, v) → PlaneGeometry local (centered, +y up).
    const toPlane = [
      MPP,
      0,
      0,
      0,
      0,
      -MPP,
      0,
      0,
      0,
      0,
      MPP,
      0,
      (-SURFACE_RES.width * MPP) / 2,
      (SURFACE_RES.height * MPP) / 2,
      0,
      1,
    ];
    for (const e of this.#entries.values()) {
      const m = mul4(
        viewportMatrix(),
        mul4(VP.elements, mul4(e.mesh.matrixWorld.elements, toPlane)),
      );
      this.canvas.updateElementGeometry(e.el, {
        canvasTransform: new DOMMatrix(m),
      });
      this.stats.geometryCalls++;
    }
    this.stats.composeMs.push(performance.now() - t0);
  }

  dispose() {
    for (const id of [...this.#entries.keys()]) this.release(id as SurfaceId);
    this.#interactions?.disconnect();
    this.#renderer.dispose();
    this.canvas.remove();
  }
}
