/**
 * P1-08A2 research: the intended owner of a screen point, from geometry
 * alone (P1-08A `intersectSurface` + nearest-front-hit rule), mapped to the
 * DOM element that should receive the event. This is the oracle the
 * browser's painted pixels, `elementFromPoint` and real click targets are
 * compared against.
 *
 * Interaction policy under test (P1-08A2 §9):
 * - The frontmost plane owns the point, interactive or not.
 * - A Surface's empty background is a blocking, non-actionable target: it
 *   receives the event (target = the Surface host) but no control runs, and
 *   nothing behind it receives the event. No pass-through.
 * - The Adaptive panel is renderer-drawn: its target is the renderer canvas,
 *   and its action is dispatched by the geometric router.
 */
import { viewportRay } from "../../../../../packages/dom/src/projection.js";
import { depthOwner, type DepthPlane } from "./depthResolver.js";
import { cameraFrame } from "./scene.js";

export interface Expected {
  /** Owning plane key (`A`, `B`, `A/native`, `panel`) or `none`. */
  readonly owner: string;
  /** Expected DOM target id (`surface-A`, `A-left`, ..., or the canvas id). */
  readonly target: string;
  readonly u: number;
  readonly v: number;
  readonly distance: number;
}

const inRect = (
  u: number,
  v: number,
  x: number,
  y: number,
  w: number,
  h: number,
) => u >= x && u <= x + w && v >= y && v <= y + h;

/** Control under (u, v) of a Surface page (see SurfaceApp layout). */
export function surfaceControl(
  id: string,
  u: number,
  v: number,
  nativeInSlot: boolean,
): string {
  if (inRect(u, v, 0, 50, 195, 90)) return `${id}-left`;
  if (inRect(u, v, 205, 50, 195, 90)) return `${id}-right`;
  if (inRect(u, v, 10, 150, 380, 40)) return `${id}-input`;
  if (id === "A" && nativeInSlot && inRect(u, v, 250, 205, 140, 90))
    return inRect(u, v, 260, 215, 120, 70) ? "A-native-btn" : "A-native";
  return `surface-${id}`;
}

export function nativeControl(u: number, v: number): string {
  return inRect(u, v, 10, 10, 120, 70) ? "A-native-btn" : "A-native";
}

export function expectedAt(
  planes: readonly DepthPlane[],
  x: number,
  y: number,
  canvasId: string,
  nativeInSlot: boolean,
): Expected {
  const ray = viewportRay(cameraFrame(), x, y);
  const hit = ray ? depthOwner(planes, ray) : null;
  if (!hit)
    return {
      owner: "none",
      target: canvasId,
      u: NaN,
      v: NaN,
      distance: Infinity,
    };
  const target =
    hit.key === "A" || hit.key === "B"
      ? surfaceControl(hit.key, hit.u, hit.v, nativeInSlot)
      : hit.key === "A/native"
        ? nativeControl(hit.u, hit.v)
        : canvasId;
  return { owner: hit.key, target, u: hit.u, v: hit.v, distance: hit.distance };
}

/**
 * Minimum distance (screen px) from (x, y) to a change of expected target,
 * sampled on a ring: probes nearer than the margin to an ownership or
 * control boundary are classified as "boundary" probes.
 */
export function targetMargin(
  planes: readonly DepthPlane[],
  x: number,
  y: number,
  canvasId: string,
  nativeInSlot: boolean,
  radius: number,
): boolean {
  const here = expectedAt(planes, x, y, canvasId, nativeInSlot).target;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    for (const r of [radius / 2, radius])
      if (
        expectedAt(
          planes,
          x + Math.cos(a) * r,
          y + Math.sin(a) * r,
          canvasId,
          nativeInSlot,
        ).target !== here
      )
        return false;
  }
  return true;
}
