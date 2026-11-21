import { describe, expect, it } from "vitest";
import {
  depthOwner,
  resolveVisibility,
  type DepthPlane,
} from "../../../../apps/xr-lab/src/research/unified-depth/depthResolver.js";

const plane = (key: string, z: number, back = false): DepthPlane => ({
  key,
  geometry: {
    resolution: { width: 100, height: 100 },
    metersPerPixel: 0.01,
    pose: {
      position: [0, 0, z],
      rotation: back ? [0, 1, 0, 0] : [0, 0, 0, 1],
      scale: 1,
    },
  },
});
const eye = [0, 0, 0] as const;
const ray = { origin: eye, direction: [0, 0, -1] as const };

describe("research ownership counterexamples", () => {
  it.fails(
    "back-facing foreground must not hide a front-facing background",
    () => {
      const planes = [plane("front", -2), plane("back", -1, true)];
      expect(depthOwner(planes, ray)?.key).toBe("front");
      expect(resolveVisibility(planes[0]!, planes, eye).hidden).toHaveLength(0);
    },
  );
  it.fails("coplanar planes have one owner", () => {
    const planes = [plane("a", -1), plane("b", -1)];
    expect(depthOwner(planes, ray)?.key).toBe("a");
    expect(
      resolveVisibility(planes[0]!, planes, eye).pieces.length,
    ).toBeGreaterThan(0);
    expect(resolveVisibility(planes[1]!, planes, eye).pieces).toHaveLength(0);
  });
  it("very close depths retain the nearer owner", () => {
    const planes = [plane("near", -1), plane("far", -1 - 1e-10)];
    expect(depthOwner(planes, ray)?.key).toBe("near");
    expect(
      resolveVisibility(planes[0]!, planes, eye).pieces.length,
    ).toBeGreaterThan(0);
    expect(resolveVisibility(planes[1]!, planes, eye).pieces).toHaveLength(0);
  });
  it("a surface very close to the eye remains the owner", () => {
    const planes = [plane("near", -1e-10), plane("far", -1)];
    expect(depthOwner(planes, ray)?.key).toBe("near");
    expect(
      resolveVisibility(planes[0]!, planes, eye).pieces.length,
    ).toBeGreaterThan(0);
    expect(resolveVisibility(planes[1]!, planes, eye).pieces).toHaveLength(0);
  });
});
