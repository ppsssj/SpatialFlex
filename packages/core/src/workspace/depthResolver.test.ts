import { describe, expect, it } from "vitest";
import { cssToWorld } from "./coordinates.js";
import {
  depthOwner,
  resolveVisibility,
  type DepthPlane,
} from "./depthResolver.js";

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

describe("SDK ownership counterexamples", () => {
  it("back-facing foreground must not hide a front-facing background", () => {
    const planes = [plane("front", -2), plane("back", -1, true)];
    expect(depthOwner(planes, ray)?.key).toBe("front");
    expect(resolveVisibility(planes[0]!, planes, eye).hidden).toHaveLength(0);
  });
  it("coplanar planes have one owner", () => {
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

it("is invariant to input order for coplanar planes", () => {
  const planes = [plane("z", -1), plane("a", -1), plane("b", -2)];
  for (const list of [planes, [...planes].reverse()]) {
    expect(depthOwner(list, ray)?.key).toBe("a");
    expect(resolveVisibility(planes[0]!, list, eye).pieces).toHaveLength(0);
    expect(
      resolveVisibility(planes[1]!, list, eye).pieces.length,
    ).toBeGreaterThan(0);
  }
});
it("rejects invalid geometry, duplicate identities and zero rays", () => {
  const a = plane("a", -1);
  expect(() => depthOwner([a, a], ray)).toThrow();
  expect(() =>
    depthOwner([a], { origin: eye, direction: [0, 0, 0] }),
  ).toThrow();
  expect(() =>
    depthOwner([{ ...a, geometry: { ...a.geometry, metersPerPixel: 0 } }], ray),
  ).toThrow();
});
it("excludes a back-facing target", () => {
  const back = plane("back", -1, true);
  expect(resolveVisibility(back, [back], eye).pieces).toHaveLength(0);
});
it("overlapping occluders never restore a hidden area", () => {
  const planes = [plane("target", -3), plane("a", -1), plane("b", -2)];
  expect(depthOwner(planes, ray)?.key).toBe("a");
  expect(resolveVisibility(planes[0]!, planes, eye).pieces).toHaveLength(0);
});

it("small real occlusions retain ray/visibility agreement", () => {
  const target = plane("target", -2);
  const base = plane("near", -1);
  const near = {
    ...base,
    geometry: {
      ...base.geometry,
      resolution: { width: 0.0001, height: 0.0001 },
    },
  };
  const planes = [target, near];
  expect(depthOwner(planes, ray)?.key).toBe("near");
  expect(resolveVisibility(target, planes, eye).hidden).toHaveLength(1);
});

it("agrees with independent ray probes for five partially overlapping planes", () => {
  const planes = Array.from({ length: 5 }, (_, i) => {
    const p = plane(String(i), -1 - i * 0.5);
    return {
      ...p,
      geometry: {
        ...p.geometry,
        pose: {
          ...p.geometry.pose,
          position: [i * 0.15 - 0.3, 0, -1 - i * 0.5] as const,
        },
      },
    };
  });
  const inside = (
    poly: readonly (readonly [number, number])[],
    x: number,
    y: number,
  ) => {
    const signs = poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length]!;
      return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    });
    return signs.every((v) => v >= -1e-8) || signs.every((v) => v <= 1e-8);
  };
  for (const target of planes) {
    const visible = resolveVisibility(target, planes, eye);
    for (let u = 2.37; u < 100; u += 7.11)
      for (let v = 3.23; v < 100; v += 9.07) {
        const [x, y, z] = cssToWorld(target.geometry, u, v);
        const owner = depthOwner(planes, { origin: eye, direction: [x, y, z] });
        expect(visible.pieces.some((poly) => inside(poly, u, v))).toBe(
          owner?.key === target.key,
        );
      }
  }
});

it("resolves rotated coplanar surfaces by key in either order", () => {
  const q = Math.sin(Math.PI / 8),
    w = Math.cos(Math.PI / 8);
  const first = plane("a", -2);
  const a = {
    ...first,
    geometry: {
      ...first.geometry,
      pose: { ...first.geometry.pose, rotation: [0, q, 0, w] as const },
    },
  };
  const b = {
    ...a,
    key: "z",
    geometry: {
      ...a.geometry,
      pose: { ...a.geometry.pose, rotation: [0, -q, 0, -w] as const },
    },
  };
  for (const planes of [
    [a, b],
    [b, a],
  ]) {
    expect(depthOwner(planes, ray)?.key).toBe("a");
    expect(resolveVisibility(a, planes, eye).pieces.length).toBeGreaterThan(0);
    expect(resolveVisibility(b, planes, eye).pieces).toHaveLength(0);
  }
});
it("keeps distinct parallel planes separated at 1e-10 metres", () => {
  const z = plane("z", -1);
  const a = plane("a", -1 - 1e-10);
  expect(depthOwner([a, z], ray)?.key).toBe("z");
  expect(resolveVisibility(a, [a, z], eye).pieces).toHaveLength(0);
});
