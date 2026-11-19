import {
  ItemManipulator,
  type ManipulablePresentation,
  type PresentationStrategy,
  type SourceVisibility,
  type SpatialRay,
  type SpatialRegistry,
  type SpatialViewRecord,
} from "@spatialflex/core";
import { containmentReason, nativeContainmentIssues } from "./containment.js";
import {
  NativeCompositor,
  type ContainingSurface,
  type NativeIssues,
} from "./nativeCompositor.js";
import {
  bindNativeHandles,
  type NativeHandleBinding,
} from "./nativeHandles.js";
import {
  transformedQuad,
  viewportRay,
  type CameraFrame,
  type Occluder,
  type Quaternion,
  type Vec3,
} from "./projection.js";

/**
 * The detach operations a presentation runtime needs from the workspace's
 * DOM controller (`useSpatialController()` of @spatialflex/react
 * satisfies it). Structural, so this package does not depend on React.
 */
export interface PresentationController {
  extractNative(id: string, source: "placeholder" | "collapse"): boolean;
  attach(id: string): boolean;
  placement(id: string): "viewport" | "external" | null;
  nativeElement(id: string): HTMLElement | null;
  sourceElement(id: string): HTMLElement | null;
  setSourceVisibility(id: string, visibility: SourceVisibility): boolean;
}

/** One presentation of a registered component (immutable snapshot). */
export interface SpatialPresentation {
  /** Presentation instance: new for every extraction (`native-N`, `adaptive-N`). */
  readonly instanceId: string;
  readonly itemId: string;
  /** The registration it presents (`registry.registrationOf`). */
  readonly registrationKey: string;
  readonly kind: PresentationStrategy;
  /** Adaptive: the XR view epoch it presents (`SpatialViewRecord.registrationId`). */
  readonly viewRegistrationId: string | null;
  /** What the original placement does meanwhile. */
  readonly source: "placeholder" | "collapse" | "visible" | "reserved";
}

export interface PresentationSnapshot {
  /** Changes whenever presentations or composition issues change. */
  readonly version: number;
  readonly presentations: readonly SpatialPresentation[];
  /** Native presentations that cannot be composited, with the reasons. */
  readonly issues: NativeIssues;
}

export type PresentationSupport =
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: string };

export type ExtractResult =
  | { readonly ok: true; readonly presentation: SpatialPresentation }
  | { readonly ok: false; readonly reason: string };

/** Where a new presentation starts: application layout policy. */
export interface PresentationPlacement {
  readonly position: Vec3;
  readonly rotation?: Quaternion;
  /** Native: world meters per CSS pixel at scale 1 (default 0.002). */
  readonly metersPerPixel?: number;
  /**
   * Natural world size at scale 1. Adaptive: default 0.6 × 0.4 m. Native
   * DOM: default the element's layout size × `metersPerPixel`.
   */
  readonly extent?: { readonly width: number; readonly height: number };
  /**
   * The original placement while presented: `placeholder` (default) or
   * `collapse` for Native DOM; `visible` (default) or `reserved` for Adaptive.
   */
  readonly source?: SpatialPresentation["source"];
}

/** Per-frame options of {@link PresentationHost.frame}. */
export interface HostFrameOptions {
  /**
   * Renderer-drawn rectangles that cut native elements behind them
   * (default: the live Adaptive panels at their manipulated poses).
   */
  readonly occluders?: readonly Occluder[];
  /**
   * Page-surface mode: the transformed page that contains the native
   * elements (the page is placed by the application; its pose is cancelled
   * by each element's transform). Omitted: viewport mode, where the
   * viewport is the native elements' containing block.
   */
  readonly surface?: ContainingSurface;
}

/** What a composited frame reports back to its host. */
export interface HostFrameResult {
  /**
   * Page-surface mode: the native elements' footprints in page pixels, for
   * the page's own clip (a page's clip-path also clips its descendants).
   * Empty in viewport mode and for frames that are not authoritative.
   */
  readonly keep: [number, number][][];
}

export interface HostOptions {
  /**
   * Whether this host draws the Adaptive panels (default `true`). A host
   * that only composites Native DOM (the XR Lab's page surface, whose
   * renderer draws panels on its own) ends only the Native presentations
   * when it is the last to disconnect.
   */
  readonly drawsAdaptive?: boolean;
}

