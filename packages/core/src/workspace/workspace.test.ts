// P1-08A Multi-Surface contract tests (A1–A8) for the package-internal
// workspace primitives, over real SpatialRegistry instances.
import { describe, expect, it } from "vitest";
import { yawQuaternion, type SpatialRay } from "../manipulation.js";
import { SpatialRegistry } from "../registry.js";
import {
  cssToWorld,
  decodeItemRef,
  encodeItemRef,
  FrameAuthority,
  InputRouter,
  intersectSurface,
  orderHits,
  resolveOwner,
  sameItem,
  SurfaceTable,
  worldToCss,
  type InputHit,
  type InputOwner,
  type SurfaceGeometry,
} from "./index.js";

const geometry = (
  z: number,
  x = 0,
  overrides: Partial<SurfaceGeometry> = {},
): SurfaceGeometry => ({
  resolution: { width: 800, height: 600 },
  metersPerPixel: 0.002,
  pose: { position: [x, 1.4, z], rotation: [0, 0, 0, 1], scale: 1 },
  ...overrides,
});

function workspace() {
  const surfaces = new SurfaceTable();
  const authority = new FrameAuthority<{ camera: string }>();
  const router = new InputRouter({
    isLive: (owner) =>
      owner.kind === "surface"
        ? surfaces.isLive(owner.surface)
        : surfaces.isCurrent(owner.item),
    isAuthoritative: (host) => authority.isAuthoritative(host),
  });
  return { surfaces, authority, router };
}

describe("A1 duplicate item ids across surfaces", () => {
  it("two surfaces register the same item id without collision", () => {
    const { surfaces } = workspace();
    const registryA = new SpatialRegistry();
    const registryB = new SpatialRegistry();
    const a = surfaces.add("A", geometry(-1.6), registryA);
    const b = surfaces.add("B", geometry(-1.0), registryB);
    registryA.register({ id: "chart" });
    registryB.register({ id: "chart" });
    const chartA = surfaces.itemRef(a, "chart")!;
    const chartB = surfaces.itemRef(b, "chart")!;
    expect(chartA.registrationKey).not.toBe(chartB.registrationKey);
    expect(sameItem(chartA, chartB)).toBe(false);
    expect(encodeItemRef(chartA)).not.toBe(encodeItemRef(chartB));
    expect(surfaces.isCurrent(chartA)).toBe(true);
    expect(surfaces.isCurrent(chartB)).toBe(true);
    // A's reference never designates B's item, even with B's key spliced in.
    expect(
      surfaces.isCurrent({
        ...chartA,
        registrationKey: chartB.registrationKey,
      }),
    ).toBe(false);
  });

  it("the transport form is a versioned tuple: no separator ambiguity", () => {
    const tricky = {
      surface: { surfaceId: 'a:"b', epoch: 3 },
      itemId: "c/d:e",
      registrationKey: "1/2",
    };
    const text = encodeItemRef(tricky);
    expect(decodeItemRef(text)).toEqual(tricky);
    // Concatenation-equal parts stay distinct.
    const other = {
      surface: { surfaceId: "a", epoch: 3 },
      itemId: ':"bc/d:e',
      registrationKey: "1/2",
    };
    expect(encodeItemRef(other)).not.toBe(text);
    for (const bad of [
      "",
      "{}",
      '["sf-item/2","a",1,"b","k"]',
      '["sf-item/1","",1,"b","k"]',
      '["sf-item/1","a",0,"b","k"]',
      '["sf-item/1","a",1.5,"b","k"]',
      '["sf-item/1","a",1,"","k"]',
      '["sf-item/1","a",1,"b",""]',
    ])
      expect(decodeItemRef(bad)).toBeNull();
  });
});

