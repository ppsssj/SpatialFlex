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

/** Four world corners of a planar quad, in order around it. */
export type WorldQuad = readonly [Vec3, Vec3, Vec3, Vec3];
/** Something that can occlude a surface: an XR HostPanel rect or a quad. */
export type Occluder = WorldRect | WorldQuad;
type Point2 = [number, number];

const quadOf = (o: Occluder): WorldQuad => {
  if (Array.isArray(o)) return o as WorldQuad;
  const { center, width, height } = o as WorldRect;
  const [x, y, z] = center;
  const hw = width / 2,
    hh = height / 2;
  return [
    [x - hw, y + hh, z],
    [x + hw, y + hh, z],
    [x + hw, y - hh, z],
    [x - hw, y - hh, z],
  ];
};
const centroid = (q: WorldQuad): Vec3 => [
  (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4,
  (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4,
  (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4,
];

/** World corners of a surface (top-left, top-right, bottom-right, bottom-left). */
export function surfaceQuad(
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
): WorldQuad {
  const { width: W, height: H } = resolution;
  return [
    surfacePoint(pose, resolution, 0, 0),
    surfacePoint(pose, resolution, W, 0),
    surfacePoint(pose, resolution, W, H),
    surfacePoint(pose, resolution, 0, H),
  ];
}

/** Occluders in front of the surface, as quads in its local CSS pixels. */
function localHoles(
  frame: HostCameraFrame,
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
  occluders: readonly Occluder[],
): Point2[][] {
  const { normal } = surfaceAxes(pose);
  const inverse = invert3(homography(frame, pose, resolution));
  if (!inverse) return [];
  const holes: Point2[][] = [];
  for (const occluder of occluders) {
    const quad = quadOf(occluder);
    if (dot(normal, sub(centroid(quad), pose.position)) <= 0.005) continue;
    const local: Point2[] = [];
    for (const corner of quad) {
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
    // Skip occluders that do not reach the surface at all.
    if (
      Math.max(...xs) < 0 ||
      Math.min(...xs) > resolution.width ||
      Math.max(...ys) < 0 ||
      Math.min(...ys) > resolution.height
    )
      continue;
    holes.push(local);
  }
  return holes;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

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
  occluders: readonly Occluder[],
): string {
  const holes = localHoles(frame, pose, resolution, occluders);
  if (holes.length === 0) return "none";
  const px = ([u, v]: Point2) => `${r1(u)}px ${r1(v)}px`;
  const { width: W, height: H } = resolution;
  return `polygon(evenodd, 0px 0px, ${W}px 0px, ${W}px ${H}px, 0px ${H}px, 0px 0px, ${holes
    .map((hole) => [...hole, hole[0]!].map(px).join(", ") + ", 0px 0px")
    .join(", ")})`;
}

const signedArea = (q: readonly Point2[]) =>
  q.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = q[(i + 1) % q.length]!;
    return sum + x1 * y2 - x2 * y1;
  }, 0);
const oriented = (q: Point2[], sign: number) =>
  Math.sign(signedArea(q)) === sign ? q : [...q].reverse();

/**
 * The page clip when natively extracted elements are composited as its
 * descendants: `clip-path` clips descendants too, so their footprint in the
 * page plane (`keep`) is united with the page (nonzero winding) while
 * occluders in front are still cut out.
 */
export function pageClipPath(
  frame: HostCameraFrame,
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
  occluders: readonly Occluder[],
  keep: readonly Point2[][],
): string {
  if (keep.length === 0)
    return occlusionClipPath(frame, pose, resolution, occluders);
  const { width: W, height: H } = resolution;
  const outer: Point2[] = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ];
  const sign = Math.sign(signedArea(outer));
  const loops = [
    outer,
    ...localHoles(frame, pose, resolution, occluders).map((hole) =>
      oriented(hole, -sign),
    ),
    ...keep.map((quad) => oriented([...quad], sign)),
  ];
  const d = loops
    .map(
      (loop) => `M ${loop.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(" L ")} Z`,
    )
    .join(" ");
  return `path(nonzero, "${d}")`;
}

const matrix3d = (h: Mat3) =>
  `matrix3d(${[
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
  ]
    .map((n) => Number(n.toPrecision(12)))
    .join(",")})`;

const mul3 = (a: Mat3, b: Mat3): Mat3 => {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      m[r * 3 + c] =
        a[r * 3]! * b[c]! +
        a[r * 3 + 1]! * b[3 + c]! +
        a[r * 3 + 2]! * b[6 + c]!;
  return m;
};

/** The page transform for any camera that does not cross its plane. */
export function surfaceMatrix(
  frame: HostCameraFrame,
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
): string {
  return matrix3d(homography(frame, pose, resolution));
}

/** Facing and camera-plane checks shared by every composited plane. */
export function planeVisibility(
  frame: HostCameraFrame,
  pose: SpatialWebSurfacePose,
  resolution: SurfaceResolution,
): SurfaceVisibility {
  const { normal } = surfaceAxes(pose);
  if (dot(normal, sub(frame.eye, pose.position)) <= 0) return "back";
  for (const corner of surfaceQuad(pose, resolution))
    if (clip(frame.viewProjection, corner)[2] <= NEAR_W) return "behind";
  return "visible";
}

export type NativePanelPlacement =
  | {
      readonly visibility: "visible";
      /** CSS transform for the element, relative to its containing block. */
      readonly matrix3d: string;
      /** The element's footprint in the page's border-box pixels. */
      readonly pageQuad: Point2[];
      /** The panel lies behind the page plane (seen from the camera). */
      readonly behindPage: boolean;
    }
  | { readonly visibility: "back" | "behind" | "unmappable" };

/**
 * Places a descendant of the composited page at its own world pose.
 *
 * The element stays where React rendered it, inside the page, so every CSS
 * transform of the page also applies to it. With `position: fixed; left: 0;
 * top: 0` its containing block is the page's padding box (the page is
 * transformed), i.e. border-box offset `border`. Its own transform is
 *
 *   T = translate(-border) · H_page⁻¹ · H_panel
 *
 * so the composed mapping H_page · translate(border) · T equals H_panel: the
 * parent's world transform is cancelled by its inverse and the same node is
 * projected at an independent pose. Unmappable when the panel would cross
 * the page plane's horizon (mixed homogeneous signs).
 */
export function nativePanelTransform(
  frame: HostCameraFrame,
  page: {
    readonly pose: SpatialWebSurfacePose;
    readonly resolution: SurfaceResolution;
    readonly border: number;
  },
  panel: {
    readonly pose: SpatialWebSurfacePose;
    readonly resolution: SurfaceResolution;
  },
): NativePanelPlacement {
  const visibility = planeVisibility(frame, panel.pose, panel.resolution);
  if (visibility !== "visible") return { visibility };
  if (planeVisibility(frame, page.pose, page.resolution) === "behind")
    return { visibility: "unmappable" };
  const inverse = invert3(homography(frame, page.pose, page.resolution));
  if (!inverse) return { visibility: "unmappable" };
  const b = page.border;
  let t = mul3(
    [1, 0, -b, 0, 1, -b, 0, 0, 1],
    mul3(inverse, homography(frame, panel.pose, panel.resolution)),
  );
  const { width: w, height: h } = panel.resolution;
  const corners: Point2[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const ws = corners.map(([u, v]) => t[6] * u + t[7] * v + t[8]);
  // A homography is defined up to scale: keep w positive for CSS.
  if (ws.every((x) => x < 0)) t = t.map((x) => -x) as Mat3;
  else if (!ws.every((x) => x > 0)) return { visibility: "unmappable" };
  const pageQuad = corners.map(([u, v]): Point2 => {
    const x = t[0] * u + t[1] * v + t[2];
    const y = t[3] * u + t[4] * v + t[5];
    const z = t[6] * u + t[7] * v + t[8];
    return [x / z + b, y / z + b];
  });
  const { normal } = surfaceAxes(page.pose);
  return {
    visibility: "visible",
    matrix3d: matrix3d(t),
    pageQuad,
    behindPage: dot(normal, sub(panel.pose.position, page.pose.position)) < 0,
  };
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

// --- Spatial manipulation interop (P1-06B) ------------------------------

export type Quaternion = readonly [x: number, y: number, z: number, w: number];

/** Quaternion of XYZ Euler angles (the convention of {@link rotationMatrix}). */
export function quaternionFromEuler([x, y, z]: Vec3): Quaternion {
  const c1 = Math.cos(x / 2),
    c2 = Math.cos(y / 2),
    c3 = Math.cos(z / 2),
    s1 = Math.sin(x / 2),
    s2 = Math.sin(y / 2),
    s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** XYZ Euler angles of a unit quaternion (inverse of {@link quaternionFromEuler}). */
export function eulerFromQuaternion([x, y, z, w]: Quaternion): Vec3 {
  const m11 = 1 - 2 * (y * y + z * z),
    m12 = 2 * (x * y - z * w),
    m13 = 2 * (x * z + y * w),
    m22 = 1 - 2 * (x * x + z * z),
    m23 = 2 * (y * z - x * w),
    m32 = 2 * (y * z + x * w),
    m33 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(Math.min(1, Math.max(-1, m13)));
  return Math.abs(m13) < 0.9999999
    ? [Math.atan2(-m23, m33), ry, Math.atan2(-m12, m11)]
    : [Math.atan2(m32, m22), ry, 0];
}

/**
 * World corners (TL, TR, BR, BL) of a rectangle at a pose, centered on the
 * local point `center` (in the same, already scaled, units as the size).
 */
export function transformedQuad(
  position: Vec3,
  rotation: Quaternion,
  width: number,
  height: number,
  center: Vec3 = [0, 0, 0],
): WorldQuad {
  const r = rotationMatrix(eulerFromQuaternion(rotation));
  const corner = (u: number, v: number) =>
    add(
      position,
      rotate(r, [center[0] + u * width, center[1] + v * height, center[2]]),
    );
  return [
    corner(-0.5, 0.5),
    corner(0.5, 0.5),
    corner(0.5, -0.5),
    corner(-0.5, -0.5),
  ];
}

/** Inverse of a column-major 4x4 matrix, or null if singular. */
function invert4(m: ArrayLike<number>): number[] | null {
  const a = Array.from({ length: 16 }, (_, i) => m[i]!);
  const inv = new Array<number>(16);
  inv[0] =
    a[5]! * a[10]! * a[15]! -
    a[5]! * a[11]! * a[14]! -
    a[9]! * a[6]! * a[15]! +
    a[9]! * a[7]! * a[14]! +
    a[13]! * a[6]! * a[11]! -
    a[13]! * a[7]! * a[10]!;
  inv[4] =
    -a[4]! * a[10]! * a[15]! +
    a[4]! * a[11]! * a[14]! +
    a[8]! * a[6]! * a[15]! -
    a[8]! * a[7]! * a[14]! -
    a[12]! * a[6]! * a[11]! +
    a[12]! * a[7]! * a[10]!;
  inv[8] =
    a[4]! * a[9]! * a[15]! -
    a[4]! * a[11]! * a[13]! -
    a[8]! * a[5]! * a[15]! +
    a[8]! * a[7]! * a[13]! +
    a[12]! * a[5]! * a[11]! -
    a[12]! * a[7]! * a[9]!;
  inv[12] =
    -a[4]! * a[9]! * a[14]! +
    a[4]! * a[10]! * a[13]! +
    a[8]! * a[5]! * a[14]! -
    a[8]! * a[6]! * a[13]! -
    a[12]! * a[5]! * a[10]! +
    a[12]! * a[6]! * a[9]!;
  inv[1] =
    -a[1]! * a[10]! * a[15]! +
    a[1]! * a[11]! * a[14]! +
    a[9]! * a[2]! * a[15]! -
    a[9]! * a[3]! * a[14]! -
    a[13]! * a[2]! * a[11]! +
    a[13]! * a[3]! * a[10]!;
  inv[5] =
    a[0]! * a[10]! * a[15]! -
    a[0]! * a[11]! * a[14]! -
    a[8]! * a[2]! * a[15]! +
    a[8]! * a[3]! * a[14]! +
    a[12]! * a[2]! * a[11]! -
    a[12]! * a[3]! * a[10]!;
  inv[9] =
    -a[0]! * a[9]! * a[15]! +
    a[0]! * a[11]! * a[13]! +
    a[8]! * a[1]! * a[15]! -
    a[8]! * a[3]! * a[13]! -
    a[12]! * a[1]! * a[11]! +
    a[12]! * a[3]! * a[9]!;
  inv[13] =
    a[0]! * a[9]! * a[14]! -
    a[0]! * a[10]! * a[13]! -
    a[8]! * a[1]! * a[14]! +
    a[8]! * a[2]! * a[13]! +
    a[12]! * a[1]! * a[10]! -
    a[12]! * a[2]! * a[9]!;
  inv[2] =
    a[1]! * a[6]! * a[15]! -
    a[1]! * a[7]! * a[14]! -
    a[5]! * a[2]! * a[15]! +
    a[5]! * a[3]! * a[14]! +
    a[13]! * a[2]! * a[7]! -
    a[13]! * a[3]! * a[6]!;
  inv[6] =
    -a[0]! * a[6]! * a[15]! +
    a[0]! * a[7]! * a[14]! +
    a[4]! * a[2]! * a[15]! -
    a[4]! * a[3]! * a[14]! -
    a[12]! * a[2]! * a[7]! +
    a[12]! * a[3]! * a[6]!;
  inv[10] =
    a[0]! * a[5]! * a[15]! -
    a[0]! * a[7]! * a[13]! -
    a[4]! * a[1]! * a[15]! +
    a[4]! * a[3]! * a[13]! +
    a[12]! * a[1]! * a[7]! -
    a[12]! * a[3]! * a[5]!;
  inv[14] =
    -a[0]! * a[5]! * a[14]! +
    a[0]! * a[6]! * a[13]! +
    a[4]! * a[1]! * a[14]! -
    a[4]! * a[2]! * a[13]! -
    a[12]! * a[1]! * a[6]! +
    a[12]! * a[2]! * a[5]!;
  inv[3] =
    -a[1]! * a[6]! * a[11]! +
    a[1]! * a[7]! * a[10]! +
    a[5]! * a[2]! * a[11]! -
    a[5]! * a[3]! * a[10]! -
    a[9]! * a[2]! * a[7]! +
    a[9]! * a[3]! * a[6]!;
  inv[7] =
    a[0]! * a[6]! * a[11]! -
    a[0]! * a[7]! * a[10]! -
    a[4]! * a[2]! * a[11]! +
    a[4]! * a[3]! * a[10]! +
    a[8]! * a[2]! * a[7]! -
    a[8]! * a[3]! * a[6]!;
  inv[11] =
    -a[0]! * a[5]! * a[11]! +
    a[0]! * a[7]! * a[9]! +
    a[4]! * a[1]! * a[11]! -
    a[4]! * a[3]! * a[9]! -
    a[8]! * a[1]! * a[7]! +
    a[8]! * a[3]! * a[5]!;
  inv[15] =
    a[0]! * a[5]! * a[10]! -
    a[0]! * a[6]! * a[9]! -
    a[4]! * a[1]! * a[10]! +
    a[4]! * a[2]! * a[9]! +
    a[8]! * a[1]! * a[6]! -
    a[8]! * a[2]! * a[5]!;
  const det =
    a[0]! * inv[0]! + a[1]! * inv[4]! + a[2]! * inv[8]! + a[3]! * inv[12]!;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return inv.map((v) => v / det);
}

/**
 * World ray through a client (CSS pixel) point, from the camera of a
 * rendered frame: the inverse of the projection the host drew with. Used
 * for Native DOM handles, which receive DOM events rather than engine
 * raycasts.
 */
export function viewportRay(
  frame: HostCameraFrame,
  clientX: number,
  clientY: number,
): { origin: Vec3; direction: Vec3 } | null {
  const { left, top, width, height } = frame.viewport;
  if (!(width > 0 && height > 0)) return null;
  const inv = invert4(frame.viewProjection);
  if (!inv) return null;
  const x = ((clientX - left) / width) * 2 - 1;
  const y = 1 - ((clientY - top) / height) * 2;
  // A point between the near and far planes (in both NDC depth ranges).
  const z = 0.5;
  const w = inv[3]! * x + inv[7]! * y + inv[11]! * z + inv[15]!;
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  const point: Vec3 = [
    (inv[0]! * x + inv[4]! * y + inv[8]! * z + inv[12]!) / w,
    (inv[1]! * x + inv[5]! * y + inv[9]! * z + inv[13]!) / w,
    (inv[2]! * x + inv[6]! * y + inv[10]! * z + inv[14]!) / w,
  ];
  const direction = sub(point, frame.eye);
  const length = Math.hypot(...direction);
  if (!(length > 1e-9)) return null;
  return {
    origin: [...frame.eye] as Vec3,
    direction: [
      direction[0] / length,
      direction[1] / length,
      direction[2] / length,
    ],
  };
}
