import {
  PresentationRuntime,
  type PresentationRuntimeOptions,
  type PresentationSnapshot,
} from "@spatialflex/dom";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "./context.js";

/**
 * `@spatialflex/react/spatial`: React bindings of the spatial presentation
 * runtime (`PresentationRuntime` of @spatialflex/dom). A separate entry
 * point, so applications that only detach in 2D never load the DOM
 * runtime.
 *
 * The bindings own React lifecycle only: one runtime per workspace,
 * connected while the calling component is mounted, observed with
 * `useSyncExternalStore`. Poses and sessions stay in the runtime's
 * `ItemManipulator` (over `SpatialManipulator`); placement in its
 * `NativeCompositor`. Camera frames go straight to the runtime's host
 * (`runtime.connectHost()`), never through React state.
 */

const SERVER_SNAPSHOT: PresentationSnapshot = Object.freeze({
  version: 0,
  presentations: Object.freeze([]),
  issues: new Map(),
}) as PresentationSnapshot;
const getServerSnapshot = () => SERVER_SNAPSHOT;

export interface SpatialPresentations extends PresentationSnapshot {
  /** The workspace's runtime: extract, restore, connectHost, manipulation. */
  readonly runtime: PresentationRuntime;
}

/**
 * The presentation runtime of the nearest `<SpatialWorkspace>`, connected
 * while this component is mounted, and its current presentations. Unmount
 * ends every presentation (the originals are restored) and releases what
 * the runtime owns. Use it once per workspace, in the component that owns
 * the spatial view. `options` are read when a runtime is created.
 */
export function useSpatialPresentations(
  options?: PresentationRuntimeOptions,
): SpatialPresentations {
  const workspace = useWorkspace();
  const [entry, setEntry] = useState(() => ({
    workspace,
    runtime: new PresentationRuntime(
      workspace.registry,
      workspace.controller,
      options,
    ),
  }));
  // A replaced workspace (provider) gets its own runtime; adjusting state
  // while rendering is React's pattern for this. Construction has no side
  // effects: the runtime starts in the layout effect below.
  let { runtime } = entry;
  if (entry.workspace !== workspace) {
    runtime = new PresentationRuntime(
      workspace.registry,
      workspace.controller,
      options,
    );
    setEntry({ workspace, runtime });
  }
  // Before paint, so a presentation that ended is never drawn stale.
  useLayoutEffect(() => runtime.connect(), [runtime]);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    getServerSnapshot,
  );
  return { ...snapshot, runtime };
}

const IDLE = Object.freeze({ version: 0, active: null, selected: null });
const getIdle = () => IDLE;

/**
 * The manipulation state (active session and selection) of a runtime.
 * Changes on manipulation, not on camera frames.
 */
export function useSpatialManipulationState(runtime: PresentationRuntime) {
  return useSyncExternalStore(
    runtime.manipulation.subscribe,
    runtime.manipulation.getSnapshot,
    getIdle,
  );
}

export {
  PresentationRuntime,
  type ExtractResult,
  type HostFrameOptions,
  type HostFrameResult,
  type HostOptions,
  type PresentationHost,
  type PresentationRuntimeOptions,
  type PresentationPlacement,
  type PresentationSnapshot,
  type PresentationSupport,
  type SpatialPresentation,
} from "@spatialflex/dom";

/**
 * EXPERIMENTAL (P1-08B1): Multi-Surface Workspace bindings. May change
 * without notice; see docs/p1-08b1-multisurface-runtime.md.
 */
export {
  useSpatialSurface,
  useWorkspaceCoordinator,
  useWorkspaceSurfaces,
  type SpatialSurfaceOptions,
  type SpatialSurfaceState,
} from "./workspaceSurface.js";
export {
  WorkspaceCoordinator,
  type AddSurfaceOptions,
  type ScopedExtractResult,
  type SurfaceSourceScope,
  type WorkspaceSnapshot,
  type WorkspaceSurface,
} from "@spatialflex/dom";