describe("A2 registration replacement", () => {
  it("an action addressed to a replaced registration is rejected", () => {
    const { surfaces } = workspace();
    const registry = new SpatialRegistry();
    const b = surfaces.add("B", geometry(-1), registry);
    const first = registry.register({ id: "chart" });
    const old = surfaces.itemRef(b, "chart")!;
    first.unregister();
    expect(surfaces.isCurrent(old)).toBe(false);
    registry.register({ id: "chart" }); // remount, same id
    const fresh = surfaces.itemRef(b, "chart")!;
    expect(surfaces.isCurrent(old)).toBe(false);
    expect(surfaces.isCurrent(fresh)).toBe(true);
  });

  it("a surface removed and added again with the same id is a new incarnation", () => {
    const { surfaces } = workspace();
    const registry = new SpatialRegistry();
    registry.register({ id: "chart" });
    const first = surfaces.add("A", geometry(-1), registry);
    const old = surfaces.itemRef(first, "chart")!;
    expect(surfaces.remove(first)).toBe(true);
    const second = surfaces.add("A", geometry(-1), registry);
    expect(second.epoch).not.toBe(first.epoch);
    // Same registry, same registration, but the old surface incarnation.
    expect(surfaces.isCurrent(old)).toBe(false);
    expect(surfaces.remove(first)).toBe(false);
    expect(surfaces.isLive(second)).toBe(true);
  });
});

describe("A3 surface lifecycle", () => {
  it("removing one surface leaves the others and their items", () => {
    const { surfaces } = workspace();
    const registryA = new SpatialRegistry();
    const registryB = new SpatialRegistry();
    registryA.register({ id: "chart" });
    registryB.register({ id: "chart" });
    const a = surfaces.add("A", geometry(-1.6), registryA);
    const b = surfaces.add("B", geometry(-1), registryB);
    const events: string[] = [];
    surfaces.subscribe((e) => events.push(`${e.type}:${e.ref.surfaceId}`));
    expect(surfaces.remove(a)).toBe(true);
    expect(events).toEqual(["removed:A"]);
    expect(surfaces.list().map((r) => r.ref)).toEqual([b]);
    expect(surfaces.isCurrent(surfaces.itemRef(b, "chart")!)).toBe(true);
    expect(() => surfaces.add("B", geometry(0), registryA)).toThrow(
      /already live/,
    );
  });
});

describe("A4 coordinate conversion", () => {
  const poses: SurfaceGeometry[] = [
    geometry(-1.2),
    geometry(-2, 0.7, {
      pose: {
        position: [0.7, 1.1, -2],
        rotation: yawQuaternion(0.6),
        scale: 1.7,
      },
    }),
    geometry(-1, -0.3, {
      resolution: { width: 1280, height: 720 },
      metersPerPixel: 0.0011,
      pose: {
        position: [-0.3, 2, -1],
        // An arbitrary unit rotation (not yaw-only).
        rotation: (() => {
          const q = [0.2, -0.4, 0.1, 0.9];
          const n = Math.hypot(...q);
          return q.map((c) => c / n) as [number, number, number, number];
        })(),
        scale: 0.8,
      },
    }),
  ];

  it("CSS → world → CSS round-trips within 1e-9 px", () => {
    for (const g of poses)
      for (const [u, v] of [
        [0, 0],
        [g.resolution.width, g.resolution.height],
        [123.25, 456.5],
      ]) {
        const back = worldToCss(g, cssToWorld(g, u!, v!));
        expect(Math.abs(back.u - u!)).toBeLessThan(1e-9);
        expect(Math.abs(back.v - v!)).toBeLessThan(1e-9);
        expect(Math.abs(back.z)).toBeLessThan(1e-12);
      }
  });

  it("the page center is the pose position; size follows scale", () => {
    const g = poses[1]!;
    const c = cssToWorld(g, g.resolution.width / 2, g.resolution.height / 2);
    c.forEach((x, i) => expect(x).toBeCloseTo(g.pose.position[i]!, 12));
    // Top-left is up (+y) and left of the center for an unrotated page.
    const tl = cssToWorld(poses[0]!, 0, 0);
    expect(tl[0]).toBeCloseTo(-0.8, 12);
    expect(tl[1]).toBeCloseTo(1.4 + 0.6, 12);
  });

  it("a ray through a page point intersects it there", () => {
    const g = poses[2]!;
    const target = cssToWorld(g, 300, 200);
    const origin = [0, 1.6, 3] as const;
    const ray: SpatialRay = {
      origin,
      direction: [
        target[0] - origin[0],
        target[1] - origin[1],
        target[2] - origin[2],
      ],
    };
    const hit = intersectSurface(g, ray)!;
    expect(hit.u).toBeCloseTo(300, 6);
    expect(hit.v).toBeCloseTo(200, 6);
    expect(hit.inside).toBe(true);
    expect(hit.t).toBeCloseTo(1, 9);
  });
});