/** A connected renderer (rendering host). */
export interface PresentationHost {
  /**
   * After each rendered frame: places the native elements for it. Only the
   * authoritative frame source (the earliest connected host that reports
   * frames and is still connected) is composited; frames of other hosts
   * are ignored, so the camera of one host never places elements for
   * another.
   */
  frame(frame: CameraFrame, options?: HostFrameOptions): HostFrameResult;
  /**
   * World ray under a client point, from this host's last composited frame
   * (`null` for a host that is not the authoritative frame source).
   */
  rayAt(clientX: number, clientY: number): SpatialRay | null;
  /**
   * The last host to disconnect ends the Native presentations (nothing can
   * composite them); the last host that draws Adaptive panels ends those.
   */
  disconnect(): void;
}

/** Options of a {@link PresentationRuntime}. */
export interface PresentationRuntimeOptions {
  /**
   * Prefixes of presentation instance ids (`<prefix>-<n>`); defaults
   * `native` and `adaptive`. For applications that already expose instance
   * ids in another format. Ids stay unique per runtime either way.
   */
  readonly instancePrefix?: Partial<Record<PresentationStrategy, string>>;
}

interface Entry {
  readonly presentation: SpatialPresentation;
  /** Layout origin (start pose); moved by `relocate`. */
  initial: ManipulablePresentation["initial"];
  readonly extent: { readonly width: number; readonly height: number };
  readonly metersPerPixel: number;
}

const DEFAULT_METERS_PER_PIXEL = 0.002;
const DEFAULT_ADAPTIVE_EXTENT = { width: 0.6, height: 0.4 } as const;
const IDENTITY: Quaternion = [0, 0, 0, 1];
const EMPTY_ISSUES: NativeIssues = new Map();
const NO_KEEP: HostFrameResult = Object.freeze({ keep: [] });

interface HostState {
  connected: boolean;
  readonly drawsAdaptive: boolean;
}

/**
 * The presentation lifecycle of one workspace (one registry and its
 * controller): Native DOM and XR Adaptive presentation instances, kept
 * consistent with the registry, the manipulator and the DOM compositor.
 *
 * It composes the existing runtime: `ItemManipulator` (poses and sessions,
 * over `SpatialManipulator`), `NativeCompositor` and `bindNativeHandles`.
 * It keeps no pose of its own. Instances are bound to the registration
 * that created them (`registry.registrationOf`): an unmounted or replaced
 * component ends its presentation on the registry notification, before any
 * further input can reach it.
 *
 * Not a singleton: create one per workspace. Framework-independent; the
 * React bindings live in `@spatialflex/react/spatial`.
 */
