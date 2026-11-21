// @vitest-environment jsdom
// P1-08B3: WorkspaceScene over a real WorkspaceCoordinator, real
// SpatialRegistry / PresentationRuntime instances and the real depth
// resolver: frame authority, one depth snapshot for screen and input,
// InputRouter gestures, fail-closed depth, per-Surface runtime hosts.
import { SpatialRegistry } from "@spatialflex/core";
import {
  IndeterminateDepthError,
  cssToWorld,
  intersectSurface,
  resolveDepthSnapshot,
  type SurfaceGeometry,
} from "@spatialflex/core/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  projectPoint,
  surfacePoint,
  type CameraFrame,
  type Vec3,
} from "../projection.js";
import type { PresentationController } from "../presentationRuntime.js";
import { WorkspaceCoordinator } from "./coordinator.js";
import { WorkspaceScene, poseOfGeometry, surfaceKey } from "./scene.js";

// --- Scene fixture (the P1-08A2 X crossing) ----------------------------------
const RES = { width: 400, height: 300 } as const;
const yawQ = (yaw: number) =>
  [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as const;
const geometryAt = (position: Vec3, yaw: number): SurfaceGeometry => ({
  resolution: RES,
  metersPerPixel: 0.0025,
  pose: { position, rotation: yawQ(yaw), scale: 1 },
});
const CROSS_A = geometryAt([0, 1.5, -1.3], 0.6);
const CROSS_B = geometryAt([0, 1.3, -1.3], -0.6);
const SIDE_A = geometryAt([-0.6, 1.4, -1.5], 0.3);
const SIDE_B = geometryAt([0.6, 1.4, -1.5], -0.3);

function camera(eye: Vec3 = [0, 1.4, 0.3], target: Vec3 = [0, 1.4, -1]) {
  const W = 1000,
    H = 700,
    f = 1 / Math.tan((50 * Math.PI) / 360),
    n = 0.1,
    far = 100;
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
    (far + n) / (n - far),
    -1,
    0,
    0,
    (2 * far * n) / (n - far),
    0,
  ];
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
  const vp = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        vp[c * 4 + r]! += P[k * 4 + r]! * V[c * 4 + k]!;
  return {
    viewProjection: vp,
    viewport: { left: 0, top: 0, width: W, height: H },
    eye,
  } satisfies CameraFrame;
}
const FRAME = camera();

/** Client point of a Surface's CSS point under FRAME. */
const at = (g: SurfaceGeometry, u: number, v: number) => {
  const p = projectPoint(FRAME, cssToWorld(g, u, v))!;
  return { x: p.x + FRAME.viewport.left, y: p.y + FRAME.viewport.top };
};

/** One Surface's source scope, with its registry listeners counted. */
function scope() {
  const registry = new SpatialRegistry();
  const controller: PresentationController = {
    extractNative: () => false,
    attach: (id) => registry.attach(id),
    placement: () => null,
    nativeElement: () => null,
    sourceElement: () => null,
    setSourceVisibility: (id, v) => registry.setSourceVisibility(id, v),
  };
  let listeners = 0;
  for (const method of ["subscribe", "subscribeViews"] as const) {
    const original = registry[method].bind(registry);
    vi.spyOn(registry, method).mockImplementation((listener: () => void) => {
      listeners++;
      const stop = original(listener);
      return () => {
        listeners--;
        stop();
      };
    });
  }
  const onAction = vi.fn();
  const mount = (id: string) => {
    const registration = registry.register({ id });
    registration.setView({
      body: { kind: "value", label: "n", value: "1" },
      actions: [{ id: "act", label: "Act", invoke: onAction }],
    });
    return registration;
  };
  return { registry, controller, mount, onAction, listeners: () => listeners };
}

let coordinator: WorkspaceCoordinator;
let scene: WorkspaceScene;
afterEach(() => {
  scene?.dispose();
  coordinator?.dispose();
  document.body.replaceChildren();
});

function setup(
  a: SurfaceGeometry = CROSS_A,
  b: SurfaceGeometry = CROSS_B,
  options: ConstructorParameters<typeof WorkspaceScene>[1] = {},
) {
  coordinator = new WorkspaceCoordinator();
  scene = new WorkspaceScene(coordinator, options);
  const A = scope();
  const B = scope();
  const sa = coordinator.addSurface("A", A, { geometry: a });
  const sb = coordinator.addSurface("B", B, { geometry: b });
  const page = (id: string) => {
    const el = document.createElement("div");
    el.dataset.page = id;
    document.body.append(el);
    return el;
  };
  const pa = page("A");
  const pb = page("B");
  scene.attachPage(sa.ref, pa);
  scene.attachPage(sb.ref, pb);
  return { A, B, sa, sb, pa, pb };
}