describe("A5 one owner per gesture", () => {
  const owner = (surfaceId: string, epoch: number): InputOwner => ({
    kind: "surface",
    surface: { surfaceId, epoch },
  });

  it("the nearest hit owns the gesture, independent of input order", () => {
    const near: InputHit = {
      owner: owner("B", 2),
      distance: 2,
      interactive: true,
    };
    const far: InputHit = {
      owner: owner("A", 1),
      distance: 3,
      interactive: true,
    };
    expect(resolveOwner([far, near])).toEqual(near.owner);
    expect(resolveOwner([near, far])).toEqual(near.owner);
  });

  it("a nearer non-interactive hit blocks instead of leaking behind it", () => {
    const blocker: InputHit = {
      owner: owner("B", 2),
      distance: 2,
      interactive: false,
    };
    const behind: InputHit = {
      owner: owner("A", 1),
      distance: 3,
      interactive: true,
    };
    expect(resolveOwner([behind, blocker])).toBeNull();
  });

  it("coplanar: a presentation lies above its page; ties are stable", () => {
    const page: InputHit = {
      owner: owner("A", 1),
      distance: 2,
      interactive: true,
    };
    const panel: InputHit = {
      owner: {
        kind: "presentation",
        item: {
          surface: { surfaceId: "A", epoch: 1 },
          itemId: "chart",
          registrationKey: "k",
        },
        instanceId: "native-1",
      },
      distance: 2 + 1e-6,
      interactive: true,
    };
    expect(resolveOwner([page, panel])).toEqual(panel.owner);
    const x: InputHit = {
      owner: owner("X", 5),
      distance: 4,
      interactive: true,
    };
    const y: InputHit = {
      owner: owner("Y", 6),
      distance: 4,
      interactive: true,
    };
    expect(orderHits([y, x])).toEqual(orderHits([x, y]));
  });

  it("the captured owner keeps the gesture; keyboard goes to focus only", () => {
    const { surfaces, authority, router } = workspace();
    const a = surfaces.add("A", geometry(-2), new SpatialRegistry());
    const b = surfaces.add("B", geometry(-1), new SpatialRegistry());
    const host = authority.connect("three");
    authority.submit(host, 1, { camera: "c1" });
    const down = router.down(host, 7, [
      {
        owner: { kind: "surface", surface: b },
        distance: 1,
        interactive: true,
      },
      {
        owner: { kind: "surface", surface: a },
        distance: 2,
        interactive: true,
      },
    ])!;
    expect(down.owner).toEqual({ kind: "surface", surface: b });
    // Moves go to the captured owner whatever is under the pointer now.
    expect(router.move(host, 7)?.gesture).toBe(down.gesture);
    expect(router.up(host, 7)?.gesture).toBe(down.gesture);
    expect(router.move(host, 7)).toBeNull();
    expect(router.keyboardOwner()).toBeNull();
    router.focus({ kind: "surface", surface: a });
    expect(router.keyboardOwner()).toEqual({ kind: "surface", surface: a });
  });
});

