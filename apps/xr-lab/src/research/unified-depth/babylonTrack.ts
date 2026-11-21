/**
 * P1-08A2 Track A4: Babylon.js 9.36 (installed) `HtmlTexture` +
 * `HtmlInteractionManager`, used as documented, unmodified.
 *
 * Babylon 9.36 already targets the current API (`content="drawable"`,
 * `texElementSubImage2D`, `updateElementGeometry` with
 * `preserveHitTestOrder: true`). Its interaction manager registers a
 * screen-aligned 2D affine `canvasTransform` (center, size, in-plane
 * rotation; no perspective), so oblique planes are expected to hit-test
 * imperfectly. We measure it.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { HtmlTexture } from "@babylonjs/core/Materials/Textures/HTML/htmlTexture";
import { HtmlInteractionManager } from "@babylonjs/core/Materials/Textures/HTML/htmlInteractionManager";
import { EYE, MPP, PANEL_RES, SURFACE_RES, VIEW } from "./scene.js";
import { emptyStats, type Track, type TrackContext } from "./track.js";
import type { MountedSurface, SurfaceId } from "./surfaces.js";
import { detectHtmlInCanvas } from "./htmlInCanvasTrack.js";
import { recordHandler } from "./events.js";
import { expectedAt } from "./oracle.js";

interface Entry {
  readonly mesh: Mesh;
  readonly texture: HtmlTexture;
  readonly manager: HtmlInteractionManager;
}

export class BabylonTrack implements Track {
  readonly name = "babylon-9.36";
  readonly canvasId = "stage";
  readonly stats = emptyStats();
  readonly nativeInSlot = true;
  readonly #ctx: TrackContext;
  readonly #engine: Engine;
  readonly #scene: Scene;
  readonly #entries = new Map<SurfaceId, Entry>();
  readonly #panel: Mesh;
  readonly canvas: HTMLCanvasElement;

  constructor(ctx: TrackContext) {
    this.#ctx = ctx;
    const canvas = document.createElement("canvas");
    canvas.id = this.canvasId;
    canvas.width = VIEW.width;
    canvas.height = VIEW.height;
    Object.assign(canvas.style, {
      width: `${VIEW.width}px`,
      height: `${VIEW.height}px`,
      display: "block",
    });
    ctx.stage.append(canvas);
    this.canvas = canvas;
    this.#engine = new Engine(canvas, false, {
      preserveDrawingBuffer: true,
      stencil: false,
    });
    this.#scene = new Scene(this.#engine);
    this.#scene.useRightHandedSystem = true;
    this.#scene.clearColor = new Color4(200 / 255, 200 / 255, 200 / 255, 1);
    const camera = new UniversalCamera("cam", new Vector3(...EYE), this.#scene);
    camera.setTarget(new Vector3(0, 1.4, -1));
    camera.fov = (50 * Math.PI) / 180;
    camera.minZ = 0.1;
    camera.maxZ = 100;
    this.#panel = CreatePlane(
      "panel",
      { width: PANEL_RES.width * MPP, height: PANEL_RES.height * MPP },
      this.#scene,
    );
    const pm = new StandardMaterial("panel", this.#scene);
    pm.disableLighting = true;
    pm.emissiveColor = new Color3(40 / 255, 180 / 255, 80 / 255);
    this.#panel.material = pm;
    this.#panel.setEnabled(false);
    this.#scene.onAfterRenderObservable.add(() => this.stats.paints++);
    canvas.addEventListener("click", (e) => {
      if (e.target !== canvas) return;
      const hit = expectedAt(
        ctx.planes(),
        e.clientX,
        e.clientY,
        this.canvasId,
        true,
      );
      if (hit.owner === "panel") recordHandler("panel", 1, "panel");
    });
  }

  capability() {
    return { ...detectHtmlInCanvas(), babylon: Engine.Version };
  }

  inspect() {
    return [...this.#entries.entries()].map(([id, e]) => ({
      id,
      parentIsCanvas: e.texture.element.parentElement === this.canvas,
      drawable: e.texture.element.hasAttribute("drawable"),
      inert: e.texture.element.hasAttribute("inert"),
      isReady: e.texture.isReady(),
    }));
  }

  adopt(m: MountedSurface) {
    const mesh = CreatePlane(
      `surface-${m.id}`,
      { width: SURFACE_RES.width * MPP, height: SURFACE_RES.height * MPP },
      this.#scene,
    );
    const texture = new HtmlTexture(`html-${m.id}`, m.host, {
      scene: this.#scene,
      width: SURFACE_RES.width,
      height: SURFACE_RES.height,
      autoUpdate: true,
    });
    const material = new StandardMaterial(`mat-${m.id}`, this.#scene);
    material.disableLighting = true;
    material.emissiveTexture = texture;
    material.backFaceCulling = false;
    mesh.material = material;
    const manager = new HtmlInteractionManager(this.#scene, texture, mesh);
    this.#entries.set(m.id, { mesh, texture, manager });
    this.stats.texturesAllocated++;
    this.stats.texturesLive++;
    // Babylon allocates the texture at the requested size (dynamic texture).
    this.stats.textureBytes += SURFACE_RES.width * SURFACE_RES.height * 4;
  }

  release(id: SurfaceId) {
    const e = this.#entries.get(id);
    if (!e) return;
    e.manager.dispose();
    e.texture.dispose();
    e.mesh.dispose();
    this.#entries.delete(id);
    this.stats.texturesDeleted++;
    this.stats.texturesLive--;
    this.stats.textureBytes -= SURFACE_RES.width * SURFACE_RES.height * 4;
  }

  frame() {
    const t0 = performance.now();
    this.stats.frames++;
    for (const p of this.#ctx.planes()) {
      const mesh =
        p.key === "panel"
          ? this.#panel
          : this.#entries.get(p.key as SurfaceId)?.mesh;
      if (!mesh) continue;
      mesh.setEnabled(true);
      mesh.position.set(...p.geometry.pose.position);
      mesh.rotationQuaternion = new Quaternion(...p.geometry.pose.rotation);
    }
    this.#scene.render();
    this.stats.composeMs.push(performance.now() - t0);
  }

  dispose() {
    for (const id of [...this.#entries.keys()]) this.release(id);
    this.#scene.dispose();
    this.#engine.dispose();
    this.canvas.remove();
  }
}