const surfaceTarget = (ref: { surfaceId: string; epoch: number }) =>
  ({ kind: "surface", ref }) as const;
const SCENE = { kind: "scene" } as const;

describe("P1-08B3 WorkspaceScene — geometry and frames", () => {
  it("the DOM pose of a Surface matches the core coordinate contract", () => {
    const g = geometryAt([0.3, 1.2, -1.7], 0.7);
    const pose = poseOfGeometry(g);
    for (const [u, v] of [
      [0, 0],
      [400, 0],
      [400, 300],
      [123, 45],
    ] as const) {
      const a = surfacePoint(pose, RES, u, v);
      const b = cssToWorld(g, u, v);
      for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, 12);
    }
  });

  it("composites only the authoritative, newest frame onto every live page", () => {
    const { pa, pb } = setup(SIDE_A, SIDE_B);
    const r = scene.connectRenderer("three");
    expect(pa.style.visibility).toBe("hidden"); // nothing before a frame
    expect(r.frame(1, FRAME)).toBe("accepted");
    expect(scene.getSnapshot().status).toBe("resolved");
    expect(pa.style.transform).toMatch(/^matrix3d\(/);
    expect(pb.style.transform).toMatch(/^matrix3d\(/);
    expect(pa.style.visibility).toBe("");
    expect(pa.style.clipPath).toBe("none"); // side by side: nothing hidden
    const before = pa.style.transform;
    // Stale (equal or older) sequences are rejected and change nothing.
    const moved = camera([0.4, 1.4, 0.3]);
    expect(r.frame(1, moved)).toBe("stale");
    expect(r.frame(0, moved)).toBe("stale");
    expect(pa.style.transform).toBe(before);
    expect(r.frame(2, moved)).toBe("accepted");
    expect(pa.style.transform).not.toBe(before);
  });

  it("a second renderer is not authoritative until a handover, which drops the old camera", () => {
    const { pa } = setup(SIDE_A, SIDE_B);
    const one = scene.connectRenderer("three");
    const two = scene.connectRenderer("inspector");
    one.frame(1, FRAME);
    expect(two.frame(1, camera([1, 1.4, 0.3]))).toBe("not-authoritative");
    const t = pa.style.transform;
    expect(two.authorize()).toBe(true);
    // The new authority has no frame yet: nothing is composited or routed.
    expect(scene.getSnapshot().status).toBe("waiting");
    expect(scene.getSnapshot().authority).toBe(two.lease);
    expect(pa.style.visibility).toBe("hidden");
    expect(
      scene.pointerDown(
        1,
        500,
        350,
        surfaceTarget(scene.inspect().surfaces[0]!.ref),
      ).allow,
    ).toBe(false);
    expect(one.frame(2, FRAME)).toBe("not-authoritative");
    expect(two.frame(1, camera([0.2, 1.4, 0.3]))).toBe("accepted");
    expect(pa.style.transform).not.toBe(t);
    expect(pa.style.visibility).toBe("");
  });

  it("disconnecting the authority revokes it; the next renderer takes over", () => {
    const { pa } = setup(SIDE_A, SIDE_B);
    const one = scene.connectRenderer("three");
    one.frame(1, FRAME);
    one.disconnect();
    expect(scene.getSnapshot()).toMatchObject({
      status: "waiting",
      authority: null,
    });
    expect(pa.style.visibility).toBe("hidden");
    expect(one.frame(2, FRAME)).toBe("disconnected");
    const two = scene.connectRenderer("three");
    expect(two.lease.epoch).toBeGreaterThan(one.lease.epoch);
    expect(two.frame(1, FRAME)).toBe("accepted");
    expect(scene.getSnapshot().status).toBe("resolved");
  });

  it("connects one runtime host per live Surface for the authority, and disconnects it on removal and handover", () => {
    const { sa, sb } = setup(SIDE_A, SIDE_B);
    const spies = [sa, sb].map((s) => vi.spyOn(s.runtime, "connectHost"));
    const one = scene.connectRenderer("three");
    one.frame(1, FRAME);
    one.frame(2, FRAME);
    expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 1]);
    expect(scene.inspect().hosts).toBe(2);
    const hostA = spies[0]!.mock.results[0]!.value as { disconnect(): void };
    const offA = vi.spyOn(hostA, "disconnect");
    // Handover: the new authority's hosts connect, the old ones disconnect.
    const two = scene.connectRenderer("inspector");
    two.authorize();
    two.frame(1, FRAME);
    expect(spies.map((s) => s.mock.calls.length)).toEqual([2, 2]);
    expect(offA).toHaveBeenCalledTimes(1);
    expect(scene.inspect().hosts).toBe(2);
    // A removed Surface gets no host and no frame.
    coordinator.removeSurface(sa.ref);
    expect(scene.inspect().hosts).toBe(1);
    two.frame(2, FRAME);
    expect(spies[0]!.mock.calls.length).toBe(2);
    expect(scene.inspect().surfaces.map((s) => s.ref.surfaceId)).toEqual(["B"]);
  });
});

