import { SpatialFlexError, type SpatialRegistry } from "@spatialflex/core";
import { createContext, useContext } from "react";

export const SpatialRegistryContext = createContext<SpatialRegistry | null>(
  null,
);

/**
 * Returns the registry of the nearest `<SpatialWorkspace>`.
 *
 * @throws {SpatialFlexError} `MISSING_WORKSPACE` outside a workspace.
 */
export function useSpatialRegistry(): SpatialRegistry {
  const registry = useContext(SpatialRegistryContext);
  if (!registry) {
    throw new SpatialFlexError(
      "MISSING_WORKSPACE",
      "SpatialFlex hooks and <SpatialItem> must be used inside <SpatialWorkspace>.",
    );
  }
  return registry;
}
