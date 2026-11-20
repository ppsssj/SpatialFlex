import {
  rotateVector,
  transformPoint,
  type SpatialQuaternion,
  type SpatialRay,
  type SpatialTransform,
  type SpatialVector3,
} from "../manipulation.js";

/**
 * P1-08A surface coordinate contract (package-internal, experimental).
 *
 * World: right-handed, +y up, the viewer looks along -z, meters (the XR
 * Lab and every SpatialFlex pose since P1-06).
 *
 * A surface is a flat page in its local x/y plane, facing local +z,
 * centered on `pose.position`. Its spaces, in order:
 *
 * 1. Surface CSS: (u, v) CSS pixels from the page's top-left, v down. The
 *    page's CSS layout size is `resolution`. Device pixel ratio never
 *    enters: CSS pixels are the unit of the page's own layout.
 * 2. Surface local: meters, origin at the page center, +x right, +y up,
 *    +z out of the page.
 *       x = (u - width / 2) * metersPerPixel
 *       y = (height / 2 - v) * metersPerPixel
 * 3. World: world = position + R(rotation) · (scale · local)
 *    (scale, then rotate, then translate; the `SpatialTransform` order
 *    `transformPoint` already uses for presentations).
 * 4. Clip and 5. viewport/client: renderer camera frames (`CameraFrame` of
 *    `@spatialflex/dom`: column-major viewProjection, client viewport
 *    rectangle). Those stay in the DOM package; this module stops at world.
 *
 * Extracted presentations are WORLD-anchored (P1-08B default): their pose
 * lives in the surface runtime's `ItemManipulator`, in world coordinates,
 * and moving the surface does not move them. Surface-relative placement
 * is a policy above this contract (compose the surface pose with a local
 * offset when the presentation starts), never a second pose store.
 */
export interface SurfaceGeometry {
  /** CSS layout size of the page, in CSS pixels. */
  readonly resolution: { readonly width: number; readonly height: number };
  /** World meters per CSS pixel at scale 1. */
  readonly metersPerPixel: number;
  /** World pose; scale multiplies the natural size. */
  readonly pose: SpatialTransform;
}

/** World size of the surface, in meters. */
export function surfaceSize(g: SurfaceGeometry) {
  const k = g.metersPerPixel * g.pose.scale;
  return { width: g.resolution.width * k, height: g.resolution.height * k };
}

/** Surface CSS (u, v) → surface local meters (z = 0). */
export function cssToLocal(
  g: SurfaceGeometry,
  u: number,
  v: number,
): SpatialVector3 {
  return [
    (u - g.resolution.width / 2) * g.metersPerPixel,
    (g.resolution.height / 2 - v) * g.metersPerPixel,
    0,
  ];
}

/** Surface CSS (u, v) → world. */
export function cssToWorld(
  g: SurfaceGeometry,
  u: number,
  v: number,
): SpatialVector3 {
  return transformPoint(g.pose, cssToLocal(g, u, v));
}

const conjugate = ([x, y, z, w]: SpatialQuaternion): SpatialQuaternion => [
  -x,
  -y,
  -z,
  w,
];

/** World → surface local meters (inverse of the pose; z = distance off the page). */
export function worldToLocal(
  g: SurfaceGeometry,
  point: SpatialVector3,
): SpatialVector3 {
  const d: SpatialVector3 = [
    point[0] - g.pose.position[0],
    point[1] - g.pose.position[1],
    point[2] - g.pose.position[2],
  ];
  const [x, y, z] = rotateVector(conjugate(g.pose.rotation), d);
  return [x / g.pose.scale, y / g.pose.scale, z / g.pose.scale];
}

/** World → surface CSS (u, v) and the local z (meters at scale 1). */
export function worldToCss(g: SurfaceGeometry, point: SpatialVector3) {
  const [x, y, z] = worldToLocal(g, point);
  return {
    u: x / g.metersPerPixel + g.resolution.width / 2,
    v: g.resolution.height / 2 - y / g.metersPerPixel,
    z,
  };
}

/** Where a ray meets a surface's page (front or back), if it does. */
export interface SurfaceIntersection {
  /** Ray parameter (in units of the ray direction's length), > 0. */
  readonly t: number;
  /** World distance from the ray origin. */
  readonly distance: number;
  readonly u: number;
  readonly v: number;
  /** Inside the page rectangle. */
  readonly inside: boolean;
  /** The ray hits the page's front (+z) face. */
  readonly front: boolean;
}

/** Ray–page intersection; `null` when parallel or behind the origin. */
export function intersectSurface(
  g: SurfaceGeometry,
  ray: SpatialRay,
): SurfaceIntersection | null {
  const normal = rotateVector(g.pose.rotation, [0, 0, 1]);
  const dot = (a: SpatialVector3, b: SpatialVector3) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const denom = dot(normal, ray.direction);
  if (Math.abs(denom) < 1e-12) return null;
  const toPlane: SpatialVector3 = [
    g.pose.position[0] - ray.origin[0],
    g.pose.position[1] - ray.origin[1],
    g.pose.position[2] - ray.origin[2],
  ];
  const t = dot(normal, toPlane) / denom;
  if (!(t > 0)) return null;
  const hit: SpatialVector3 = [
    ray.origin[0] + ray.direction[0] * t,
    ray.origin[1] + ray.direction[1] * t,
    ray.origin[2] + ray.direction[2] * t,
  ];
  const { u, v } = worldToCss(g, hit);
  const length = Math.hypot(...ray.direction);
  return {
    t,
    distance: t * length,
    u,
    v,
    inside:
      u >= 0 && v >= 0 && u <= g.resolution.width && v <= g.resolution.height,
    front: denom < 0,
  };
}
