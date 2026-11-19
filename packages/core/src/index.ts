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
} from "./strategies.js";
export {
  assertExtraction,
  assertPresentationStrategy,
  defaultPresentation,
  presentationSupport,
  validateExtraction,
  validatePresentationStrategy,
  type ExtractionContext,
  type ExtractionRequest,
  type ExtractionSource,
  type PresentationStrategy,
  type SupportedExtraction,
} from "./presentation.js";
export {
  assertSourceVisibility,
  validateSourceVisibility,
  type SourceVisibility,
  type SourceVisibilityRequest,
} from "./sourceVisibility.js";
export type {
  SpatialViewBody,
  SpatialViewAction,
  SpatialViewBinding,
  SpatialViewRecord,
} from "./spatialView.js";

export {
  assertTransform,
  IDENTITY_ROTATION,
  KEYBOARD_STEPS,
  MIN_PLANE_FACING,
  multiplyQuaternions,
  rotateVector,
  SCALE_LIMITS,
  SpatialManipulator,
  transformPoint,
  validateTransform,
  yawOf,
  yawQuaternion,
  type ActiveManipulation,
  type ManipulationEnd,
  type ManipulationInput,
  type ManipulationMode,
  type ManipulationSnapshot,
  type ManipulationTarget,
  type ManipulationTargetOptions,
  type SpatialExtent,
  type SpatialQuaternion,
  type SpatialRay,
  type SpatialTransform,
  type SpatialVector3,
} from "./manipulation.js";
export {
  ItemManipulator,
  type ItemManipulationSnapshot,
  type ItemManipulationTarget,
  type ManipulablePresentation,
  type NudgeDirection,
} from "./items.js";
export { SpatialFlexError, type SpatialFlexErrorCode } from "./errors.js";
export {
  SpatialRegistry,
  type SpatialItemRegistration,
  type SpatialRegistryListener,
} from "./registry.js";
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
} from "./types.js";
