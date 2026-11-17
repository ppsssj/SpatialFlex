import { VERSION } from "@spatialflex/core";

/**
 * Returns the version of the `@spatialflex/core` package this React
 * integration is linked against.
 */
export function useSpatialFlexVersion(): string {
  return VERSION;
}

export { useSpatialController, useSpatialRegistry } from "./context";
export { MIN_PANEL_SIZE, type SpatialController } from "./controller";
export { useSpatialItem, useSpatialItems } from "./hooks";
export { SpatialItem, type SpatialItemProps } from "./SpatialItem";
export {
  SpatialWorkspace,
  type SpatialWorkspaceProps,
} from "./SpatialWorkspace";
