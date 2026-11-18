import type { SpatialWebSurfacePose, SurfaceResolution } from "./surfaceMath";

/** CSS pixel layout viewport of the spatial website page. */
export const SURFACE_RESOLUTION: SurfaceResolution = {
  width: 720,
  height: 520,
};

/**
 * Default world anchor: to the left of center, slightly turned toward the
 * desktop camera, leaving room on the right for extracted panels.
 */
export const DEFAULT_SURFACE_POSE: SpatialWebSurfacePose = {
  position: [-0.42, 1.42, -1.02],
  rotation: [0, 0.15, 0],
  width: 1.62,
  height: (1.62 * SURFACE_RESOLUTION.height) / SURFACE_RESOLUTION.width,
};

/** Surface pose adjustments offered by the inspector. */
export const POSE_STEP = 0.1; // meters
export const SCALE_STEP = 1.15;
export const MIN_SURFACE_WIDTH = 0.6;
export const MAX_SURFACE_WIDTH = 3;
