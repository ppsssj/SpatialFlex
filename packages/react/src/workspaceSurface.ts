import {
  WorkspaceCoordinator,
  type PresentationRuntimeOptions,
  type PresentationSnapshot,
  type WorkspaceSnapshot,
  type WorkspaceSurface,
} from "@spatialflex/dom";
import type { SurfaceGeometry } from "@spatialflex/core/workspace";
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
  /** Page geometry; a new object moves the Surface (`setGeometry`). */
  readonly geometry: SurfaceGeometry;
  /** Read when the Surface's runtime is created. */
  readonly runtime?: PresentationRuntimeOptions;
}

export interface SpatialSurfaceState extends PresentationSnapshot {
  /** The live incarnation, or `null` before the first commit / on the server. */
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
  const [surface, setSurface] = useState<WorkspaceSurface | null>(null);
  const latest = useRef(options);
  // Declared before the registering effect, so it sees the latest options.
  useLayoutEffect(() => {
    latest.current = options;
  });

  // Before paint, like useSpatialPresentations: the runtime is live before
  // the first frame is drawn.
  useLayoutEffect(() => {
    const added = coordinator.addSurface(surfaceId, workspace, latest.current);
    setSurface(added);
    return () => {
      coordinator.removeSurface(added.ref);
      setSurface((current) => (current === added ? null : current));
    };
  }, [coordinator, surfaceId, workspace]);

  // Pose / size changes move the live incarnation; they never re-register.
  const { geometry } = options;
  useLayoutEffect(() => {
    if (surface && surface.geometry !== geometry)
      coordinator.setGeometry(surface.ref, geometry);
  }, [coordinator, surface, geometry]);

  const runtime = surface?.runtime;
  const snapshot = useSyncExternalStore(
    runtime?.subscribe ?? noSubscription,
    runtime?.getSnapshot ?? getEmptyPresentations,
    getEmptyPresentations,
  );
  return { ...snapshot, surface };
}
