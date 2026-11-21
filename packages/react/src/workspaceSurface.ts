import {
  WorkspaceCoordinator,
  type PresentationRuntimeOptions,
  type PresentationSnapshot,
  type WorkspaceSnapshot,
  type WorkspaceSurface,
} from "@spatialflex/dom";
import type { SurfaceGeometry, SurfaceRef } from "@spatialflex/core/workspace";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "./context.js";

/**
 * EXPERIMENTAL (P1-08B1) React bindings of the Multi-Surface
 * `WorkspaceCoordinator`. May change without notice.
 *
 * Model (ADR 0001): each `<SpatialWorkspace>` stays the source scope of
 * ONE Surface (its own registry and controller). A Surface component calls
 * `useSpatialSurface(coordinator, id, …)` inside its `<SpatialWorkspace>`;
 * the coordinator then creates, connects and finally tears down that
 * Surface's own `PresentationRuntime`. Use `useSpatialSurface` INSTEAD of
 * `useSpatialPresentations` in such a Surface: both would create a runtime
 * over the same registry.
 */

const EMPTY_WORKSPACE: WorkspaceSnapshot = Object.freeze({
  version: 0,
  surfaces: Object.freeze([]) as readonly WorkspaceSurface[],
});
const getEmptyWorkspace = () => EMPTY_WORKSPACE;
const EMPTY_PRESENTATIONS = Object.freeze({
  version: 0,
  presentations: Object.freeze([]),
  issues: new Map(),
}) as PresentationSnapshot;
const getEmptyPresentations = () => EMPTY_PRESENTATIONS;
const noSubscription = () => () => {};
const getNoSurface = (): WorkspaceSurface | null => null;

/**
 * A `WorkspaceCoordinator` owned by the calling component (one per mount).
 *
 * It is not disposed on unmount: every `useSpatialSurface` below it removes
 * its own Surface (and so its runtime) in its own cleanup, which runs before
 * this component unmounts, and the coordinator holds no other external
 * subscription. Disposing here would break StrictMode's simulated remount,
 * which re-runs the children's effects with the same coordinator.
 */
export function useWorkspaceCoordinator(): WorkspaceCoordinator {
  return useState(() => new WorkspaceCoordinator())[0];
}

/** The live Surfaces of a coordinator (changes on add/remove/move only). */
export function useWorkspaceSurfaces(
  coordinator: WorkspaceCoordinator,
): WorkspaceSnapshot {
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    getEmptyWorkspace,
  );
}

export interface SpatialSurfaceOptions {
  /**
   * Page geometry. Treated as an immutable value: pass a NEW object to move
   * the Surface (`setGeometry`); mutating a previously passed object in place
   * has no effect (the coordinator keeps a frozen copy).
   */
  readonly geometry: SurfaceGeometry;
  /** Read when the Surface's runtime is created. */
  readonly runtime?: PresentationRuntimeOptions;
}

export interface SpatialSurfaceState extends PresentationSnapshot {
  /**
   * The coordinator's current record of this Surface (identical to
   * `coordinator.surface(ref)`, deeply frozen except `registry` / `runtime`),
   * or `null` before the first commit, after removal and on the server.
   */
  readonly surface: WorkspaceSurface | null;
}

/**
 * Registers the nearest `<SpatialWorkspace>` as Surface `surfaceId` of
 * `coordinator` while the calling component is mounted, and returns the
 * Surface (its `ref`, `runtime`) and its current presentations. Unmount
 * removes exactly this incarnation; mounting again creates a new epoch.
 *
 * @throws {SpatialFlexError} `MISSING_WORKSPACE` outside a workspace.
 */
export function useSpatialSurface(
  coordinator: WorkspaceCoordinator,
  surfaceId: string,
  options: SpatialSurfaceOptions,
): SpatialSurfaceState {
  const workspace = useWorkspace();
  // Only the incarnation's ref is React state. The Surface record itself is
  // always read from the coordinator, so the returned `surface` (and its
  // geometry) is the coordinator's current one, never a stale copy.
  const [ref, setRef] = useState<SurfaceRef | null>(null);
  const latest = useRef(options);
  /** The caller's geometry object last given to the coordinator. */
  const applied = useRef<SurfaceGeometry | null>(null);
  // Declared before the registering effect, so it sees the latest options.
  useLayoutEffect(() => {
    latest.current = options;
  });

  // Before paint, like useSpatialPresentations: the runtime is live before
  // the first frame is drawn.
  useLayoutEffect(() => {
    const added = coordinator.addSurface(surfaceId, workspace, latest.current);
    applied.current = latest.current.geometry;
    setRef(added.ref);
    return () => {
      coordinator.removeSurface(added.ref);
      setRef((current) => (current === added.ref ? null : current));
    };
  }, [coordinator, surfaceId, workspace]);

  // A new geometry object moves the live incarnation; it never
  // re-registers. (The coordinator stores a frozen copy, so the caller's
  // object identity, not the stored one, tells whether it changed.)
  const { geometry } = options;
  useLayoutEffect(() => {
    if (!ref || applied.current === geometry) return;
    applied.current = geometry;
    coordinator.setGeometry(ref, geometry);
  }, [coordinator, ref, geometry]);

  const surface = useSyncExternalStore(
    coordinator.subscribe,
    () => (ref ? (coordinator.surface(ref) ?? null) : null),
    getNoSurface,
  );
  const runtime = surface?.runtime;
  const snapshot = useSyncExternalStore(
    runtime?.subscribe ?? noSubscription,
    runtime?.getSnapshot ?? getEmptyPresentations,
    getEmptyPresentations,
  );
  return { ...snapshot, surface };
}
