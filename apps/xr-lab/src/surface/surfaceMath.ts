import type { HostCameraFrame, Vec3 } from "../contracts/xrHost";

/**
 * World pose of a spatial web surface. The surface is a flat rectangle in
 * its local x/y plane, facing local +z, centered on `position`.
 */
export interface SpatialWebSurfacePose {
  /** Center, in meters. */
  readonly position: Vec3;
  /** Euler angles in radians, applied in X, Y, Z order (as in Three.js). */
  readonly rotation: Vec3;
  /** World width and height, in meters. */
  readonly width: number;
  readonly height: number;
}

/** CSS pixel size of the surface's HTML page (its layout viewport). */
export interface SurfaceResolution {
  readonly width: number;
  readonly height: number;
}

/** A world-space, axis-aligned rectangle facing +z (an XR HostPanel). */
export interface WorldRect {
  readonly center: Vec3;
  readonly width: number;
  readonly height: number;
}

type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Row-major rotation matrix for XYZ Euler angles. */
export function rotationMatrix([x, y, z]: Vec3): Mat3 {
  const a = Math.cos(x),
    b = Math.sin(x),
    c = Math.cos(y),
    d = Math.sin(y),
    e = Math.cos(z),
    f = Math.sin(z);
  const ae = a * e,
    af = a * f,
    be = b * e,
    bf = b * f;
  return [
    c * e,
    -c * f,
    d,
    af + be * d,
    ae - bf * d,
    -b * c,
    bf - ae * d,
    be + af * d,
    a * c,
  ];
}

const rotate = (r: Mat3, [x, y, z]: Vec3): Vec3 => [
  r[0] * x + r[1] * y + r[2] * z,
  r[3] * x + r[4] * y + r[5] * z,
  r[6] * x + r[7] * y + r[8] * z,
];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Surface axes in world space: right, up and the facing normal. */
export function surfaceAxes(pose: SpatialWebSurfacePose) {
  const r = rotationMatrix(pose.rotation);
  return {
    right: rotate(r, [1, 0, 0]),
    up: rotate(r, [0, 1, 0]),
    normal: rotate(r, [0, 0, 1]),
  };
}

/** World position of a point of the page, given in CSS pixels from its top-left. */
export function surfacePoint(
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
  u: number,
  v: number,
): Vec3 {
  const { right, up } = surfaceAxes(pose);
  const x = (u / resolution.width - 0.5) * pose.width;
  const y = (0.5 - v / resolution.height) * pose.height;
  return add(add(pose.position, right, x), up, y);
}

/** Clip-space coordinates (x, y, w) of a world point. */
function clip(vp: ArrayLike<number>, [x, y, z]: Vec3) {
  return [
    vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!,
    vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!,
    vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!,
  ] as const;
}

/** Nearest allowed clip w: corners closer than this are treated as behind. */
const NEAR_W = 0.05;

/** Viewport-relative CSS pixel position of a world point, or null if behind the camera. */
export function projectPoint(
  frame: HostCameraFrame,
  point: Vec3,
): { x: number; y: number } | null {
  const [cx, cy, cw] = clip(frame.viewProjection, point);
  if (cw <= NEAR_W) return null;
  const { width, height } = frame.viewport;
  return {
    x: ((cx / cw + 1) / 2) * width,
    y: ((1 - cy / cw) / 2) * height,
  };
}

/**
 * The surface's page-pixel → viewport-pixel projective transform, as the
 * 3x3 matrix (row-major) of a planar homography: [X, Y, W] = H [u, v, 1].
 */
function homography(
  frame: HostCameraFrame,
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
): Mat3 {
  const origin = surfacePoint(pose, resolution, 0, 0);
  const du = sub(surfacePoint(pose, resolution, 1, 0), origin);
  const dv = sub(surfacePoint(pose, resolution, 0, 1), origin);
  const vp = frame.viewProjection;
  // Clip-space rows applied to a direction (w = 0) or a point (w = 1).
  const row = (i: number, [x, y, z]: Vec3, w: 0 | 1) =>
    vp[i]! * x + vp[i + 4]! * y + vp[i + 8]! * z + vp[i + 12]! * w;
  const { width, height } = frame.viewport;
  // Viewport mapping in homogeneous form, before the perspective division:
  // X = (x + w) * width / 2,  Y = (w - y) * height / 2.
  const toX = (v: Vec3, w: 0 | 1) =>
    ((row(0, v, w) + row(3, v, w)) * width) / 2;
  const toY = (v: Vec3, w: 0 | 1) =>
    ((row(3, v, w) - row(1, v, w)) * height) / 2;
  const toW = (v: Vec3, w: 0 | 1) => row(3, v, w);
  return [
    toX(du, 0),
    toX(dv, 0),
    toX(origin, 1),
    toY(du, 0),
    toY(dv, 0),
    toY(origin, 1),
    toW(du, 0),
    toW(dv, 0),
    toW(origin, 1),
  ];
}

export type SurfaceVisibility = "visible" | "behind" | "back";

