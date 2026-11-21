import { describe, expect, it } from "vitest";
import { viewportRay } from "../../../../../packages/dom/src/projection.js";
import {
  depthOwner,
  hiddenRegion,
  pathClip,
  resolveVisibility,
  subtractConvex,
  visiblePieces,
  type Polygon,
} from "./depthResolver.js";
import {
  EYE,
  SCENARIOS,
  SURFACE_RES,
  cameraFrame,
  geometryOf,
  modelMatrix,
  planesOf,
} from "./scene.js";
import { cssToWorld } from "../../../../../packages/core/src/workspace/index.js";

const area = (q: Polygon) =>
  Math.abs(
    q.reduce((s, [x1, y1], i) => {
      const [x2, y2] = q[(i + 1) % q.length]!;
      return s + x1 * y2 - x2 * y1;
    }, 0) / 2,
  );
const inConvex = (q: Polygon, [x, y]: readonly [number, number]) => {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const [ax, ay] = q[i]!;
    const [bx, by] = q[(i + 1) % q.length]!;
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
};

describe("P1-08A2 depth resolver (research)", () => {
  it("model matrix equals the P1-08A coordinate contract", () => {
    const g = geometryOf(SCENARIOS.S3.A, SURFACE_RES);
    const m = modelMatrix(g);
    for (const [u, v] of [
      [0, 0],
      [400, 300],
      [123, 45],
    ] as const) {
      const w = [0, 1, 2].map((i) => m[i]! * u + m[4 + i]! * v + m[12 + i]!);
      cssToWorld(g, u, v).forEach((c, i) => expect(w[i]).toBeCloseTo(c, 12));
    }
  });

  it("parallel planes: the nearer one hides the farther one by its full overlap", () => {
    const far = geometryOf({ position: [0, 1.4, -2], yaw: 0 }, SURFACE_RES);
    const near = geometryOf({ position: [0.2, 1.4, -1], yaw: 0 }, SURFACE_RES);
    expect(hiddenRegion(near, far, EYE)).toBeNull();
    const h = hiddenRegion(far, near, EYE)!;
    expect(h).not.toBeNull();
    expect(area(h)).toBeGreaterThan(0);
  });

  it("crossing planes are split along the intersection line, both ways", () => {
    const [A, B] = planesOf(SCENARIOS.S3);
    const hA = hiddenRegion(A!.geometry, B!.geometry, EYE)!;
    const hB = hiddenRegion(B!.geometry, A!.geometry, EYE)!;
    // Each hides part of the other: no single z-order can express this.
    expect(area(hA)).toBeGreaterThan(1000);
    expect(area(hB)).toBeGreaterThan(1000);
    // The planes cross on the vertical line x = 0 (u = 200 on both pages).
    for (const [u] of hA) expect(u).toBeGreaterThanOrEqual(200 - 1e-6);
    for (const [u] of hB) expect(u).toBeLessThanOrEqual(200 + 1e-6);
  });

  it("visible pieces agree with the ray-cast depth owner", () => {
    for (const id of ["S2", "S3", "S5-cross", "S6"] as const) {
      const planes = planesOf(SCENARIOS[id]);
      const frame = cameraFrame();
      const vis = new Map(
        planes.map((p) => [p.key, resolveVisibility(p, planes, frame.eye)]),
      );
      let checked = 0;
      for (let y = 15; y < 700; y += 29)
        for (let x = 15; x < 1000; x += 31) {
          const ray = viewportRay(frame, x, y)!;
          const owner = depthOwner(planes, ray);
          for (const p of planes) {
            const hit = depthOwner([p], ray);
            if (!hit) continue;
            const inside = vis
              .get(p.key)!
              .pieces.some((q) => inConvex(q, [hit.u, hit.v]));
            // Skip points within half a pixel of a piece edge.
            const nearEdge = vis.get(p.key)!.pieces.some((q) =>
              q.some((a, i) => {
                const b = q[(i + 1) % q.length]!;
                const dx = b[0] - a[0],
                  dy = b[1] - a[1];
                const t = Math.max(
                  0,
                  Math.min(
                    1,
                    ((hit.u - a[0]) * dx + (hit.v - a[1]) * dy) /
                      (dx * dx + dy * dy || 1),
                  ),
                );
                return (
                  Math.hypot(hit.u - a[0] - t * dx, hit.v - a[1] - t * dy) < 0.5
                );
              }),
            );
            if (nearEdge) continue;
            expect(inside, `${id} ${p.key} at ${x},${y}`).toBe(
              owner?.key === p.key,
            );
            checked++;
          }
        }
      expect(checked).toBeGreaterThan(50);
    }
  });

  it("overlapping holes stay hidden (no even-odd toggling)", () => {
    const rect: Polygon = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const h1: Polygon = [
      [10, 10],
      [60, 10],
      [60, 60],
      [10, 60],
    ];
    const h2: Polygon = [
      [40, 40],
      [90, 40],
      [90, 90],
      [40, 90],
    ];
    let pieces: Polygon[] = [rect];
    for (const h of [h1, h2])
      pieces = pieces.flatMap((p) => subtractConvex(p, h));
    const total = pieces.reduce((s, p) => s + area(p), 0);
    // 10000 - (2500 + 2500 - 400 overlap)
    expect(total).toBeCloseTo(10000 - 4600, 6);
    // The doubly covered square [40,60]² is hidden.
    expect(pieces.some((p) => inConvex(p, [50, 50]))).toBe(false);
    expect(pathClip(pieces)).toMatch(/^path\(nonzero, "M/);
  });

  it("no occluder: the clip is none and the whole page is one piece", () => {
    const g = geometryOf({ position: [0, 1.4, -1.5], yaw: 0 }, SURFACE_RES);
    const v = resolveVisibility(
      { key: "A", geometry: g },
      [{ key: "A", geometry: g }],
      EYE,
    );
    expect(v.clipPath).toBe("none");
    expect(visiblePieces(g, [])).toHaveLength(1);
  });
});