describe("P1-08B3 WorkspaceScene — one snapshot for screen and input", () => {
  // Left of the crossing line A's page is nearer the eye, right of it B's
  // (A turns +0.6 rad about y: its left edge comes forward; B the opposite).
  const LEFT = at(CROSS_A, 80, 190);
  const RIGHT = at(CROSS_B, 320, 110);

  it("independent check: the chosen points are where A and B are in front", () => {
    // Each plane under the client point, by plain ray casting (no resolver).
    const ray = (p: { x: number; y: number }) => {
      const toWorld = (g: SurfaceGeometry, q: { x: number; y: number }) =>
        intersectSurface(g, {
          origin: FRAME.eye,
          direction: rayDir(q),
        });
      return [toWorld(CROSS_A, p), toWorld(CROSS_B, p)] as const;
    };
    const [la, lb] = ray(LEFT);
    expect(la!.inside && lb!.inside).toBe(true);
    expect(la!.distance).toBeLessThan(lb!.distance);
    const [ra, rb] = ray(RIGHT);
    expect(ra!.inside && rb!.inside).toBe(true);
    expect(rb!.distance).toBeLessThan(ra!.distance);
  });

  it("clips each page to its visible region and routes the pointer to the same owner", () => {
    const { sa, sb, pa, pb } = setup();
    scene.connectRenderer("three").frame(1, FRAME);
    const views = scene.inspect().surfaces;
    expect(views.map((v) => v.hiddenBy)).toEqual([
      [surfaceKey(sb.ref)],
      [surfaceKey(sa.ref)],
    ]);
    // (Browsers re-serialize `path(nonzero, …)` as `path(…)`.)
    expect(pa.style.clipPath).toMatch(/^path\(/);
    expect(pb.style.clipPath).toMatch(/^path\(/);
    // The clips come from the very snapshot that answers the ray.
    const depth = scene.depth!;
    for (const [i, s] of [sa, sb].entries())
      expect(views[i]!.clipPath).toBe(
        depth.visibility.find((v) => v.key === surfaceKey(s.ref))!.clipPath,
      );
    const left = scene.pointerDown(1, LEFT.x, LEFT.y, surfaceTarget(sa.ref));
    expect(left.allow).toBe(true);
    expect(left.route!.owner).toEqual({ kind: "surface", surface: sa.ref });
    scene.pointerContinue(1, "up", surfaceTarget(sa.ref));
    const right = scene.pointerDown(1, RIGHT.x, RIGHT.y, surfaceTarget(sb.ref));
    expect(right.route!.owner).toEqual({ kind: "surface", surface: sb.ref });
  });

  it("refuses a DOM target that is not the depth owner (no leak to the back Surface)", () => {
    const { sb } = setup();
    scene.connectRenderer("three").frame(1, FRAME);
    const d = scene.pointerDown(1, LEFT.x, LEFT.y, surfaceTarget(sb.ref));
    expect(d.allow).toBe(false);
    expect(scene.counters.mismatches).toBe(1);
    expect(scene.inspect().captures).toBe(0);
  });

  it("a non-interactive Surface in front blocks the input instead of passing it behind", () => {
    const { sa, sb } = setup();
    scene.connectRenderer("three").frame(1, FRAME);
    scene.setInteractive(sa.ref, false);
    for (const target of [
      surfaceTarget(sa.ref),
      surfaceTarget(sb.ref),
      SCENE,
    ]) {
      const d = scene.pointerDown(1, LEFT.x, LEFT.y, target);
      expect(d.allow).toBe(false);
      expect(d.reason).toMatch(/non-interactive/);
    }
    // B is still interactive where it is in front.
    expect(
      scene.pointerDown(1, RIGHT.x, RIGHT.y, surfaceTarget(sb.ref)).allow,
    ).toBe(true);
  });

  it("move and up keep the gesture owner; another Surface never receives them", () => {
    const { sa, sb } = setup();
    scene.connectRenderer("three").frame(1, FRAME);
    scene.pointerDown(1, LEFT.x, LEFT.y, surfaceTarget(sa.ref));
    expect(scene.pointerContinue(1, "move", surfaceTarget(sa.ref)).allow).toBe(
      true,
    );
    expect(scene.pointerContinue(1, "move", surfaceTarget(sb.ref)).allow).toBe(
      false,
    );
    expect(
      scene.pointerContinue(1, "up", surfaceTarget(sa.ref)).route!.owner,
    ).toEqual({
      kind: "surface",
      surface: sa.ref,
    });
    expect(scene.activation(surfaceTarget(sa.ref)).allow).toBe(true);
    expect(scene.activation(surfaceTarget(sb.ref)).allow).toBe(false);
    // Without a gesture, an up or a click on a page is refused.
    expect(scene.pointerContinue(1, "up", surfaceTarget(sb.ref)).allow).toBe(
      false,
    );
  });

  it("removing a Surface cancels its gesture; the re-added epoch never gets the old one", () => {
    const { A, sa } = setup();
    scene.connectRenderer("three").frame(1, FRAME);
    scene.pointerDown(7, LEFT.x, LEFT.y, surfaceTarget(sa.ref));
    expect(scene.inspect().captures).toBe(1);
    coordinator.removeSurface(sa.ref);
    expect(scene.inspect().captures).toBe(0);
    expect(scene.counters.cancelledGestures).toBe(1);
    const again = coordinator.addSurface("A", A, { geometry: CROSS_A });
    expect(again.ref.epoch).toBeGreaterThan(sa.ref.epoch);
    expect(
      scene.pointerContinue(7, "move", surfaceTarget(again.ref)).allow,
    ).toBe(false);
    expect(scene.pointerContinue(7, "up", surfaceTarget(again.ref)).allow).toBe(
      false,
    );
    expect(scene.activation(surfaceTarget(again.ref)).allow).toBe(false);
    expect(scene.activation(surfaceTarget(sa.ref)).allow).toBe(false);
  });

  it("losing frame authority cancels the gesture", () => {
    const { sa } = setup();
    const one = scene.connectRenderer("three");
    one.frame(1, FRAME);
    scene.pointerDown(1, LEFT.x, LEFT.y, surfaceTarget(sa.ref));
    const two = scene.connectRenderer("inspector");
    two.authorize();
    expect(scene.inspect().captures).toBe(0);
    two.frame(1, FRAME);
    expect(scene.pointerContinue(1, "up", surfaceTarget(sa.ref)).allow).toBe(
      false,
    );
  });

  it("routes an Adaptive panel to its own Surface's presentation, even with equal item and instance ids", () => {
    const { A, B, sa, sb } = setup(SIDE_A, SIDE_B);
    A.mount("chart");
    B.mount("chart");
    const pa = coordinator.extract(sa.ref, "chart", "adaptive", {
      position: [-0.5, 1.4, -0.8],
    });
    const pb = coordinator.extract(sb.ref, "chart", "adaptive", {
      position: [0.5, 1.4, -0.8],
    });
    if (!pa.ok || !pb.ok) throw new Error("extract failed");
    expect(pa.ref.instanceId).toBe(pb.ref.instanceId);
    scene.connectRenderer("three").frame(1, FRAME);
    const p = projectPoint(FRAME, [-0.5, 1.4, -0.8])!;
    const down = scene.pointerDown(1, p.x, p.y, SCENE);
    expect(down.route!.owner).toMatchObject({
      kind: "presentation",
      item: { surface: sa.ref, itemId: "chart" },
    });
    // The panel is in front of A's page: the DOM target must be the canvas.
    expect(scene.pointerDown(2, p.x, p.y, surfaceTarget(sa.ref)).allow).toBe(
      false,
    );
    scene.pointerContinue(1, "up", SCENE);
    expect(scene.adaptiveAction(pb.ref)).toBe(false);
    scene.pointerDown(1, p.x, p.y, SCENE);
    scene.pointerContinue(1, "up", SCENE);
    expect(scene.adaptiveAction(pa.ref)).toBe(true);
    expect(scene.adaptiveAction(pa.ref)).toBe(false); // consumed once
  });
});

describe("P1-08B3 WorkspaceScene — fail-closed depth", () => {
  it("a snapshot error publishes nothing, drops input and shows a non-interactive fallback", () => {
    let fail = false;
    const { sa, pa } = setup(CROSS_A, CROSS_B, {
      resolve: (planes, eye) => {
        if (fail) throw new IndeterminateDepthError("injected");
        return resolveDepthSnapshot(planes, eye);
      },
    });
    const r = scene.connectRenderer("three");
    r.frame(1, FRAME);
    const good = scene.depth;
    const LEFT = at(CROSS_A, 80, 190);
    scene.pointerDown(1, LEFT.x, LEFT.y, surfaceTarget(sa.ref));
    expect(scene.inspect().captures).toBe(1);
    fail = true;
    r.frame(2, FRAME);
    expect(scene.getSnapshot()).toMatchObject({
      status: "indeterminate",
      error: {
        sequence: 2,
        phase: "snapshot",
        name: "IndeterminateDepthError",
      },
    });
    expect(scene.depth).toBeNull(); // the previous snapshot is not reused
    expect(good).not.toBeNull();
    expect(scene.inspect().captures).toBe(0);
    expect(scene.pointerContinue(1, "up", surfaceTarget(sa.ref)).allow).toBe(
      false,
    );
    expect(
      scene.pointerDown(2, LEFT.x, LEFT.y, surfaceTarget(sa.ref)).allow,
    ).toBe(false);
    // Display fallback: unclipped, marked, still placed — but takes no input.
    expect(pa.style.clipPath).toBe("none");
    expect(pa.dataset.depth).toBe("indeterminate");
    expect(pa.style.visibility).toBe("");
    // Recovery on the next resolvable frame.
    fail = false;
    r.frame(3, FRAME);
    expect(scene.getSnapshot()).toMatchObject({
      status: "resolved",
      error: null,
    });
    expect(pa.style.clipPath).toMatch(/^path\(/);
  });

  it("a nearly coplanar pair fails closed with the real resolver", () => {
    const B = geometryAt([0, 1.4, -1.3], 0);
    const A: SurfaceGeometry = {
      ...B,
      pose: { ...B.pose, position: [0.05, 1.4, -1.3 + 1e-14] },
    };
    const { sa } = setup(A, B);
    scene.connectRenderer("three").frame(1, FRAME);
    expect(scene.getSnapshot().status).toBe("indeterminate");
    expect(scene.getSnapshot().error!.message).toMatch(/coplanar/i);
    expect(scene.pointerDown(1, 500, 350, surfaceTarget(sa.ref)).allow).toBe(
      false,
    );
  });

  it("an error of a later ray query invalidates the whole snapshot", () => {
    const { sa, pa } = setup(SIDE_A, SIDE_B, {
      resolve: (planes, eye) => {
        const real = resolveDepthSnapshot(planes, eye);
        return Object.freeze({
          visibility: real.visibility,
          depthOwner: () => {
            throw new IndeterminateDepthError(
              "Ray is nearly parallel to a plane",
            );
          },
        });
      },
    });
    scene.connectRenderer("three").frame(1, FRAME);
    expect(pa.style.clipPath).toBe("none");
    const d = scene.pointerDown(1, 300, 350, surfaceTarget(sa.ref));
    expect(d.allow).toBe(false);
    expect(scene.getSnapshot()).toMatchObject({
      status: "indeterminate",
      error: { phase: "ray" },
    });
    expect(scene.depth).toBeNull();
    expect(pa.dataset.depth).toBe("indeterminate");
  });

  it("`hidden` display policy hides the pages while indeterminate", () => {
    const B = geometryAt([0, 1.4, -1.3], 0);
    const A: SurfaceGeometry = {
      ...B,
      pose: { ...B.pose, position: [0.05, 1.4, -1.3 + 1e-14] },
    };
    const { pa } = setup(A, B, { indeterminateDisplay: "hidden" });
    scene.connectRenderer("three").frame(1, FRAME);
    expect(pa.style.visibility).toBe("hidden");
  });

  it("an immersive session suspends the DOM pages and their input", () => {
    const { sa, pa } = setup(SIDE_A, SIDE_B);
    const r = scene.connectRenderer("three");
    r.frame(1, FRAME);
    r.setImmersive(true);
    expect(scene.getSnapshot().status).toBe("suspended");
    expect(pa.style.visibility).toBe("hidden");
    expect(scene.pointerDown(1, 300, 350, surfaceTarget(sa.ref)).allow).toBe(
      false,
    );
    r.frame(2, FRAME);
    expect(scene.getSnapshot().status).toBe("suspended");
    r.setImmersive(false);
    r.frame(3, FRAME);
    expect(scene.getSnapshot().status).toBe("resolved");
  });
});

describe("P1-08B3 WorkspaceScene — DOM input gate and lifecycle", () => {
  it("cancels page events that the router does not route", () => {
    const { sa, pa, pb } = setup();
    scene.connectRenderer("three").frame(1, FRAME);
    const button = document.createElement("button");
    pa.append(button);
    const clicks = vi.fn();
    button.addEventListener("click", clicks);
    pb.addEventListener("click", clicks);
    const unbind = scene.bindInput(document.body, () => false);
    // A click without a routed gesture (e.g. synthesized) never lands.
    button.click();
    pb.click();
    expect(clicks).not.toHaveBeenCalled();
    // A routed gesture on A, then its click.
    const LEFT = at(CROSS_A, 80, 190);
    const init = {
      bubbles: true,
      pointerId: 1,
      clientX: LEFT.x,
      clientY: LEFT.y,
    };
    button.dispatchEvent(new PointerEvent("pointerdown", init));
    button.dispatchEvent(new PointerEvent("pointerup", init));
    button.click();
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(scene.inspect().keyboardOwner).toEqual({
      kind: "surface",
      surface: sa.ref,
    });
    // Keyboard input to B (not the keyboard owner) is cancelled.
    const key = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
    });
    pb.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    unbind();
    pb.click();
    expect(clicks).toHaveBeenCalledTimes(2);
  });

  it("an unused scene never subscribes to the coordinator (StrictMode discards)", () => {
    coordinator = new WorkspaceCoordinator();
    const subscribe = vi.spyOn(coordinator, "subscribe");
    const discarded = new WorkspaceScene(coordinator);
    expect(subscribe).not.toHaveBeenCalled();
    scene = new WorkspaceScene(coordinator);
    const r = scene.connectRenderer("three");
    expect(subscribe).toHaveBeenCalledTimes(1);
    r.disconnect();
    scene.dispose();
    discarded.dispose();
  });

  it("50 remove/add cycles leave no hosts, pages, gestures or registry listeners behind", () => {
    const { A, sa, pa } = setup(SIDE_A, SIDE_B);
    const r = scene.connectRenderer("three");
    let seq = 0;
    r.frame(++seq, FRAME);
    let ref = sa.ref;
    for (let i = 0; i < 50; i++) {
      scene.pointerDown(1, 300, 350, surfaceTarget(ref));
      coordinator.removeSurface(ref);
      expect(A.listeners()).toBe(0);
      const s = coordinator.addSurface("A", A, { geometry: SIDE_A });
      scene.attachPage(s.ref, pa);
      ref = s.ref;
      r.frame(++seq, FRAME);
    }
    const info = scene.inspect();
    expect(info.hosts).toBe(2);
    expect(info.pages).toBe(2);
    expect(info.captures).toBe(0);
    expect(A.listeners()).toBe(2);
    expect(info.surfaces.map((s) => s.ref.surfaceId)).toEqual(["B", "A"]);
  });
});

function rayDir(q: { x: number; y: number }): Vec3 {
  // Inverse of `camera()` for a client point (z = 0.5 in NDC).
  const { width: W, height: H } = FRAME.viewport;
  const f = 1 / Math.tan((50 * Math.PI) / 360);
  const nx = (q.x / W) * 2 - 1;
  const ny = 1 - (q.y / H) * 2;
  // Camera looks along -z with +y up from eye [0, 1.4, 0.3] (target level).
  const d: Vec3 = [(nx * (W / H)) / f, ny / f, -1];
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
}