/**
 * Computes the CSS `matrix3d` that composites the page onto the surface
 * pose for this camera frame. The element must use `transform-origin: 0 0`
 * and sit at the viewport's top-left corner.
 *
 * The browser applies the perspective division of the homography, so the
 * page keeps its exact perspective relationship with the 3D world, and hit
 * testing follows the transformed geometry.
 */
export function surfaceTransform(
  frame: HostCameraFrame,
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
):
  | { readonly visibility: "visible"; readonly matrix3d: string }
  | { readonly visibility: "behind" | "back" } {
  const { normal } = surfaceAxes(pose);
  if (dot(normal, sub(frame.eye, pose.position)) <= 0)
    return { visibility: "back" };
  const corners: [number, number][] = [
    [0, 0],
    [resolution.width, 0],
    [0, resolution.height],
    [resolution.width, resolution.height],
  ];
  for (const [u, v] of corners)
    if (
      clip(frame.viewProjection, surfacePoint(pose, resolution, u, v))[2] <=
      NEAR_W
    )
      return { visibility: "behind" };
  const h = homography(frame, pose, resolution);
  // Column-major 4x4. The local z axis maps to itself so the matrix stays
  // invertible (non-invertible transforms are not rendered or hit-tested);
  // the page is flat, so z never contributes to x, y or w.
  const m = [
    h[0],
    h[3],
    0,
    h[6],
    h[1],
    h[4],
    0,
    h[7],
    0,
    0,
    1,
    0,
    h[2],
    h[5],
    0,
    h[8],
  ];
  return {
    visibility: "visible",
    matrix3d: `matrix3d(${m.map((n) => Number(n.toPrecision(12))).join(",")})`,
  };
}

function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const s = 1 / det;
  return [
    A * s,
    -(b * i - c * h) * s,
    (b * f - c * e) * s,
    B * s,
    (a * i - c * g) * s,
    -(a * f - c * d) * s,
    C * s,
    -(a * h - b * g) * s,
    (a * e - b * d) * s,
  ];
}

/**
 * Explicit occlusion: the HTML surface is composited above the WebGL canvas,
 * so rectangles that are between the surface plane and the camera are cut
 * out of the page with an even-odd `clip-path`. The 3D object then shows
 * through, and pointer input in that area reaches the canvas. Rectangles
 * behind the plane stay hidden by the page, as in a depth-tested scene.
 *
 * Returns `none` when nothing occludes the page.
 */
export function occlusionClipPath(
  frame: HostCameraFrame,
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
  occluders: readonly WorldRect[],
): string {
  const { normal } = surfaceAxes(pose);
  const inverse = invert3(homography(frame, pose, resolution));
  if (!inverse) return "none";
  const holes: string[] = [];
  for (const rect of occluders) {
    if (dot(normal, sub(rect.center, pose.position)) <= 0.005) continue;
    const [x, y, z] = rect.center;
    const hw = rect.width / 2,
      hh = rect.height / 2;
    const local: [number, number][] = [];
    for (const corner of [
      [x - hw, y + hh, z],
      [x + hw, y + hh, z],
      [x + hw, y - hh, z],
      [x - hw, y - hh, z],
    ] as Vec3[]) {
      const p = projectPoint(frame, corner);
      if (!p) break;
      const u = inverse[0] * p.x + inverse[1] * p.y + inverse[2];
      const v = inverse[3] * p.x + inverse[4] * p.y + inverse[5];
      const w = inverse[6] * p.x + inverse[7] * p.y + inverse[8];
      if (Math.abs(w) < 1e-9) break;
      local.push([u / w, v / w]);
    }
    if (local.length !== 4) continue;
    const xs = local.map(([u]) => u),
      ys = local.map(([, v]) => v);
    // Skip rectangles that do not reach the page at all.
    if (
      Math.max(...xs) < 0 ||
      Math.min(...xs) > resolution.width ||
      Math.max(...ys) < 0 ||
      Math.min(...ys) > resolution.height
    )
      continue;
    const px = ([u, v]: [number, number]) =>
      `${Math.round(u * 10) / 10}px ${Math.round(v * 10) / 10}px`;
    holes.push([...local, local[0]!].map(px).join(", ") + ", 0px 0px");
  }
  if (holes.length === 0) return "none";
  const { width: W, height: H } = resolution;
  return `polygon(evenodd, 0px 0px, ${W}px 0px, ${W}px ${H}px, 0px ${H}px, 0px 0px, ${holes.join(", ")})`;
}

/**
 * World position for the `index`-th extracted panel: beside the surface's
 * right edge, slightly toward the viewer, stacked from the top. Separate
 * from the surface so it neither overlaps nor hides behind it initially.
 */
export function extractionPosition(
  pose: SpatialWebSurfacePose,
  index: number,
  panel: { readonly width: number; readonly height: number },
): Vec3 {
  const { right, normal } = surfaceAxes(pose);
  const beside = add(
    add(pose.position, right, pose.width / 2 + panel.width / 2 + 0.12),
    normal,
    0.3,
  );
  const top = pose.position[1] + pose.height / 2 - panel.height / 2;
  const y = top - index * (panel.height + 0.06);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return [round(beside[0]), round(y), round(beside[2])];
}
