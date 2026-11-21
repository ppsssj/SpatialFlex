/**
 * P1-08A2 research scene: one camera, two Surfaces (A, B), A's extracted
 * Native element and one Adaptive (WebGL) panel, described renderer-neutrally
 * with the P1-08A coordinate contract. Every track (HTML-in-Canvas, DOM
 * compositor, Three.js, Babylon.js) renders the same description.
 */
import {
  cssToWorld,
  type SurfaceGeometry,
} from "../../../../../packages/core/src/workspace/index.js";
import {
  quaternionFromEuler,
  type CameraFrame,
  type SpatialWebSurfacePose,
} from "../../../../../packages/dom/src/projection.js";
import type { DepthPlane, Vec3 } from "./depthResolver.js";

export const VIEW = { width: 1000, height: 700 } as const;
export const SURFACE_RES = { width: 400, height: 300 } as const;
export const NATIVE_RES = { width: 140, height: 90 } as const;
export const PANEL_RES = { width: 160, height: 100 } as const;
export const MPP = 0.0025; // 1.0 m × 0.75 m pages
export const EYE: Vec3 = [0, 1.4, 0.3];
const TARGET: Vec3 = [0, 1.4, -1];
const FOV_Y = (50 * Math.PI) / 180;

/** Column-major 4×4 product a·b. */
export function mul4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

export function cameraFrame(
  eye: Vec3 = EYE,
  target: Vec3 = TARGET,
): CameraFrame {
  const { width: W, height: H } = VIEW;
  const f = 1 / Math.tan(FOV_Y / 2);
  const near = 0.1;
  const far = 100;
  const P = [
    f / (W / H),
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ];
  const sub = (a: Vec3, b: Vec3): Vec3 => [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
  ];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  const V = [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ];
  return {
    viewProjection: mul4(P, V),
    viewport: { left: 0, top: 0, width: W, height: H },
    eye,
  };
}

/** A placed rectangle: position (center), yaw/pitch (radians), CSS size. */
export interface Placement {
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch?: number;
}

export function geometryOf(
  p: Placement,
  resolution: { width: number; height: number },
): SurfaceGeometry {
  return {
    resolution,
    metersPerPixel: MPP,
    pose: {
      position: p.position,
      rotation: quaternionFromEuler([p.pitch ?? 0, p.yaw, 0]),
      scale: 1,
    },
  };
}

/** The DOM package's pose type (used by `surfaceTransform` and friends). */
export function poseOf(
  p: Placement,
  resolution: { width: number; height: number },
): SpatialWebSurfacePose {
  return {
    position: p.position,
    rotation: [p.pitch ?? 0, p.yaw, 0],
    width: resolution.width * MPP,
    height: resolution.height * MPP,
  };
}

/**
 * Column-major model matrix mapping element CSS (u, v, 0, 1) → world, from
 * the coordinate contract (so it equals `cssToWorld` by construction). The
 * third column is a tiny normal so the matrix stays invertible.
 */
export function modelMatrix(g: SurfaceGeometry): number[] {
  const o = cssToWorld(g, 0, 0);
  const du = cssToWorld(g, 1, 0).map((c, i) => c - o[i]!);
  const dv = cssToWorld(g, 0, 1).map((c, i) => c - o[i]!);
  const n = [
    du[1]! * dv[2]! - du[2]! * dv[1]!,
    du[2]! * dv[0]! - du[0]! * dv[2]!,
    du[0]! * dv[1]! - du[1]! * dv[0]!,
  ].map((c) => -c / MPP);
  return [...du, 0, ...dv, 0, ...n, 0, ...o, 1];
}

/** Clip space → canvas CSS pixels (keeps clip z and w). */
export function viewportMatrix(): number[] {
  const { width: W, height: H } = VIEW;
  return [W / 2, 0, 0, 0, 0, -H / 2, 0, 0, 0, 0, 1, 0, W / 2, H / 2, 0, 1];
}

export type ScenarioId =
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5-front"
  | "S5-behind"
  | "S5-cross"
  | "S6"
  | "S7"
  | "S8"
  | "S9";

export interface ScenarioLayout {
  readonly A: Placement;
  readonly B: Placement;
  /** A's extracted Native element, when extracted. */
  readonly native?: Placement;
  /** The Adaptive (renderer-drawn) panel, when present. */
  readonly panel?: Placement;
}

const Z = -1.3;
/** X-shaped crossing: both pages turn about the vertical line x = 0, z = Z;
 *  A is lifted and B lowered so "only A" and "only B" regions exist. */
const CROSS_A: Placement = { position: [0, 1.5, Z], yaw: 0.6 };
const CROSS_B: Placement = { position: [0, 1.3, Z], yaw: -0.6 };
const FAR_A: Placement = { position: [-0.25, 1.48, -1.7], yaw: 0.15 };
const NEAR_B: Placement = { position: [0.2, 1.32, -1.15], yaw: -0.1 };

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioLayout>> = {
  S1: {
    A: { position: [-0.58, 1.4, -1.5], yaw: 0.3 },
    B: { position: [0.58, 1.4, -1.5], yaw: -0.3 },
  },
  S2: { A: FAR_A, B: NEAR_B },
  S3: { A: CROSS_A, B: CROSS_B },
  S4: { A: FAR_A, B: NEAR_B },
  // A's Native element placed over B: in front of it, behind it, through it.
  "S5-front": {
    A: { position: [-0.62, 1.4, -1.6], yaw: 0.25 },
    B: { position: [0.3, 1.4, -1.3], yaw: 0 },
    native: { position: [0.25, 1.3, -0.95], yaw: 0 },
  },
  "S5-behind": {
    A: { position: [-0.62, 1.4, -1.6], yaw: 0.25 },
    B: { position: [0.3, 1.4, -1.3], yaw: 0 },
    native: { position: [0.25, 1.3, -1.6], yaw: 0 },
  },
  "S5-cross": {
    A: { position: [-0.62, 1.4, -1.6], yaw: 0.25 },
    B: { position: [0.3, 1.4, -1.3], yaw: 0 },
    native: { position: [0.3, 1.3, -1.3], yaw: 0.9 },
  },
  // Adaptive (WebGL) panel crossing B.
  S6: {
    A: { position: [-0.62, 1.4, -1.6], yaw: 0.25 },
    B: { position: [0.3, 1.4, -1.3], yaw: 0 },
    panel: { position: [0.3, 1.28, -1.3], yaw: -0.9 },
  },
  S7: { A: CROSS_A, B: CROSS_B },
  S8: { A: CROSS_A, B: CROSS_B },
  S9: { A: CROSS_A, B: CROSS_B },
};

export function planesOf(layout: ScenarioLayout): DepthPlane[] {
  const planes: DepthPlane[] = [
    { key: "A", geometry: geometryOf(layout.A, SURFACE_RES) },
    { key: "B", geometry: geometryOf(layout.B, SURFACE_RES) },
  ];
  if (layout.native)
    planes.push({
      key: "A/native",
      geometry: geometryOf(layout.native, NATIVE_RES),
    });
  if (layout.panel)
    planes.push({
      key: "panel",
      geometry: geometryOf(layout.panel, PANEL_RES),
    });
  return planes;
}

/** S8 motion: both Surfaces swing about the crossing line over time. */
export function animated(layout: ScenarioLayout, t: number): ScenarioLayout {
  const s = Math.sin(t * 1.3) * 0.25;
  return {
    ...layout,
    A: { ...layout.A, yaw: layout.A.yaw + s },
    B: { ...layout.B, yaw: layout.B.yaw - s * 0.8 },
  };
}
