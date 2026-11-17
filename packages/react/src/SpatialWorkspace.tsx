import { SpatialRegistry } from "@spatialflex/core";
import { useState, type ReactNode } from "react";
import { SpatialRegistryContext } from "./context";

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

  return (
    <SpatialRegistryContext value={registry ?? ownRegistry}>
      {children}
    </SpatialRegistryContext>
  );
}
