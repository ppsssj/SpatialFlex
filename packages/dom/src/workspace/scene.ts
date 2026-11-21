import {
  FrameAuthority,
  IndeterminateDepthError,
  InputRouter,
  resolveDepthSnapshot,
  sameItem,
  sameSurface,
  surfaceSize,
  type DepthPlane,
  type FrameVerdict,
  type HostLease,
  type InputHit,
  type InputOwner,
  type Route,
  type ScopedPresentationRef,
  type SurfaceGeometry,
  type SurfaceRef,
  type VisibilityResult,
} from "@spatialflex/core/workspace";
import {
  eulerFromQuaternion,
  surfaceTransform,
  viewportRay,
  type CameraFrame,
  type SpatialWebSurfacePose,
} from "../projection.js";
import type { PresentationHost } from "../presentationRuntime.js";
import type { WorkspaceCoordinator, WorkspaceSurface } from "./coordinator.js";

/**
 * P1-08B3 shared-scene integration of a Multi-Surface Workspace
 * (EXPERIMENTAL; may change without notice).
 *
 * One `WorkspaceScene` per `WorkspaceCoordinator`. It is the only path from
 * a renderer's camera to the Surfaces:
 *
 * 1. Frames: renderers connect (`connectRenderer`) and get a
 *    `FrameAuthority` lease. Only the authoritative lease's frames are
 *    accepted; older or equal sequences are stale; a disconnect or a
 *    handover discards the previous camera frame.
 * 2. Depth: every accepted frame builds ONE immutable
 *    `resolveDepthSnapshot` over the live Surface pages and their Adaptive
 *    panels. The same snapshot clips the pages (screen) and answers the
 *    pointer ray (input): visible owner = depth owner = input owner.
 * 3. Composition: each page (live DOM, attached with `attachPage`) gets the
 *    frame's `surfaceTransform` and its visible-region `clip-path`. Each live
 *    Surface's own runtime receives the frame through its own
 *    `PresentationHost` (`coordinator.connectHost`), connected for the
 *    authoritative lease only and disconnected on removal, handover or
 *    renderer disconnect.
 * 4. Input: `bindInput` puts a capture-phase gate in front of the pages.
 *    A pointer down is routed by the `InputRouter` from the snapshot's ray
 *    owner; the DOM target must be that owner or the event is cancelled.
 *
 * Fail-closed depth policy: when the snapshot (or a later ray query) throws
 * `IndeterminateDepthError`, nothing of it is applied or kept; the scene
 * becomes `indeterminate`, every gesture is cancelled, keyboard focus is
 * released, and pages fall back to an unclipped, marked, NON-interactive
 * display (or hidden, `indeterminateDisplay: "hidden"`). The next frame
 * that resolves restores normal operation.
 *
 * Not supported here (see docs/p1-08b3-multisurface-xr-integration.md):
 * Native DOM presentations inside the shared scene (their page `keep`
 * footprints are not part of the snapshot), non-planar content, and DOM
 * pages inside an immersive WebXR session (status `suspended`).
 */

export type DepthSnapshot = ReturnType<typeof resolveDepthSnapshot>;

/**
 * - `waiting`: no authoritative camera frame (start, handover, disconnect).
 * - `resolved`: the current frame's snapshot drives screen and input.
 * - `indeterminate`: depth could not be resolved for the current frame;
 *   fail closed.
 * - `suspended`: the authoritative renderer presents immersively; DOM pages
 *   cannot be shown there, so they are hidden and take no input.
 */
export type SceneStatus =
  "waiting" | "resolved" | "indeterminate" | "suspended";

export interface SceneError {
  readonly sequence: number;
  readonly phase: "snapshot" | "ray";
  readonly name: string;
  readonly message: string;
}

/** Observable scene state (changes on status changes only, not per frame). */
export interface WorkspaceSceneSnapshot {
  readonly version: number;
  readonly status: SceneStatus;
  readonly authority: HostLease | null;
  readonly error: SceneError | null;
}

export interface WorkspaceRenderer {
  readonly lease: HostLease;
  /**
   * After each rendered frame, with a per-renderer increasing sequence.
   * The frame is copied; only an `accepted` frame is composited.
   */
  frame(sequence: number, frame: CameraFrame): FrameVerdict;
  /** Explicit handover to this renderer (its previous frames do not count). */
  authorize(): boolean;
  /** The renderer presents an immersive session (DOM pages cannot show). */
  setImmersive(immersive: boolean): void;
  disconnect(): void;
}

