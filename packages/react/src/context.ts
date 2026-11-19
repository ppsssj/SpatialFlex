import { SpatialFlexError, type SpatialRegistry } from "@spatialflex/core";
import { createContext, useContext } from "react";
import type { SpatialController, WorkspaceController } from "./controller.js";

export interface WorkspaceContextValue {
  readonly registry: SpatialRegistry;
  readonly controller: WorkspaceController;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
);

/** @throws {SpatialFlexError} `MISSING_WORKSPACE` outside a workspace. */
export function useWorkspace(): WorkspaceContextValue {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new SpatialFlexError(
      "MISSING_WORKSPACE",
      "SpatialFlex hooks and <SpatialItem> must be used inside <SpatialWorkspace>.",
    );
  }
  return workspace;
}

/**
 * Returns the registry of the nearest `<SpatialWorkspace>`.
 *
 * @throws {SpatialFlexError} `MISSING_WORKSPACE` outside a workspace.
 */
export function useSpatialRegistry(): SpatialRegistry {
  return useWorkspace().registry;
}

/**
 * Returns detach/attach/move actions of the nearest `<SpatialWorkspace>`.
 * The returned object is stable for the workspace's lifetime.
 *
 * @throws {SpatialFlexError} `MISSING_WORKSPACE` outside a workspace.
 */
export function useSpatialController(): SpatialController {
  return useWorkspace().controller;
}
