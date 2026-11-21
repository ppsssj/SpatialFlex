import type { SpatialRegistry } from "@spatialflex/core";
import {
  SurfaceTable,
  WorkspaceContractError,
  sameSurface,
  type ScopedItemRef,
  type ScopedPresentationRef,
  type SurfaceGeometry,
  type SurfaceRef,
} from "@spatialflex/core/workspace";
import {
  PresentationRuntime,
  type ExtractResult,
  type HostOptions,
  type PresentationController,
  type PresentationHost,
  type PresentationPlacement,
  type PresentationRuntimeOptions,
  type SpatialPresentation,
} from "../presentationRuntime.js";
import type { PresentationStrategy } from "@spatialflex/core";

/**
 * The source scope of one Surface: the registry and DOM controller of one
 * `<SpatialWorkspace>` (or any equivalent owner of one React subtree).
 */
export interface SurfaceSourceScope {
  readonly registry: SpatialRegistry;
  readonly controller: PresentationController;
}

export interface AddSurfaceOptions {
  /** Page geometry in the shared world (P1-08A coordinate contract). */
  readonly geometry: SurfaceGeometry;
  /** Options of this Surface's own presentation runtime. */
  readonly runtime?: PresentationRuntimeOptions;
}

/** One live Surface incarnation. */
export interface WorkspaceSurface {
  readonly ref: SurfaceRef;
  readonly registry: SpatialRegistry;
  /** This Surface's own runtime (never shared with another Surface). */
  readonly runtime: PresentationRuntime;
  readonly geometry: SurfaceGeometry;
}

export interface WorkspaceSnapshot {
  readonly version: number;
  /** Live Surfaces in registration order. */
  readonly surfaces: readonly WorkspaceSurface[];
}