export interface WorkspaceSceneOptions {
  /** Display of pages while depth is indeterminate (default `fallback`). */
  readonly indeterminateDisplay?: "fallback" | "hidden";
  /** Depth resolution (tests inject failures here). */
  readonly resolve?: typeof resolveDepthSnapshot;
  /** Clock for the timings (default `performance.now`). */
  readonly now?: () => number;
}

/** Where a DOM event landed, as the input gate sees it. */
export type InputTarget =
  | { readonly kind: "surface"; readonly ref: SurfaceRef }
  /** The renderer's canvas (Adaptive panels, background). */
  | { readonly kind: "scene" }
  /** Not part of the workspace (application chrome). */
  | { readonly kind: "outside" };

export interface InputDecision {
  readonly allow: boolean;
  readonly route: Route | null;
  readonly reason: string;
}

/** Per-frame inspection data of one Surface (diagnostics, tests). */
export interface SceneSurfaceView {
  readonly key: string;
  readonly ref: SurfaceRef;
  readonly visibility: "visible" | "behind" | "back" | "hidden" | "waiting";
  readonly clipPath: string | null;
  readonly pieces: number;
  readonly hiddenBy: readonly string[];
  readonly interactive: boolean;
  readonly host: boolean;
  readonly page: boolean;
}

const PANEL_MPP = 0.001;
const SAMPLES = 600;
const EMPTY_HITS: readonly InputHit[] = [];

/** World pose of a Surface in the DOM compositor's terms. */
export function poseOfGeometry(g: SurfaceGeometry): SpatialWebSurfacePose {
  const { width, height } = surfaceSize(g);
  return {
    position: g.pose.position,
    rotation: eulerFromQuaternion(g.pose.rotation),
    width,
    height,
  };
}

export const surfaceKey = (ref: SurfaceRef) =>
  `surface:${ref.surfaceId}@${ref.epoch}`;

interface PlaneOwner {
  readonly owner: InputOwner;
  readonly surface: WorkspaceSurface;
}

interface PageState {
  readonly element: HTMLElement;
  transform: string;
  clip: string;
  visibility: string;
  depth: string;
  z: string;
}

/** The last {@link SAMPLES} timings of one kind, in ms (diagnostics). */
class Samples {
  readonly values: number[] = [];
  push(v: number) {
    this.values.push(v);
    if (this.values.length > SAMPLES) this.values.shift();
  }
  clear() {
    this.values.length = 0;
  }
}