export class PresentationRuntime {
  /** Poses and manipulation sessions of the live presentations. */
  readonly manipulation = new ItemManipulator();
  readonly #registry: SpatialRegistry;
  readonly #controller: PresentationController;
  readonly #compositor: NativeCompositor;
  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<() => void>();
  #binding: NativeHandleBinding | null = null;
  #frame: CameraFrame | null = null;
  /** The authoritative frame source, and its page surface (if any). */
  #frameSource: HostState | null = null;
  #surfaceElement: HTMLElement | null = null;
  readonly #hosts = new Set<HostState>();
  readonly #prefix: Record<PresentationStrategy, string>;
  #issues: NativeIssues = EMPTY_ISSUES;
  #snapshot: PresentationSnapshot = {
    version: 0,
    presentations: [],
    issues: EMPTY_ISSUES,
  };
  #generation = 0;
  #batch = 0;
  #dirty = false;
  #connected = false;

  constructor(
    registry: SpatialRegistry,
    controller: PresentationController,
    options: PresentationRuntimeOptions = {},
  ) {
    this.#registry = registry;
    this.#controller = controller;
    this.#prefix = {
      native: options.instancePrefix?.native ?? "native",
      adaptive: options.instancePrefix?.adaptive ?? "adaptive",
    };
    this.#compositor = new NativeCompositor({
      onIssues: (issues) => {
        this.#issues = issues;
        this.#publish();
      },
    });
  }

  /**
   * Starts following the registry. Returns `disconnect`, which ends every
   * presentation (restoring the originals) and releases everything the
   * runtime owns. Connecting again starts afresh (React StrictMode).
   */
  connect(): () => void {
    if (this.#connected) return () => {};
    this.#connected = true;
    const unsubscribe = [
      this.#registry.subscribe(this.#onRegistry),
      this.#registry.subscribeViews(this.#onRegistry),
    ];
    this.#reconcile();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      for (const stop of unsubscribe) stop();
      this.restoreAll();
      this.#binding?.dispose();
      this.#binding = null;
      this.#compositor.dispose();
      this.manipulation.dispose();
      this.#frame = null;
      this.#frameSource = null;
      this.#surfaceElement = null;
      this.#connected = false;
    };
  }

  // --- Observation (useSyncExternalStore-compatible) ---------------------

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): PresentationSnapshot => this.#snapshot;

  presentationOf(itemId: string): SpatialPresentation | undefined {
    return this.#entries.get(itemId)?.presentation;
  }

  /** Adaptive presentations with the view records they present. */
  adaptivePanels(): {
    readonly presentation: SpatialPresentation;
    readonly view: SpatialViewRecord;
    readonly extent: { readonly width: number; readonly height: number };
  }[] {
    return [...this.#entries.values()].flatMap(({ presentation, extent }) => {
      if (presentation.kind !== "adaptive") return [];
      const view = this.#registry.getView(presentation.itemId);
      return view && view.registrationId === presentation.viewRegistrationId
        ? [{ presentation, view, extent }]
        : [];
    });
  }

  // --- Lifecycle ---------------------------------------------------------

  /** Whether the item can be presented as Native DOM now, with the reason. */
  nativeSupport(itemId: string): PresentationSupport {
    const record = this.#registry.get(itemId);
    if (!record)
      return { supported: false, reason: `"${itemId}" is not registered.` };
    if (!record.capabilities.detachable)
      return {
        supported: false,
        reason: `"${itemId}" is not detachable (SpatialItem detachable).`,
      };
    const source = this.#controller.sourceElement(itemId);
    if (!source)
      return {
        supported: false,
        reason: `"${itemId}" has no connected element.`,
      };
    // The containing block the compositor will assume: the page surface of
    // the authoritative host, else the viewport.
    const reason = containmentReason(
      nativeContainmentIssues(source, this.#surfaceElement),
    );
    return reason ? { supported: false, reason } : { supported: true };
  }

  /** Whether the item can be presented as XR Adaptive now, with the reason. */
  adaptiveSupport(itemId: string): PresentationSupport {
    if (!this.#registry.has(itemId))
      return { supported: false, reason: `"${itemId}" is not registered.` };
    return this.#registry.getView(itemId)
      ? { supported: true }
      : {
          supported: false,
          reason: `"${itemId}" declares no XR view (SpatialItem xr).`,
        };
  }

  /**
   * Presents the item. Switching strategy is a transaction: the new
   * strategy is validated first, and a failed validation keeps the current
   * presentation unchanged. If starting fails after the old presentation
   * ended, the original component is restored (never a half state).
   */
  extract(
    itemId: string,
    kind: PresentationStrategy,
    placement: PresentationPlacement,
  ): ExtractResult {
    if (!this.#connected)
      return {
        ok: false,
        reason: "The presentation runtime is not connected.",
      };
    const current = this.#entries.get(itemId);
    if (current?.presentation.kind === kind)
      return {
        ok: false,
        reason: `"${itemId}" is already presented as ${kind}.`,
      };
    const support =
      kind === "native"
        ? this.nativeSupport(itemId)
        : this.adaptiveSupport(itemId);
    if (!support.supported) return { ok: false, reason: support.reason };
    const source = placement.source;
    if (
      source !== undefined &&
      (kind === "native"
        ? source !== "placeholder" && source !== "collapse"
        : source !== "visible" && source !== "reserved")
    )
      return {
        ok: false,
        reason: `Source "${source}" is not available for ${kind} presentations.`,
      };
    return this.#transaction(() => {
      if (current) this.#end(current.presentation);
      const started =
        kind === "native"
          ? this.#startNative(itemId, placement)
          : this.#startAdaptive(itemId, placement);
      if (!started.ok) this.#restoreOriginal(itemId);
      return started;
    });
  }

  /** Ends the item's presentation and restores the original. */
  restore(itemId: string): boolean {
    const entry = this.#entries.get(itemId);
    if (!entry) return false;
    this.#transaction(() => this.#end(entry.presentation));
    return true;
  }

  restoreAll() {
    this.#transaction(() => {
      for (const { presentation } of [...this.#entries.values()])
        this.#end(presentation);
    });
  }

  /**
   * A semantic action of an Adaptive presentation, accepted only for the
   * live instance and the view epoch it presents.
   */
  invoke(instanceId: string, actionId: string): boolean {
    const entry = [...this.#entries.values()].find(
      (e) => e.presentation.instanceId === instanceId,
    );
    if (!entry || entry.presentation.kind !== "adaptive") return false;
    const { itemId, viewRegistrationId, registrationKey } = entry.presentation;
    if (this.#registry.registrationOf(itemId) !== registrationKey) return false;
    return this.#registry.invokeView(itemId, viewRegistrationId!, actionId);
  }

  /**
   * Moves the layout origin (start pose position) of a live presentation,
   * keeping what the user manipulated on top of it: application layout
   * policy (slots, Move buttons) without a second pose store. Accepted only
   * for the live instance.
   */
  relocate(instanceId: string, position: Vec3): boolean {
    const entry = [...this.#entries.values()].find(
      (e) => e.presentation.instanceId === instanceId,
    );
    if (!entry || position.length !== 3 || !position.every(Number.isFinite))
      return false;
    const [x, y, z] = entry.initial.position;
    if (x === position[0] && y === position[1] && z === position[2])
      return true;
    entry.initial = {
      ...entry.initial,
      position: [position[0], position[1], position[2]],
    };
    this.#transaction(() => {});
    return true;
  }

  /** Connects a renderer. */
  connectHost(options: HostOptions = {}): PresentationHost {
    const host: HostState = {
      connected: true,
      drawsAdaptive: options.drawsAdaptive ?? true,
    };
    this.#hosts.add(host);
    return {
      frame: (frame, frameOptions = {}) => {
        if (!host.connected) return NO_KEEP;
        this.#frameSource ??= host;
        if (this.#frameSource !== host) return NO_KEEP;
        this.#frame = {
          viewProjection: Array.from(frame.viewProjection),
          viewport: { ...frame.viewport },
          eye: [frame.eye[0], frame.eye[1], frame.eye[2]],
        };
        this.#surfaceElement = frameOptions.surface?.element ?? null;
        return this.#compositor.composite(frame, {
          occluders: frameOptions.occluders ?? this.#adaptiveOccluders(),
          ...(frameOptions.surface && { surface: frameOptions.surface }),
        });
      },
      rayAt: (x, y) =>
        host.connected && this.#frameSource === host && this.#frame
          ? viewportRay(this.#frame, x, y)
          : null,
      disconnect: () => {
        if (!host.connected) return;
        host.connected = false;
        this.#hosts.delete(host);
        if (this.#frameSource === host) {
          this.#frameSource = null;
          this.#frame = null;
          this.#surfaceElement = null;
        }
        const remaining = [...this.#hosts];
        const endNative = remaining.length === 0;
        const endAdaptive =
          host.drawsAdaptive && !remaining.some((h) => h.drawsAdaptive);
        if (endNative || endAdaptive)
          this.#transaction(() => {
            for (const { presentation } of [...this.#entries.values()])
              if (presentation.kind === "native" ? endNative : endAdaptive)
                this.#end(presentation);
          });
      },
    };
  }

  // --- Internals ---------------------------------------------------------

  #startNative(
    itemId: string,
    placement: PresentationPlacement,
  ): ExtractResult {
    const source = placement.source === "collapse" ? "collapse" : "placeholder";
    const registrationKey = this.#registry.registrationOf(itemId)!;
    if (!this.#controller.extractNative(itemId, source))
      return { ok: false, reason: `"${itemId}" could not be extracted.` };
    const element = this.#controller.nativeElement(itemId);
    const metersPerPixel = placement.metersPerPixel ?? DEFAULT_METERS_PER_PIXEL;
    this.#add({
      presentation: {
        instanceId: `${this.#prefix.native}-${++this.#generation}`,
        itemId,
        registrationKey,
        kind: "native",
        viewRegistrationId: null,
        source,
      },
      initial: {
        position: placement.position,
        rotation: placement.rotation ?? IDENTITY,
        scale: 1,
      },
      extent: placement.extent ?? {
        width: (element?.offsetWidth || 1) * metersPerPixel,
        height: (element?.offsetHeight || 1) * metersPerPixel,
      },
      metersPerPixel,
    });
    return { ok: true, presentation: this.#entries.get(itemId)!.presentation };
  }

  #startAdaptive(
    itemId: string,
    placement: PresentationPlacement,
  ): ExtractResult {
    const view = this.#registry.getView(itemId)!;
    const source = placement.source === "reserved" ? "reserved" : "visible";
    this.#controller.setSourceVisibility(itemId, source);
    this.#add({
      presentation: {
        instanceId: `${this.#prefix.adaptive}-${++this.#generation}`,
        itemId,
        registrationKey: this.#registry.registrationOf(itemId)!,
        kind: "adaptive",
        viewRegistrationId: view.registrationId,
        source,
      },
      initial: {
        position: placement.position,
        rotation: placement.rotation ?? IDENTITY,
        scale: 1,
      },
      extent: placement.extent ?? DEFAULT_ADAPTIVE_EXTENT,
      metersPerPixel: 0,
    });
    return { ok: true, presentation: this.#entries.get(itemId)!.presentation };
  }

  #add(entry: Entry) {
    this.#entries.set(entry.presentation.itemId, entry);
    this.#dirty = true;
  }

  /** Ends a presentation and restores the original, if it is still ours. */
  #end(presentation: SpatialPresentation) {
    const { itemId } = presentation;
    if (this.#entries.get(itemId)?.presentation !== presentation) return;
    this.#entries.delete(itemId);
    this.#dirty = true;
    if (this.#registry.registrationOf(itemId) !== presentation.registrationKey)
      return; // Unmounted or replaced: nothing of the original to restore.
    if (presentation.kind === "native") {
      if (this.#controller.placement(itemId) === "external")
        this.#controller.attach(itemId);
    } else if (presentation.source === "reserved") {
      this.#controller.setSourceVisibility(itemId, "visible");
    }
  }

  #restoreOriginal(itemId: string) {
    if (!this.#registry.has(itemId)) return;
    if (this.#controller.placement(itemId) === "external")
      this.#controller.attach(itemId);
    if (this.#registry.get(itemId)?.layout.visible === false)
      this.#controller.setSourceVisibility(itemId, "visible");
  }

  /** Runs operations; registry notifications inside reconcile once after. */
  #transaction<T>(run: () => T): T {
    this.#batch++;
    try {
      return run();
    } finally {
      if (--this.#batch === 0) this.#reconcile();
    }
  }

  #onRegistry = () => {
    if (this.#batch > 0) this.#dirty = true;
    else this.#reconcile();
  };

  /** Brings every part in line with the registry and the live presentations. */
  #reconcile() {
    if (!this.#connected) return;
    for (const { presentation } of [...this.#entries.values()]) {
      const { itemId, kind } = presentation;
      const live =
        this.#registry.registrationOf(itemId) ===
          presentation.registrationKey &&
        (kind === "native"
          ? this.#controller.placement(itemId) === "external"
          : this.#registry.getView(itemId)?.registrationId ===
            presentation.viewRegistrationId);
      if (!live) this.#end(presentation);
    }
    const entries = [...this.#entries.values()];
    this.manipulation.sync(
      entries.map(({ presentation, initial, extent }) => ({
        itemId: presentation.itemId,
        presentationId: presentation.instanceId,
        registrationId: presentation.registrationKey,
        kind: presentation.kind,
        initial,
        extent,
      })),
    );
    const targets = entries.flatMap(({ presentation, metersPerPixel }) => {
      if (presentation.kind !== "native") return [];
      const element = this.#controller.nativeElement(presentation.itemId);
      return element
        ? [
            {
              id: presentation.itemId,
              element,
              placement: () => {
                const pose = this.manipulation.poseOf(presentation.itemId);
                return pose && { ...pose, metersPerPixel };
              },
            },
          ]
        : [];
    });
    this.#compositor.setTargets(targets);
    const bound = this.#binding?.elements ?? [];
    if (
      bound.length !== targets.length ||
      !bound.every(
        (b, i) => b.id === targets[i]!.id && b.element === targets[i]!.element,
      )
    ) {
      this.#binding?.dispose();
      this.#binding =
        targets.length > 0
          ? bindNativeHandles(this.manipulation, targets, (x, y) =>
              this.#frame ? viewportRay(this.#frame, x, y) : null,
            )
          : null;
    }
    if (this.#dirty) {
      this.#dirty = false;
      this.#publish();
    }
  }

  #adaptiveOccluders(): Occluder[] {
    return [...this.#entries.values()].flatMap(({ presentation, extent }) => {
      if (presentation.kind !== "adaptive") return [];
      const pose = this.manipulation.poseOf(presentation.itemId);
      return pose
        ? [
            transformedQuad(
              pose.position,
              pose.rotation,
              extent.width * pose.scale,
              extent.height * pose.scale,
            ),
          ]
        : [];
    });
  }

  #publish() {
    const presentations = [...this.#entries.values()].map(
      (e) => e.presentation,
    );
    const previous = this.#snapshot;
    if (
      previous.issues === this.#issues &&
      previous.presentations.length === presentations.length &&
      previous.presentations.every((p, i) => p === presentations[i])
    )
      return;
    this.#snapshot = {
      version: previous.version + 1,
      presentations,
      issues: this.#issues,
    };
    for (const listener of [...this.#listeners]) listener();
  }
}
