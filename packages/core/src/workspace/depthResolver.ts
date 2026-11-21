import {
  cssToWorld,
  intersectSurface,
  type SurfaceGeometry,
} from "./coordinates.js";
import { rotateVector } from "../manipulation.js";

export type Vec3 = readonly [number, number, number];
export type Point = readonly [number, number];
export type Polygon = readonly Point[];

export interface DepthPlane {
  /** Stable key, e.g. `A`, `A/native`, `panel`. */
  readonly key: string;
  readonly geometry: SurfaceGeometry;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function coplanar(a: SurfaceGeometry, b: SurfaceGeometry): boolean {
  const na = planeOf(a).normal;
  const nb = planeOf(b).normal;
  const alignment = cross(na, nb);
  return (
    alignment.every((v) => v === 0) &&
    dot(na, nb) > 0 &&
    dot(na, sub(b.pose.position, a.pose.position)) === 0
  );
}

/** World corners (top-left, top-right, bottom-right, bottom-left). */
export function corners(g: SurfaceGeometry): [Vec3, Vec3, Vec3, Vec3] {
  const { width: W, height: H } = g.resolution;
  return [
    cssToWorld(g, 0, 0),
    cssToWorld(g, W, 0),
    cssToWorld(g, W, H),
    cssToWorld(g, 0, H),
  ];
}

/** Plane normal and origin in world space, from the pose instead of CSS differences. */
export function planeOf(g: SurfaceGeometry) {
  const n = rotateVector(g.pose.rotation, [0, 0, 1]);
  const length = Math.hypot(...n);
  if (!Number.isFinite(length) || length === 0)
    throw new RangeError("Invalid plane normal");
  return {
    point: g.pose.position,
    normal: [n[0] / length, n[1] / length, n[2] / length] as Vec3,
  };
}

/** Signed distance-like value of X relative to g's plane (> 0: front side). */
export function side(g: SurfaceGeometry, x: Vec3) {
  const { point, normal } = planeOf(g);
  return dot(normal, sub(x, point));
}

/** Sutherland?밐odgman against one half-space f(p) >= 0. */
export function clipHalf<T extends readonly number[]>(
  poly: readonly T[],
  f: (p: T) => number,
): T[] {
  const out: T[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push(p.map((x, k) => x + t * (q[k]! - x)) as unknown as T);
    }
  }
  return out;
}

const rectOf = (g: SurfaceGeometry): Polygon => {
  const { width: W, height: H } = g.resolution;
  return [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ];
};

const area = (q: Polygon) =>
  q.reduce((s, [x1, y1], i) => {
    const [x2, y2] = q[(i + 1) % q.length]!;
    return s + x1 * y2 - x2 * y1;
  }, 0) / 2;

/**
 * The part of `target` hidden by `occluder`, seen from `eye`, as a convex
 * polygon in target CSS pixels (clipped to the target rectangle), or null.
 */
export function hiddenRegion(
  target: SurfaceGeometry,
  occluder: SurfaceGeometry,
  eye: Vec3,
  tie = false,
): Polygon | null {
  validateGeometry(target);
  validateGeometry(occluder);
  validateVec(eye);
  const eyeSide = Math.sign(side(target, eye));
  if (eyeSide <= 0 || side(occluder, eye) <= 0) return null;
  // The occluder's part on the eye's side of the target plane.
  const front = tie
    ? corners(occluder)
    : clipHalf(corners(occluder), (x) => eyeSide * side(target, x));
  if (front.length < 3) return null;
  const local: Point[] = [];
  for (const x of front) {
    const hit = intersectSurface(target, {
      origin: eye,
      direction: sub(x, eye),
    });
    // X is between the eye and the plane, so the ray reaches the plane at
    // t >= 1. A vertex exactly on the plane (t = 1) is the shared edge.
    if (!hit)
      throw new RangeError(
        "Occluder crosses the eye plane or projection is numerically unstable",
      );
    const snap = (value: number, extent: number) => {
      const tolerance = 64 * Number.EPSILON * Math.max(1, extent);
      return Math.abs(value) <= tolerance
        ? 0
        : Math.abs(value - extent) <= tolerance
          ? extent
          : value;
    };
    local.push([
      snap(hit.u, target.resolution.width),
      snap(hit.v, target.resolution.height),
    ]);
  }
  const { width: W, height: H } = target.resolution;
  let r: Point[] = local;
  for (const f of [
    (p: Point) => p[0],
    (p: Point) => W - p[0],
    (p: Point) => p[1],
    (p: Point) => H - p[1],
  ])
    r = clipHalf(r, f);
  return r.length >= 3 && Math.abs(area(r)) > 0 ? r : null;
}

/** Convex `subject` minus convex `hole`: disjoint convex pieces. */
export function subtractConvex(subject: Polygon, hole: Polygon): Polygon[] {
  const s = Math.sign(area(hole)) || 1;
  const pieces: Polygon[] = [];
  let rest: Point[] = [...subject];
  for (let i = 0; i < hole.length && rest.length >= 3; i++) {
    const a = hole[i]!;
    const b = hole[(i + 1) % hole.length]!;
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const inside = (p: Point) =>
      s * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const outside = clipHalf(rest, (p) => -inside(p));
    if (outside.length >= 3 && Math.abs(area(outside)) > 0)
      pieces.push(outside);
    rest = clipHalf(rest, inside);
  }
  return pieces;
}

/** Visible pieces of `target` given hidden regions (each convex). */
export function visiblePieces(
  target: SurfaceGeometry,
  hidden: readonly Polygon[],
): Polygon[] {
  let pieces: Polygon[] = [rectOf(target)];
  for (const h of hidden) pieces = pieces.flatMap((p) => subtractConvex(p, h));
  return pieces;
}