export type ScopedExtractResult =
  | {
      readonly ok: true;
      readonly presentation: SpatialPresentation;
      readonly ref: ScopedPresentationRef;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Immutable input contract: a geometry is copied and deeply frozen when it
 * enters the coordinator (`addSurface`, `setGeometry`). Later mutation of
 * the caller's object (for example `pose.position[0] = …`) can therefore
 * never change a Surface behind the coordinator's back without a new
 * snapshot version. The copy is a fixed, tiny shape (O(1)).
 */
export function freezeGeometry(g: SurfaceGeometry): SurfaceGeometry {
  const [px, py, pz] = g.pose.position;
  const [qx, qy, qz, qw] = g.pose.rotation;
  return Object.freeze({
    resolution: Object.freeze({
      width: g.resolution.width,
      height: g.resolution.height,
    }),
    metersPerPixel: g.metersPerPixel,
    pose: Object.freeze({
      position: Object.freeze([px, py, pz] as const),
      rotation: Object.freeze([qx, qy, qz, qw] as const),
      scale: g.pose.scale,
    }),
  });
}

/** Value equality of two geometries (every field). */
export function sameGeometry(a: SurfaceGeometry, b: SurfaceGeometry) {
  return (
    a.resolution.width === b.resolution.width &&
    a.resolution.height === b.resolution.height &&
    a.metersPerPixel === b.metersPerPixel &&
    a.pose.scale === b.pose.scale &&
    a.pose.position.every((v, i) => v === b.pose.position[i]) &&
    a.pose.rotation.every((v, i) => v === b.pose.rotation[i])
  );
}

interface Record_ {
  surface: WorkspaceSurface;
  readonly disconnect: () => void;
}

/**
 * P1-08B1 Multi-Surface Workspace coordinator (EXPERIMENTAL).
 *
 * ADR 0001: every Surface keeps its own registry, controller and
 * `PresentationRuntime` (compositor, manipulator). The coordinator owns
 * only scene-level lifecycle:
 *
 * - Surface identity and incarnations (`SurfaceTable`: id + epoch).
 * - Creating, connecting and tearing down each Surface's runtime.
 * - Workspace-level addressing of presentations (`ScopedPresentationRef`:
 *   Surface incarnation + item registration + instance), so a stale
 *   reference never reaches another Surface or a re-registered one.
 * - An extension point for renderer hosts (`connectHost` per Surface).
 *
 * Immutability: geometries are copied and frozen on input; snapshots,
 * `WorkspaceSurface` records and their geometries are deeply frozen and
 * replaced (never mutated) on change. Only `registry` and `runtime` are live
 * handles, by design.
 *
 * It does NOT resolve depth, clip intersecting Surfaces or route input
 * across Surfaces yet (later P1-08B stages; ADR 0003 is proposed).
 *
 * Not a singleton: create one per Workspace.
 */
export class WorkspaceCoordinator {
  readonly #table = new SurfaceTable();
  readonly #records = new Map<string, Record_>();
  readonly #listeners = new Set<() => void>();
  #snapshot: WorkspaceSnapshot = Object.freeze({
    version: 0,
    surfaces: Object.freeze([]) as readonly WorkspaceSurface[],
  });
  #disposed = false;

  /**
   * Registers a Surface and starts its own runtime.
   *
   * @throws {WorkspaceContractError} `DUPLICATE_SURFACE_ID` while a Surface
   *   with this id is live; `INVALID_SURFACE_ID`; `SHARED_SOURCE_SCOPE` if
   *   another live Surface uses the same registry; `DISPOSED`.
   */
  addSurface(
    surfaceId: string,
    scope: SurfaceSourceScope,
    options: AddSurfaceOptions,
  ): WorkspaceSurface {
    this.#assertLive();
    for (const { surface } of this.#records.values())
      if (surface.registry === scope.registry)
        throw new WorkspaceContractError(
          "SHARED_SOURCE_SCOPE",
          `Surface "${surfaceId}" would share the registry of live Surface "${surface.ref.surfaceId}"; each Surface owns its own registry.`,
        );
    const geometry = freezeGeometry(options.geometry);
    // Identity first: a rejected id creates no runtime.
    const ref = this.#table.add(surfaceId, geometry, scope.registry);
    const runtime = new PresentationRuntime(
      scope.registry,
      scope.controller,
      options.runtime,
    );
    let disconnect: () => void;
    try {
      disconnect = runtime.connect();
    } catch (error) {
      this.#table.remove(ref);
      throw error;
    }
    const surface: WorkspaceSurface = Object.freeze({
      ref,
      registry: scope.registry,
      runtime,
      geometry,
    });
    this.#records.set(surfaceId, { surface, disconnect });
    this.#publish();
    return surface;
  }

  /**
   * Removes exactly this incarnation: its runtime ends every presentation
   * (restoring the originals) and releases what it owns. Other Surfaces are
   * untouched. A stale or unknown ref is a no-op (`false`).
   */
  removeSurface(ref: SurfaceRef): boolean {
    const record = this.#current(ref);
    if (!record) return false;
    this.#table.remove(ref);
    this.#records.delete(ref.surfaceId);
    record.disconnect();
    this.#publish();
    return true;
  }

  /** The live incarnation designated by `ref`, if it is still current. */
  surface(ref: SurfaceRef): WorkspaceSurface | undefined {
    return this.#current(ref)?.surface;
  }

  isLive(ref: SurfaceRef): boolean {
    return !!this.#current(ref);
  }

  /**
   * Moves a live Surface (pose or size). Stale refs are rejected (`false`).
   * The geometry is copied and frozen; a value-equal geometry changes
   * nothing (no new snapshot version).
   */
  setGeometry(ref: SurfaceRef, geometry: SurfaceGeometry): boolean {
    const record = this.#current(ref);
    if (!record) return false;
    if (sameGeometry(record.surface.geometry, geometry)) return true;
    const frozen = freezeGeometry(geometry);
    if (!this.#table.setGeometry(ref, frozen)) return false;
    record.surface = Object.freeze({ ...record.surface, geometry: frozen });
    this.#publish();
    return true;
  }

  /** Scoped reference to the current registration of an item. */
  itemRef(ref: SurfaceRef, itemId: string): ScopedItemRef | undefined {
    return this.#current(ref) ? this.#table.itemRef(ref, itemId) : undefined;
  }

  /** Scoped reference to a live presentation instance of a Surface. */
  presentationRef(
    ref: SurfaceRef,
    instanceId: string,
  ): ScopedPresentationRef | undefined {
    const record = this.#current(ref);
    const presentation = record?.surface.runtime
      .getSnapshot()
      .presentations.find((p) => p.instanceId === instanceId);
    if (!record || !presentation) return undefined;
    return Object.freeze({
      item: Object.freeze({
        surface: record.surface.ref,
        itemId: presentation.itemId,
        registrationKey: presentation.registrationKey,
      }),
      instanceId,
    });
  }

  /**
   * Whether a scoped presentation reference still designates a live
   * presentation: same Surface incarnation, same item registration, and the
   * Surface's runtime still presents that instance for that item.
   */
  isCurrent(ref: ScopedPresentationRef): boolean {
    return !!this.#resolve(ref);
  }

  /**
   * Presents an item of one Surface; the result carries the workspace-level
   * reference. Instance ids are per runtime (`adaptive-1` can exist on
   * several Surfaces), so use the scoped reference across Surfaces.
   */
  extract(
    ref: SurfaceRef,
    itemId: string,
    kind: PresentationStrategy,
    placement: PresentationPlacement,
  ): ScopedExtractResult {
    const record = this.#current(ref);
    if (!record)
      return {
        ok: false,
        reason: `Surface "${ref.surfaceId}" (epoch ${ref.epoch}) is not live.`,
      };
    const result: ExtractResult = record.surface.runtime.extract(
      itemId,
      kind,
      placement,
    );
    if (!result.ok) return result;
    return {
      ok: true,
      presentation: result.presentation,
      ref: this.presentationRef(ref, result.presentation.instanceId)!,
    };
  }

  /** A semantic action of a scoped presentation; stale refs are refused. */
  invoke(ref: ScopedPresentationRef, actionId: string): boolean {
    const surface = this.#resolve(ref);
    return !!surface && surface.runtime.invoke(ref.instanceId, actionId);
  }

  /** Ends a scoped presentation; stale refs are refused. */
  restore(ref: ScopedPresentationRef): boolean {
    const surface = this.#resolve(ref);
    return !!surface && surface.runtime.restore(ref.item.itemId);
  }

  /**
   * Renderer-host extension point: a host connection to one Surface's
   * runtime (`PresentationRuntime.connectHost`), or `null` for a stale ref.
   * Camera frames still go straight to that runtime; frame authority across
   * hosts (`FrameAuthority`) is a later stage.
   */
  connectHost(ref: SurfaceRef, options?: HostOptions): PresentationHost | null {
    return this.#current(ref)?.surface.runtime.connectHost(options) ?? null;
  }

  /** Every live presentation of every Surface, with its scoped reference. */
  presentations(): {
    readonly ref: ScopedPresentationRef;
    readonly presentation: SpatialPresentation;
  }[] {
    return [...this.#records.values()].flatMap(({ surface }) =>
      surface.runtime.getSnapshot().presentations.map((presentation) => ({
        ref: this.presentationRef(surface.ref, presentation.instanceId)!,
        presentation,
      })),
    );
  }

  // --- Observation (useSyncExternalStore-compatible) ---------------------

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getSnapshot = (): WorkspaceSnapshot => this.#snapshot;

  /** Removes every Surface and stops notifying. Further use throws. */
  dispose() {
    if (this.#disposed) return;
    for (const { surface } of [...this.#records.values()])
      this.removeSurface(surface.ref);
    this.#disposed = true;
    this.#listeners.clear();
  }

  get disposed() {
    return this.#disposed;
  }

  #current(ref: SurfaceRef): Record_ | undefined {
    const record = this.#records.get(ref.surfaceId);
    return record && sameSurface(record.surface.ref, ref) ? record : undefined;
  }

  #resolve(ref: ScopedPresentationRef): WorkspaceSurface | undefined {
    const record = this.#current(ref.item.surface);
    if (!record || !this.#table.isCurrent(ref.item)) return undefined;
    const live = record.surface.runtime
      .getSnapshot()
      .presentations.some(
        (p) =>
          p.instanceId === ref.instanceId &&
          p.itemId === ref.item.itemId &&
          p.registrationKey === ref.item.registrationKey,
      );
    return live ? record.surface : undefined;
  }

  #assertLive() {
    if (this.#disposed)
      throw new WorkspaceContractError(
        "DISPOSED",
        "This WorkspaceCoordinator was disposed.",
      );
  }

  #publish() {
    this.#snapshot = Object.freeze({
      version: this.#snapshot.version + 1,
      surfaces: Object.freeze(
        [...this.#records.values()].map((r) => r.surface),
      ),
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
