import { SpatialRegistry } from "@spatialflex/core";
import { useMemo, useState, type ReactNode } from "react";
import { WorkspaceContext } from "./context.js";
import { createController } from "./controller.js";

export interface SpatialWorkspaceProps {
  /**
   * Registry to use instead of one owned by this workspace, for example to
   * read it outside React. Each workspace must have its own registry.
   */
  registry?: SpatialRegistry;
  children?: ReactNode;
}

/** Provides an isolated SpatialItem registry to its descendants. */
export function SpatialWorkspace({
  registry,
  children,
}: SpatialWorkspaceProps) {
  const [ownRegistry] = useState(() => new SpatialRegistry());
  const activeRegistry = registry ?? ownRegistry;
  const workspace = useMemo(
    () => ({
      registry: activeRegistry,
      controller: createController(activeRegistry),
    }),
    [activeRegistry],
  );

  return <WorkspaceContext value={workspace}>{children}</WorkspaceContext>;
}
