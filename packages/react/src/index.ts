import { VERSION } from "@spatialflex/core";

/**
 * Returns the version of the `@spatialflex/core` package this React
 * integration is linked against.
 */
export function useSpatialFlexVersion(): string {
  return VERSION;
}

export { useSpatialController, useSpatialRegistry } from "./context.js";
export {
  MIN_PANEL_SIZE,
  type ItemPlacement,
  type SpatialController,
} from "./controller.js";
export { useSpatialItem, useSpatialItems } from "./hooks.js";
export { useSpatialViews } from "./hooks.js";
export type {
  PresentationStrategy,
  SpatialViewBody,
  SpatialViewAction,
  SpatialViewBinding,
  SpatialViewRecord,
} from "@spatialflex/core";
export { SpatialItem, type SpatialItemProps } from "./SpatialItem.js";
export {
  SpatialWorkspace,
  type SpatialWorkspaceProps,
} from "./SpatialWorkspace.js";
