/**
 * P1-08A Multi-Surface coordination primitives, published since P1-08B1 as
 * the EXPERIMENTAL subpath `@spatialflex/core/workspace` (not re-exported
 * from `@spatialflex/core`, so the stable root entry is unchanged). The
 * subpath may change without notice until Multi-Surface leaves its
 * experimental stage. DOM-, React- and renderer-free.
 *
 * See docs/p1-08a-multi-surface-architecture.md and
 * docs/p1-08b1-multisurface-runtime.md and
 * docs/p1-08b3-multisurface-xr-integration.md.
 */
export * from "./coordinates.js";
// P1-08B3: only the atomic snapshot API of the depth resolver (experimental).
// The low-level helpers (`resolveVisibility`, `depthOwner`, `hiddenRegion`,
// …) stay internal: they lack the snapshot's whole-or-nothing error and
// input-copy contract (docs/p1-08b-depth-resolver.md).
export {
  IndeterminateDepthError,
  resolveDepthSnapshot,
  type DepthHit,
  type DepthPlane,
  type Point as DepthPoint,
  type Polygon as DepthPolygon,
  type VisibilityResult,
} from "./depthResolver.js";
export * from "./frameAuthority.js";
export * from "./identity.js";
export * from "./inputRouter.js";
export * from "./surfaces.js";
