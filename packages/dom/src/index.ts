/**
 * `@spatialflex/dom`: the browser DOM runtime of SpatialFlex.
 *
 * Places natively extracted elements (the original React-owned DOM nodes)
 * at world poses with CSS 3D transforms, diagnoses ancestor styles that
 * prevent that, and binds the manipulation handles that `SpatialItem`
 * renders to an item-addressed manipulator. It depends on
 * `@spatialflex/core` only: no React and no rendering engine. A renderer
 * adapter reports a {@link CameraFrame} per frame and draws its own scene.
 */
export {
  NativeCompositor,
  type CompositeOptions,
  type ContainingSurface,
  type NativeIssues,
  type NativePlacement,
  type NativeTarget,
} from "./nativeCompositor.js";
export {
  containmentReason,
  describeElement,
  nativeContainmentIssues,
  type ContainmentEffect,
  type ContainmentIssue,
  type StyleOf,
} from "./containment.js";
export {
  bindNativeHandles,
  type NativeHandleBinding,
  type NativeHandleElement,
  type NativeHandleManipulation,
} from "./nativeHandles.js";
export { trackManipulationPointer } from "./pointer.js";
export {
  PresentationRuntime,
  type ExtractResult,
  type HostFrameOptions,
  type HostFrameResult,
  type HostOptions,
  type PresentationController,
  type PresentationHost,
  type PresentationRuntimeOptions,
  type PresentationPlacement,
  type PresentationSnapshot,
  type PresentationSupport,
  type SpatialPresentation,
} from "./presentationRuntime.js";
export * from "./projection.js";