export class WorkspaceScene {
  readonly #coordinator: WorkspaceCoordinator;
  readonly #authority = new FrameAuthority<CameraFrame>();
  readonly #router: InputRouter;
  readonly #resolve: typeof resolveDepthSnapshot;
  readonly #now: () => number;
  readonly #display: "fallback" | "hidden";
  readonly #listeners = new Set<() => void>();
  /** Per live Surface (by key): its runtime host for the authority lease. */
  readonly #hosts = new Map<
    string,
    { readonly lease: HostLease; readonly host: PresentationHost }
  >();
  readonly #pages = new Map<string, PageState>();
  readonly #elements = new Map<Element, string>();
  readonly #interactive = new Map<string, boolean>();
  readonly #immersive = new Set<HostLease>();
  #layer: HTMLElement | null = null;
  #layerKey = "";
  #live = new Map<string, WorkspaceSurface>();
  #status: SceneStatus = "waiting";
  #error: SceneError | null = null;
  #frame: CameraFrame | null = null;
  #sequence = -1;
  #depth: DepthSnapshot | null = null;
  #owners = new Map<string, PlaneOwner>();
  #views = new Map<string, SceneSurfaceView>();
  #lastUp: Route | null = null;
  #snapshot: WorkspaceSceneSnapshot = Object.freeze({
    version: 0,
    status: "waiting" as SceneStatus,
    authority: null,
    error: null,
  });
  #unsubscribe: (() => void) | null = null;
  #disposed = false;
  readonly counters = {
    accepted: 0,
    rejected: 0,
    failures: 0,
    blocked: 0,
    /** DOM target differed from the snapshot's owner (should stay 0). */
    mismatches: 0,
    cancelledGestures: 0,
  };
  readonly timings = {
    /** `resolveDepthSnapshot` per accepted frame, ms. */
    resolve: new Samples(),
    /** Transforms, clips and DOM writes of all pages per frame, ms. */
    compose: new Samples(),
    /** Whole accepted frame (depth, composition, runtime hosts), ms. */
    frame: new Samples(),
    /** Pointer-down ownership decision (ray, snapshot, router), ms. */
    pointer: new Samples(),
  };

  constructor(
    coordinator: WorkspaceCoordinator,
    options: WorkspaceSceneOptions = {},
  ) {
    this.#coordinator = coordinator;
    this.#resolve = options.resolve ?? resolveDepthSnapshot;
    this.#now = options.now ?? (() => performance.now());
    this.#display = options.indeterminateDisplay ?? "fallback";
    this.#router = new InputRouter({
      isLive: (owner) =>
        owner.kind === "surface"
          ? coordinator.isLive(owner.surface)
          : coordinator.isCurrent({
              item: owner.item,
              instanceId: owner.instanceId,
            }),
      isAuthoritative: (lease) =>
        this.#status === "resolved" && this.#authority.isAuthoritative(lease),
    });
  }

  /**
   * Starts following the coordinator on first use (renderer, layer, page or
   * input), not in the constructor: an instance React discards (StrictMode
   * double-invokes state initializers) never subscribes.
   */
  #follow() {
    if (this.#unsubscribe || this.#disposed) return;
    this.#unsubscribe = this.#coordinator.subscribe(this.#onSurfaces);
    this.#onSurfaces();
  }

  // --- Observation -------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): WorkspaceSceneSnapshot => this.#snapshot;

  /** The current depth snapshot, if the scene is `resolved`. */
  get depth(): DepthSnapshot | null {
    return this.#depth;
  }

  /** Per-frame state of every live Surface (diagnostics). */
  inspect() {
    return {
      status: this.#status,
      sequence: this.#sequence,
      authority: this.#authority.authority,
      surfaces: [...this.#live.keys()].map(
        (key) => this.#views.get(key) ?? this.#idleView(key),
      ),
      hosts: this.#hosts.size,
      pages: this.#pages.size,
      captures: this.#router.captures.length,
      keyboardOwner: this.#router.keyboardOwner(),
      counters: { ...this.counters },
    };
  }

  // --- Renderers and frames ----------------------------------------------

  connectRenderer(hostId: string): WorkspaceRenderer {
    this.#assertLive();
    this.#follow();
    const lease = this.#authority.connect(hostId);
    return {
      lease,
      frame: (sequence, frame) => this.#onFrame(lease, sequence, frame),
      authorize: () => {
        const before = this.#authority.authority;
        if (!this.#authority.authorize(lease)) return false;
        if (before !== lease) this.#authorityChanged(before);
        return true;
      },
      setImmersive: (immersive) => {
        if (immersive) this.#immersive.add(lease);
        else this.#immersive.delete(lease);
        if (this.#authority.isAuthoritative(lease) && immersive)
          this.#suspend();
      },
      disconnect: () => {
        const was = this.#authority.isAuthoritative(lease);
        if (!this.#authority.disconnect(lease)) return;
        this.#immersive.delete(lease);
        this.#cancelGestures(lease);
        for (const [key, entry] of [...this.#hosts])
          if (entry.lease === lease) {
            this.#hosts.delete(key);
            entry.host.disconnect();
          }
        if (was) this.#invalidate("waiting", null);
      },
    };
  }

  #onFrame(lease: HostLease, sequence: number, frame: CameraFrame) {
    if (this.#disposed) return "disconnected" as const;
    const before = this.#authority.authority;
    const copy: CameraFrame = {
      viewProjection: Array.from(frame.viewProjection),
      viewport: { ...frame.viewport },
      eye: [frame.eye[0], frame.eye[1], frame.eye[2]],
    };
    const verdict = this.#authority.submit(lease, sequence, copy);
    if (verdict !== "accepted") {
      this.counters.rejected++;
      return verdict;
    }
    if (before !== lease) this.#authorityChanged(before);
    this.counters.accepted++;
    const start = this.#now();
    this.#frame = copy;
    this.#sequence = sequence;
    this.#syncHosts(lease);
    if (this.#immersive.has(lease)) {
      this.#suspend();
    } else {
      this.#resolveDepth(copy);
      const t = this.#now();
      this.#compose(copy);
      this.timings.compose.push(this.#now() - t);
    }
    // Each live Surface's own runtime gets the same frame (Adaptive-only
    // here: no Native presentations, so viewport mode, no occluders).
    for (const { host } of this.#hosts.values())
      host.frame(copy, { occluders: [] });
    this.timings.frame.push(this.#now() - start);
    return verdict;
  }

  /** One immutable snapshot per frame, or none (fail closed). */
  #resolveDepth(frame: CameraFrame) {
    const planes: DepthPlane[] = [];
    const owners = new Map<string, PlaneOwner>();
    for (const [key, surface] of this.#live) {
      planes.push({ key, geometry: surface.geometry });
      owners.set(key, {
        owner: { kind: "surface", surface: surface.ref },
        surface,
      });
      for (const { presentation, extent } of surface.runtime.adaptivePanels()) {
        const pose = surface.runtime.manipulation.poseOf(presentation.itemId);
        if (!pose) continue;
        const [x, y, z, w] = pose.rotation;
        const n = Math.hypot(x, y, z, w);
        const panelKey = `panel:${surface.ref.surfaceId}@${surface.ref.epoch}/${presentation.instanceId}`;
        planes.push({
          key: panelKey,
          geometry: {
            resolution: {
              width: extent.width / PANEL_MPP,
              height: extent.height / PANEL_MPP,
            },
            metersPerPixel: PANEL_MPP,
            pose: {
              position: pose.position,
              rotation: [x / n, y / n, z / n, w / n],
              scale: pose.scale,
            },
          },
        });
        owners.set(panelKey, {
          owner: {
            kind: "presentation",
            item: {
              surface: surface.ref,
              itemId: presentation.itemId,
              registrationKey: presentation.registrationKey,
            },
            instanceId: presentation.instanceId,
          },
          surface,
        });
      }
    }
    const t = this.#now();
    try {
      const depth = this.#resolve(planes, frame.eye);
      this.timings.resolve.push(this.#now() - t);
      this.#depth = depth;
      this.#owners = owners;
      this.#error = null;
      this.#setStatus("resolved");
    } catch (error) {
      this.timings.resolve.push(this.#now() - t);
      this.#fail("snapshot", error);
    }
  }

  /** Discards the snapshot and everything decided from it. */
  #fail(phase: SceneError["phase"], error: unknown) {
    this.counters.failures++;
    const e = error instanceof Error ? error : new Error(String(error));
    this.#error = Object.freeze({
      sequence: this.#sequence,
      phase,
      name:
        error instanceof IndeterminateDepthError
          ? "IndeterminateDepthError"
          : e.name,
      message: e.message,
    });
    this.#invalidate("indeterminate", this.#error);
    // The screen result of the failed snapshot goes too: fallback display.
    if (this.#frame) this.#compose(this.#frame);
  }

  /** Drops the snapshot, its input decisions and gestures. */
  #invalidate(status: SceneStatus, error: SceneError | null) {
    this.#depth = null;
    this.#owners = new Map();
    this.#lastUp = null;
    this.#error = error;
    const authority = this.#authority.authority;
    if (authority) this.#cancelGestures(authority);
    this.#router.focus(null);
    this.#blurPages();
    if (status !== "indeterminate") {
      if (status === "waiting") this.#frame = null;
      this.#hidePages(status);
    }
    this.#setStatus(status);
  }

  #suspend() {
    if (this.#status === "suspended") return;
    this.#invalidate("suspended", null);
  }

  #authorityChanged(before: HostLease | null) {
    // A new authority starts without the old camera, snapshot or gestures.
    if (before) this.#cancelGestures(before);
    this.#invalidate("waiting", null);
  }

  #cancelGestures(lease: HostLease) {
    this.counters.cancelledGestures += this.#router.hostEnded(lease).length;
  }

  /** Runtime hosts for the authoritative lease only (connect, then drop). */
  #syncHosts(lease: HostLease) {
    for (const [key, surface] of this.#live) {
      const entry = this.#hosts.get(key);
      if (entry?.lease === lease) continue;
      const host = this.#coordinator.connectHost(surface.ref);
      if (!host) continue;
      this.#hosts.set(key, { lease, host });
      // Connected first, so the runtime never sees "no host" in between.
      entry?.host.disconnect();
    }
  }

  // --- Surfaces and pages -------------------------------------------------

  #onSurfaces = () => {
    const next = new Map(
      this.#coordinator
        .getSnapshot()
        .surfaces.map((s) => [surfaceKey(s.ref), s] as const),
    );
    for (const [key, surface] of this.#live) {
      if (next.has(key)) continue;
      // Removed: no more frames, no input, no page.
      this.counters.cancelledGestures += this.#router.surfaceRemoved(
        surface.ref,
      ).length;
      const entry = this.#hosts.get(key);
      this.#hosts.delete(key);
      entry?.host.disconnect();
      this.#interactive.delete(key);
      this.#views.delete(key);
      this.#detachPage(key);
      if (this.#lastUp && routeSurface(this.#lastUp.owner, surface.ref))
        this.#lastUp = null;
    }
    this.#live = next;
    // The current snapshot no longer describes the live Surfaces: input
    // waits for the next frame's snapshot (geometry moved, added, removed).
    if (this.#depth) {
      this.#depth = null;
      this.#owners = new Map();
    }
  };

  /** The fixed layer over the renderer's canvas that holds the pages. */
  attachLayer(element: HTMLElement): () => void {
    this.#follow();
    this.#layer = element;
    this.#layerKey = "";
    return () => {
      if (this.#layer === element) this.#layer = null;
    };
  }

  /**
   * The live DOM page of a Surface (CSS size = its geometry resolution,
   * `transform-origin: 0 0`, at the layer's top-left). Hidden until the
   * first composited frame.
   */
  attachPage(ref: SurfaceRef, element: HTMLElement): () => void {
    this.#follow();
    const key = surfaceKey(ref);
    if (!this.#coordinator.isLive(ref)) return () => {};
    this.#detachPage(key);
    element.style.visibility = "hidden";
    element.dataset.depth = this.#status;
    this.#pages.set(key, {
      element,
      transform: "",
      clip: "",
      visibility: "hidden",
      depth: this.#status,
      z: "",
    });
    this.#elements.set(element, key);
    // Shown by the next resolved frame (the current snapshot, if any, does
    // not include it); composing now would hide every page for a frame.
    return () => {
      if (this.#pages.get(key)?.element === element) this.#detachPage(key);
    };
  }

  #detachPage(key: string) {
    const page = this.#pages.get(key);
    if (!page) return;
    this.#pages.delete(key);
    this.#elements.delete(page.element);
    for (const p of ["transform", "clip-path", "visibility", "z-index"])
      page.element.style.removeProperty(p);
    delete page.element.dataset.depth;
  }

  /**
   * Whether the Surface takes input (default `true`). A non-interactive
   * Surface in front still occludes: input under it goes to nobody.
   */
  setInteractive(ref: SurfaceRef, interactive: boolean): boolean {
    if (!this.#coordinator.isLive(ref)) return false;
    this.#interactive.set(surfaceKey(ref), interactive);
    if (!interactive) {
      for (const route of this.#router.captures)
        if (routeSurface(route.owner, ref))
          this.#router.cancel(route.host, route.pointerId);
      const focus = this.#router.keyboardOwner();
      if (focus && routeSurface(focus, ref)) this.#router.focus(null);
    }
    return true;
  }

  #isInteractive(key: string) {
    return this.#interactive.get(key) ?? true;
  }

  #compose(frame: CameraFrame) {
    const layer = this.#layer;
    if (layer) {
      const { left, top, width, height } = frame.viewport;
      const key = `${left},${top},${width},${height}`;
      if (key !== this.#layerKey) {
        layer.style.left = `${left}px`;
        layer.style.top = `${top}px`;
        layer.style.width = `${width}px`;
        layer.style.height = `${height}px`;
        this.#layerKey = key;
      }
    }
    const visibility = new Map<string, VisibilityResult>(
      this.#depth?.visibility.map((v) => [v.key, v]) ?? [],
    );
    // Far to near: the stacking order is only a tie-breaker (and the
    // fallback order while depth is indeterminate).
    const order = [...this.#live.entries()]
      .map(([key, s]) => ({
        key,
        s,
        d: Math.hypot(
          s.geometry.pose.position[0] - frame.eye[0],
          s.geometry.pose.position[1] - frame.eye[1],
          s.geometry.pose.position[2] - frame.eye[2],
        ),
      }))
      .sort((a, b) => b.d - a.d);
    order.forEach(({ key, s }, index) => {
      const t = surfaceTransform(
        frame,
        poseOfGeometry(s.geometry),
        s.geometry.resolution,
      );
      const v = visibility.get(key);
      let shown: SceneSurfaceView["visibility"] = t.visibility;
      let clip: string | null = null;
      if (this.#status === "resolved") {
        if (!v || v.pieces.length === 0) shown = "hidden";
        else clip = v.clipPath;
      } else if (this.#status === "indeterminate") {
        if (this.#display === "hidden") shown = "hidden";
        else clip = "none";
      } else shown = "waiting";
      const page = this.#pages.get(key);
      this.#views.set(key, {
        key,
        ref: s.ref,
        visibility: shown,
        clipPath: clip,
        pieces: v?.pieces.length ?? 0,
        hiddenBy: v?.hidden.map((h) => h.by) ?? [],
        interactive: this.#isInteractive(key),
        host: this.#hosts.has(key),
        page: !!page,
      });
      if (!page) return;
      const style = page.element.style;
      if (t.visibility === "visible" && t.matrix3d !== page.transform) {
        style.transform = t.matrix3d;
        page.transform = t.matrix3d;
      }
      const css = shown === "visible" ? "" : "hidden";
      if (css !== page.visibility) {
        style.visibility = css;
        page.visibility = css;
      }
      if (clip !== null && clip !== page.clip) {
        style.clipPath = clip;
        page.clip = clip;
      }
      const z = String(index + 1);
      if (z !== page.z) {
        style.zIndex = z;
        page.z = z;
      }
      if (page.depth !== this.#status) {
        page.element.dataset.depth = this.#status;
        page.depth = this.#status;
      }
    });
  }

  #hidePages(status: SceneStatus) {
    for (const [key, page] of this.#pages) {
      page.element.style.visibility = "hidden";
      page.visibility = "hidden";
      page.element.dataset.depth = status;
      page.depth = status;
      const view = this.#views.get(key);
      if (view)
        this.#views.set(key, {
          ...view,
          visibility: "waiting",
          clipPath: null,
        });
    }
  }

  #blurPages() {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.#surfaceOf(active)) active.blur();
  }

  #idleView(key: string): SceneSurfaceView {
    const s = this.#live.get(key)!;
    return {
      key,
      ref: s.ref,
      visibility: "waiting",
      clipPath: null,
      pieces: 0,
      hiddenBy: [],
      interactive: this.#isInteractive(key),
      host: this.#hosts.has(key),
      page: this.#pages.has(key),
    };
  }

  // --- Input ---------------------------------------------------------------

  /**
   * The ray owner at a client point, from the current snapshot (`null`:
   * background). Throws `IndeterminateDepthError` like the snapshot; the
   * input gate turns that into a fail-closed scene.
   */
  #rayOwner(clientX: number, clientY: number): InputHit | null | undefined {
    const frame = this.#frame;
    const depth = this.#depth;
    if (!frame || !depth) return undefined;
    const ray = viewportRay(frame, clientX, clientY);
    if (!ray) return undefined;
    const hit = depth.depthOwner(ray.direction);
    if (!hit) return null;
    const owner = this.#owners.get(hit.key);
    if (!owner) return undefined;
    const interactive =
      owner.owner.kind === "presentation" ||
      (this.#isInteractive(hit.key) &&
        this.#views.get(hit.key)?.visibility === "visible");
    return { owner: owner.owner, distance: hit.distance, interactive };
  }

  /** A new gesture: its single owner, from the current snapshot only. */
  pointerDown(
    pointerId: number,
    clientX: number,
    clientY: number,
    target: InputTarget,
  ): InputDecision {
    const start = this.#now();
    try {
      return this.#pointerDown(pointerId, clientX, clientY, target);
    } finally {
      this.timings.pointer.push(this.#now() - start);
    }
  }

  #pointerDown(
    pointerId: number,
    clientX: number,
    clientY: number,
    target: InputTarget,
  ): InputDecision {
    this.#lastUp = null;
    if (target.kind === "outside") return allow(null, "outside the workspace");
    const lease = this.#authority.authority;
    let hit: InputHit | null | undefined;
    try {
      hit =
        this.#status === "resolved"
          ? this.#rayOwner(clientX, clientY)
          : undefined;
    } catch (error) {
      this.#fail("ray", error);
      hit = undefined;
    }
    if (hit === undefined || !lease) {
      // No authoritative snapshot: nothing in the workspace is routed. The
      // canvas keeps camera navigation (no route: panel actions refused).
      if (lease) this.#router.cancel(lease, pointerId);
      return target.kind === "scene"
        ? allow(null, `scene only (${this.#status})`)
        : this.#block(`no authoritative depth (${this.#status})`);
    }
    const route = this.#router.down(lease, pointerId, hit ? [hit] : EMPTY_HITS);
    if (!route) {
      if (hit && !hit.interactive)
        return this.#block("a non-interactive Surface is in front");
      return target.kind === "scene"
        ? allow(null, "background")
        : this.#mismatch(lease, pointerId, "page hit where depth owns nothing");
    }
    const owner = route.owner;
    const consistent =
      owner.kind === "surface"
        ? target.kind === "surface" && sameSurface(target.ref, owner.surface)
        : target.kind === "scene";
    if (!consistent)
      return this.#mismatch(
        lease,
        pointerId,
        "DOM target is not the depth owner",
      );
    if (owner.kind === "surface") this.#router.focus(owner);
    return allow(route, "routed");
  }

  /** Move, up or cancel of a pointer: only its gesture owner receives it. */
  pointerContinue(
    pointerId: number,
    phase: "move" | "up" | "cancel",
    target: InputTarget,
    hover?: { readonly clientX: number; readonly clientY: number },
  ): InputDecision {
    if (target.kind === "outside") return allow(null, "outside the workspace");
    const lease = this.#authority.authority;
    const captured = this.#router.captures.find(
      (r) => r.pointerId === pointerId,
    );
    if (captured) {
      const route =
        lease === null
          ? null
          : phase === "move"
            ? this.#router.move(lease, pointerId)
            : phase === "up"
              ? this.#router.up(lease, pointerId)
              : this.#router.cancel(lease, pointerId);
      if (!route) {
        if (lease === null || captured.host !== lease)
          this.#router.cancel(captured.host, pointerId);
        return target.kind === "scene" && phase !== "move"
          ? allow(null, "gesture ended")
          : this.#block("gesture ended (owner, authority or depth lost)");
      }
      const ok =
        route.owner.kind === "surface"
          ? target.kind === "surface" &&
            sameSurface(target.ref, route.owner.surface)
          : target.kind === "scene";
      if (phase === "up") this.#lastUp = ok ? route : null;
      return ok
        ? allow(route, "captured")
        : this.#block("not the gesture owner");
    }
    if (target.kind === "scene") return allow(null, "scene");
    // No gesture: a hover move reaches a page only where it owns the ray.
    if (phase === "move" && hover && this.#status === "resolved") {
      try {
        const hit = this.#rayOwner(hover.clientX, hover.clientY);
        if (
          hit?.interactive &&
          hit.owner.kind === "surface" &&
          sameSurface(hit.owner.surface, target.ref)
        )
          return allow(null, "hover");
      } catch (error) {
        this.#fail("ray", error);
      }
    }
    return this.#block("no gesture");
  }

  /** A click-like event: only the owner of the gesture that just ended. */
  activation(target: InputTarget): InputDecision {
    if (target.kind !== "surface") return allow(null, "not a page");
    const last = this.#lastUp;
    return last &&
      last.owner.kind === "surface" &&
      sameSurface(last.owner.surface, target.ref) &&
      this.#status === "resolved" &&
      this.#coordinator.isLive(target.ref)
      ? allow(last, "activation of the routed gesture")
      : this.#block("no routed gesture for this page");
  }

  /** Keyboard input to a page: only the focused, live, interactive owner. */
  keyboard(target: InputTarget): InputDecision {
    if (target.kind !== "surface") return allow(null, "not a page");
    const owner = this.#router.keyboardOwner();
    return this.#status === "resolved" &&
      owner?.kind === "surface" &&
      sameSurface(owner.surface, target.ref) &&
      this.#isInteractive(surfaceKey(target.ref))
      ? allow(null, "keyboard owner")
      : this.#block("not the keyboard owner");
  }

  /** Focus entering a page (Tab or script): it becomes the keyboard owner. */
  focusIn(target: InputTarget): InputDecision {
    if (target.kind !== "surface") return allow(null, "not a page");
    if (
      this.#status !== "resolved" ||
      !this.#isInteractive(surfaceKey(target.ref)) ||
      !this.#router.focus({ kind: "surface", surface: target.ref })
    )
      return this.#block("focus refused");
    return allow(null, "focus");
  }

  /**
   * An Adaptive panel action (renderer path): accepted only for the
   * presentation that owned the pointer gesture that just ended. The XR
   * controller path of an immersive session is not routed here.
   */
  adaptiveAction(ref: ScopedPresentationRef): boolean {
    const last = this.#lastUp;
    this.#lastUp = null;
    return (
      this.#status === "resolved" &&
      !!last &&
      last.owner.kind === "presentation" &&
      sameItem(last.owner.item, ref.item) &&
      last.owner.instanceId === ref.instanceId &&
      this.#coordinator.isCurrent(ref)
    );
  }

  /**
   * Installs the input gate (capture phase) on a root that contains the
   * pages and the renderer's canvas. `isScene` tells canvas targets.
   */
  bindInput(root: HTMLElement, isScene: (element: Element) => boolean) {
    this.#follow();
    const targetOf = (event: Event): InputTarget => {
      let node = event.target instanceof Element ? event.target : null;
      while (node) {
        const key = this.#elements.get(node);
        if (key) {
          const surface = this.#live.get(key);
          return surface
            ? { kind: "surface", ref: surface.ref }
            : { kind: "outside" };
        }
        if (isScene(node)) return { kind: "scene" };
        if (node === root) break;
        node = node.parentElement;
      }
      return { kind: "outside" };
    };
    const blocked = new Set<number>();
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onDown = (event: PointerEvent) => {
      const target = targetOf(event);
      const d = this.pointerDown(
        event.pointerId,
        event.clientX,
        event.clientY,
        target,
      );
      if (!d.allow) {
        blocked.add(event.pointerId);
        stop(event);
        return;
      }
      blocked.delete(event.pointerId);
      // Moves and the release keep going to the gesture's owner element.
      if (d.route?.owner.kind === "surface" && event.target instanceof Element)
        try {
          event.target.setPointerCapture(event.pointerId);
        } catch {
          /* the element may be gone; the router still owns the gesture */
        }
    };
    const onContinue =
      (phase: "move" | "up" | "cancel") => (event: PointerEvent) => {
        const d = this.pointerContinue(
          event.pointerId,
          phase,
          targetOf(event),
          { clientX: event.clientX, clientY: event.clientY },
        );
        if (!d.allow) stop(event);
        if (phase !== "move") blocked.delete(event.pointerId);
      };
    const onMouse = (event: MouseEvent) => {
      // Compatibility mouse events of a blocked gesture (focus, selection).
      if (targetOf(event).kind === "surface" && blocked.size > 0) stop(event);
    };
    const onActivation = (event: Event) => {
      if (!this.activation(targetOf(event)).allow) stop(event);
    };
    const onKey = (event: Event) => {
      if (!this.keyboard(targetOf(event)).allow) stop(event);
    };
    const onFocus = (event: FocusEvent) => {
      if (
        !this.focusIn(targetOf(event)).allow &&
        event.target instanceof HTMLElement
      )
        event.target.blur();
    };
    const listeners: [string, EventListener][] = [
      ["pointerdown", onDown as EventListener],
      ["pointermove", onContinue("move") as EventListener],
      ["pointerup", onContinue("up") as EventListener],
      ["pointercancel", onContinue("cancel") as EventListener],
      ["mousedown", onMouse as EventListener],
      ["mouseup", onMouse as EventListener],
      ["click", onActivation],
      ["dblclick", onActivation],
      ["auxclick", onActivation],
      ["contextmenu", onActivation],
      ["keydown", onKey],
      ["keyup", onKey],
      ["keypress", onKey],
      ["beforeinput", onKey],
      ["paste", onKey],
      ["cut", onKey],
      ["drop", onKey],
      ["focusin", onFocus as EventListener],
    ];
    for (const [type, listener] of listeners)
      root.addEventListener(type, listener, { capture: true });
    return () => {
      for (const [type, listener] of listeners)
        root.removeEventListener(type, listener, { capture: true });
    };
  }

  #block(reason: string): InputDecision {
    this.counters.blocked++;
    return { allow: false, route: null, reason };
  }

  #mismatch(lease: HostLease, pointerId: number, reason: string) {
    this.counters.mismatches++;
    this.#router.cancel(lease, pointerId);
    return this.#block(reason);
  }

  #surfaceOf(element: Element): string | null {
    let node: Element | null = element;
    while (node) {
      const key = this.#elements.get(node);
      if (key) return key;
      node = node.parentElement;
    }
    return null;
  }

  // --- Lifecycle -----------------------------------------------------------

  #setStatus(status: SceneStatus) {
    const authority = this.#authority.authority;
    const s = this.#snapshot;
    if (
      s.status === status &&
      s.authority === authority &&
      s.error === this.#error
    )
      return;
    this.#status = status;
    this.#snapshot = Object.freeze({
      version: s.version + 1,
      status,
      authority,
      error: this.#error,
    });
    for (const listener of [...this.#listeners]) listener();
  }

  /** Disconnects every runtime host and stops following the coordinator. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const { host } of this.#hosts.values()) host.disconnect();
    this.#hosts.clear();
    for (const key of [...this.#pages.keys()]) this.#detachPage(key);
    this.#listeners.clear();
  }

  get disposed() {
    return this.#disposed;
  }

  #assertLive() {
    if (this.#disposed) throw new Error("This WorkspaceScene was disposed.");
  }
}

const allow = (route: Route | null, reason: string): InputDecision => ({
  allow: true,
  route,
  reason,
});

function routeSurface(owner: InputOwner, ref: SurfaceRef) {
  return sameSurface(
    owner.kind === "surface" ? owner.surface : owner.item.surface,
    ref,
  );
}
