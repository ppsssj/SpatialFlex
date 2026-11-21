import type { SurfaceGeometry } from "@spatialflex/core/workspace";

/**
 * P1-08B3 fixture layouts (world meters; the XR Lab's desktop camera looks
 * from [0, 1.5, 1] at [0, 1.4, -1.2]). Pages are 400 × 300 CSS px at
 * 2.5 mm per pixel: 1.0 m × 0.75 m.
 */
export type SurfaceId = "A" | "B" | "C" | "D" | "E";
export type LayoutId = "side" | "cross" | "ambiguous";

export interface Placement {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
}

export const RESOLUTION = { width: 400, height: 300 } as const;
export const METERS_PER_PIXEL = 0.0025;

export const LAYOUTS: Readonly<
  Record<LayoutId, Readonly<Record<"A" | "B", Placement>>>
> = {
  // Scenario 1: two independent dashboards, not intersecting.
  side: {
    A: { position: [-0.58, 1.4, -0.9], yaw: 0.3 },
    B: { position: [0.58, 1.4, -0.9], yaw: -0.3 },
  },
  // Scenario 3: an X crossing about the vertical line x = 0, z = -0.7. A is
  // lifted and B lowered, so "only A" and "only B" regions exist. Left of
  // the line A's page is nearer the camera, right of it B's.
  cross: {
    A: { position: [0, 1.5, -0.7], yaw: 0.6 },
    B: { position: [0, 1.3, -0.7], yaw: -0.6 },
  },
  // Scenario 5: A lies 1e-14 m in front of B's plane, both facing the
  // camera: numerically ambiguous depth (the resolver refuses it).
  ambiguous: {
    A: { position: [0.05, 1.4, -0.7 + 1e-14], yaw: 0 },
    B: { position: [0, 1.4, -0.7], yaw: 0 },
  },
};

/** Extra Surfaces of the 3- and 5-Surface measurements (behind A and B). */
export const EXTRA: Readonly<Record<"C" | "D" | "E", Placement>> = {
  C: { position: [0, 2.05, -1.8], yaw: 0 },
  D: { position: [-1.15, 1.0, -1.7], yaw: 0.4 },
  E: { position: [1.15, 1.0, -1.7], yaw: -0.4 },
};

export function geometryOf(p: Placement): SurfaceGeometry {
  return {
    resolution: RESOLUTION,
    metersPerPixel: METERS_PER_PIXEL,
    pose: {
      position: p.position,
      rotation: [0, Math.sin(p.yaw / 2), 0, Math.cos(p.yaw / 2)],
      scale: 1,
    },
  };
}

/** Where each Surface's Adaptive panel starts: in front of its page. */
export function panelPlacement(p: Placement) {
  return {
    position: [
      p.position[0],
      p.position[1] - 0.1,
      p.position[2] + 0.35,
    ] as const,
    rotation: [0, Math.sin(p.yaw / 2), 0, Math.cos(p.yaw / 2)] as const,
  };
}