describe("A6 stale input after surface removal", () => {
  it("removing a surface mid-gesture rejects the rest of that gesture", () => {
    const { surfaces, authority, router } = workspace();
    const registry = new SpatialRegistry();
    registry.register({ id: "chart" });
    const a = surfaces.add("A", geometry(-1), registry);
    const b = surfaces.add("B", geometry(-1.5, 2), new SpatialRegistry());
    surfaces.subscribe((e) => {
      if (e.type === "removed") router.surfaceRemoved(e.ref);
    });
    const host = authority.connect("three");
    authority.submit(host, 1, { camera: "c1" });
    const item = surfaces.itemRef(a, "chart")!;
    router.down(host, 1, [
      {
        owner: { kind: "presentation", item, instanceId: "native-1" },
        distance: 1,
        interactive: true,
      },
    ]);
    router.down(host, 2, [
      {
        owner: { kind: "surface", surface: b },
        distance: 1.5,
        interactive: true,
      },
    ]);
    router.focus({ kind: "surface", surface: a });
    surfaces.remove(a);
    expect(router.move(host, 1)).toBeNull();
    expect(router.up(host, 1)).toBeNull();
    expect(router.keyboardOwner()).toBeNull();
    // The other surface's gesture is untouched.
    expect(router.move(host, 2)?.owner).toEqual({
      kind: "surface",
      surface: b,
    });
    // A re-added "A" does not inherit the old gesture or focus.
    const again = surfaces.add("A", geometry(-1), registry);
    expect(router.move(host, 1)).toBeNull();
    expect(
      router.down(host, 3, [
        {
          owner: { kind: "presentation", item, instanceId: "native-1" },
          distance: 1,
          interactive: true,
        },
      ]),
    ).toBeNull(); // the old item ref names the removed incarnation
    expect(surfaces.isLive(again)).toBe(true);
  });

  it("an unregistered item's pending gesture ends", () => {
    const { surfaces, authority, router } = workspace();
    const registry = new SpatialRegistry();
    const reg = registry.register({ id: "chart" });
    const a = surfaces.add("A", geometry(-1), registry);
    const host = authority.connect("three");
    authority.submit(host, 1, { camera: "c1" });
    const item = surfaces.itemRef(a, "chart")!;
    router.down(host, 1, [
      {
        owner: { kind: "presentation", item, instanceId: "adaptive-1" },
        distance: 1,
        interactive: true,
      },
    ]);
    reg.unregister();
    registry.register({ id: "chart" });
    expect(router.move(host, 1)).toBeNull();
    expect(router.captures).toEqual([]);
  });
});

describe("A7 host handover", () => {
  it("only the authoritative, connected host supplies frames and input", () => {
    const { surfaces, authority, router } = workspace();
    const a = surfaces.add("A", geometry(-1), new SpatialRegistry());
    const hit = [
      {
        owner: { kind: "surface" as const, surface: a },
        distance: 1,
        interactive: true,
      },
    ];
    const three = authority.connect("three");
    const babylon = authority.connect("babylon");
    // Compatibility rule: the first host to submit becomes authoritative.
    expect(authority.submit(three, 1, { camera: "t1" })).toBe("accepted");
    expect(authority.submit(babylon, 1, { camera: "b1" })).toBe(
      "not-authoritative",
    );
    expect(authority.submit(three, 1, { camera: "t1-again" })).toBe("stale");
    expect(authority.current()).toEqual({ camera: "t1" });
    expect(router.down(babylon, 1, hit)).toBeNull();
    const gesture = router.down(three, 1, hit)!;
    expect(gesture).not.toBeNull();

    // Explicit handover: the old frame is never inherited.
    expect(authority.authorize(babylon)).toBe(true);
    expect(authority.current()).toBeNull();
    router.hostEnded(three);
    expect(router.move(three, 1)).toBeNull();
    expect(router.down(three, 2, hit)).toBeNull();
    expect(authority.submit(babylon, 1, { camera: "b1" })).toBe("accepted");
    expect(router.down(babylon, 1, hit)).not.toBeNull();

    // Disconnect clears authority and frame; a reconnect is a new lease.
    expect(authority.disconnect(babylon)).toBe(true);
    expect(authority.current()).toBeNull();
    expect(authority.submit(babylon, 2, { camera: "b2" })).toBe("disconnected");
    expect(router.move(babylon, 1)).toBeNull();
    const again = authority.connect("babylon");
    expect(again.epoch).not.toBe(babylon.epoch);
    expect(authority.isAuthoritative(babylon)).toBe(false);
    expect(authority.submit(again, 1, { camera: "b3" })).toBe("accepted");
  });
});

// A8 (renderer/framework independence) is in packages/dom/src/boundary.test.ts:
// core has no Node or DOM types, so it cannot read its own sources here,
// and its tsconfig (ES2022 libs only) already rejects DOM types at compile time.