export interface VisibilityResult {
  readonly key: string;
  /** Hidden regions (target CSS px), one per occluding plane that reaches it. */
  readonly hidden: readonly { by: string; region: Polygon }[];
  /** Disjoint convex visible pieces; equals the full rect when nothing hides it. */
  readonly pieces: readonly Polygon[];
  /** `none` when nothing is hidden, else a nonzero `path()` clip. */
  readonly clipPath: string;
  /** Total clip vertices (complexity metric). */
  readonly vertices: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A nonzero `path()` clip from same-orientation loops. */
export function pathClip(loops: readonly Polygon[]): string {
  const d = loops
    .map((loop) => {
      const q = area(loop) < 0 ? [...loop].reverse() : loop;
      return `M${q.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(" L")} Z`;
    })
    .join(" ");
  return `path(nonzero, "${d}")`;
}

/**
 * Visibility of `target` among `planes` from `eye`, plus extra `keep`
 * regions (in target CSS px) that must stay unclipped, e.g. the footprint
 * of a descendant Native element that protrudes from the page.
 */
export function resolveVisibility(
  target: DepthPlane,
  planes: readonly DepthPlane[],
  eye: Vec3,
  keep: readonly Polygon[] = [],
): VisibilityResult {
  validatePlanes(planes);
  validateGeometry(target.geometry);
  validateVec(eye);
  if (!target.key) throw new TypeError("Plane key must be non-empty");
  const same = planes.find((p) => p.key === target.key);
  if (same && same !== target)
    throw new TypeError("Target key must identify the supplied target object");
  if (side(target.geometry, eye) <= 0)
    return {
      key: target.key,
      hidden: [],
      pieces: [],
      clipPath: `path(nonzero, "M0 0 Z")`,
      vertices: 0,
    };
  const hidden: { by: string; region: Polygon }[] = [];
  for (const other of [...planes].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  )) {
    if (other.key === target.key) continue;
    const tied = coplanar(target.geometry, other.geometry);
    if (tied && other.key > target.key) continue;
    const region = hiddenRegion(target.geometry, other.geometry, eye, tied);
    if (region) hidden.push({ by: other.key, region });
  }
  if (hidden.length === 0 && keep.length === 0)
    return {
      key: target.key,
      hidden,
      pieces: [rectOf(target.geometry)],
      clipPath: "none",
      vertices: 0,
    };
  const pieces = visiblePieces(
    target.geometry,
    hidden.map((h) => h.region),
  );
  const loops = [...pieces, ...keep];
  return {
    key: target.key,
    hidden,
    pieces,
    clipPath: loops.length === 0 ? `path(nonzero, "M0 0 Z")` : pathClip(loops),
    vertices: loops.reduce((n, l) => n + l.length, 0),
  };
}

export interface DepthHit {
  readonly key: string;
  readonly u: number;
  readonly v: number;
  readonly distance: number;
}

/**
 * Geometric depth owner of a ray: the nearest plane whose front face the
 * ray hits inside its rectangle. `null`: nothing (the scene background).
 */
export function depthOwner(
  planes: readonly DepthPlane[],
  ray: { origin: Vec3; direction: Vec3 },
): DepthHit | null {
  validatePlanes(planes);
  validateVec(ray.origin);
  validateVec(ray.direction);
  if (Math.hypot(...ray.direction) === 0)
    throw new RangeError("Ray direction must be nonzero");
  let best: DepthHit | null = null;
  let bestGeometry: SurfaceGeometry | null = null;
  for (const p of [...planes].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  )) {
    const hit = intersectSurface(p.geometry, ray);
    if (!hit?.inside || !hit.front) continue;
    if (
      !best ||
      (bestGeometry &&
        !coplanar(p.geometry, bestGeometry) &&
        hit.distance < best.distance)
    ) {
      best = { key: p.key, u: hit.u, v: hit.v, distance: hit.distance };
      bestGeometry = p.geometry;
    }
  }
  return best;
}

/**
 * Screen-space distance (in target CSS px) from (u, v) to the nearest
 * boundary of target's hidden regions: probes closer than a few pixels to
 * an ownership change are "boundary" probes, reported separately.
 */
export function boundaryDistance(
  result: VisibilityResult,
  u: number,
  v: number,
): number {
  let best = Infinity;
  for (const { region } of result.hidden)
    for (let i = 0; i < region.length; i++) {
      const a = region[i]!;
      const b = region[(i + 1) % region.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(
        0,
        Math.min(1, ((u - a[0]) * dx + (v - a[1]) * dy) / l2),
      );
      best = Math.min(best, Math.hypot(u - a[0] - t * dx, v - a[1] - t * dy));
    }
  return best;
}

function validateVec(v: Vec3): void {
  if (v.length !== 3 || !v.every(Number.isFinite))
    throw new RangeError("Expected finite 3D vector");
}
function validateGeometry(g: SurfaceGeometry): void {
  const { width, height } = g.resolution;
  const { position, rotation, scale } = g.pose;
  validateVec(position);
  if (
    ![width, height, g.metersPerPixel, scale, ...rotation].every(
      Number.isFinite,
    ) ||
    width <= 0 ||
    height <= 0 ||
    g.metersPerPixel <= 0 ||
    scale <= 0 ||
    rotation.length !== 4 ||
    Math.abs(Math.hypot(...rotation) - 1) > 1e-9
  )
    throw new RangeError("Invalid surface geometry");
}
function validatePlanes(planes: readonly DepthPlane[]): void {
  const keys = new Set<string>();
  for (const p of planes) {
    if (!p.key || keys.has(p.key))
      throw new TypeError("Plane keys must be non-empty and unique");
    keys.add(p.key);
    validateGeometry(p.geometry);
  }
}
