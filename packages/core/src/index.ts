/**
 * Version of the `@spatialflex/core` package.
 *
 * Core stays framework-agnostic and renderer-independent: it must not import
 * React, the DOM, or any XR/3D runtime.
 */
export const VERSION = "0.0.0";
export {
  assertDetachmentStrategy,
  validateDetachmentStrategy,
  DEFAULT_DETACHMENT_STRATEGY,
  XR_MIRROR_STRATEGY,
  type DetachmentStrategy,
  type SupportedDetachmentStrategy,
} from "./strategies";
export type {
  SpatialViewBody,
  SpatialViewAction,
  SpatialViewBinding,
  SpatialViewRecord,
} from "./spatialView";

export { SpatialFlexError, type SpatialFlexErrorCode } from "./errors";
export {
  SpatialRegistry,
  type SpatialItemRegistration,
  type SpatialRegistryListener,
} from "./registry";
export type {
  AttachmentStatus,
  SpatialDetachOptions,
  SpatialItemCapabilities,
  SpatialItemDefinition,
  SpatialItemId,
  SpatialItemLayout,
  SpatialItemRecord,
  SpatialPosition,
  SpatialSize,
} from "./types";
