// @vitest-environment jsdom
// P1-08A Multi-Surface contracts that involve the DOM runtime: A3 (surface
// lifecycle with one real PresentationRuntime per surface) and A9
// (compatibility of the workspace contracts with the single-surface
// runtime and projection). The workspace primitives are package-internal
// to core, so this test imports them from source.
import { SpatialRegistry } from "@spatialflex/core";
import { describe, expect, it, vi } from "vitest";
import {
  cssToWorld,
  FrameAuthority,
  SurfaceTable,
  type ScopedPresentationRef,
  type SurfaceGeometry,
} from "../../core/src/workspace/index.js";
import {
  PresentationRuntime,
  type PresentationController,
} from "./presentationRuntime.js";
import {
  quaternionFromEuler,
  surfacePoint,
  type CameraFrame,
  type SpatialWebSurfacePose,
} from "./projection.js";

/** One surface's source scope: a registry and a minimal DOM controller. */
function surfaceScope() {
  const registry = new SpatialRegistry();
  const slots = new Map<string, HTMLElement>();
  const controller: PresentationController = {
    extractNative: () => false,
    attach: (id) => registry.attach(id),
    placement: () => null,
    nativeElement: () => null,
    sourceElement: (id) => slots.get(id) ?? null,
    setSourceVisibility: (id, v) => registry.setSourceVisibility(id, v),
  };
  const onAction = vi.fn();
  const mount = (id: string) => {
    const slot = document.createElement("div");
    document.body.append(slot);
    slots.set(id, slot);
    const registration = registry.register({ id });
    registration.setView({
      body: { kind: "value", label: "n", value: "1" },
      actions: [{ id: "act", label: "Act", invoke: onAction }],
    });
    return registration;
  };
  const runtime = new PresentationRuntime(registry, controller);
  return { registry, runtime, mount, onAction };
}

const FRAME: CameraFrame = {
  viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 1],
  viewport: { left: 0, top: 0, width: 800, height: 600 },
  eye: [0, 0, 0],
};

const geometry = (z: number): SurfaceGeometry => ({
  resolution: { width: 720, height: 600 },
  metersPerPixel: 0.00225,
  pose: { position: [0, 1.4, z], rotation: [0, 0, 0, 1], scale: 1 },
});

describe("A3 surface lifecycle over real presentation runtimes", () => {
  it("removing one surface ends only its own presentations", () => {
    const surfaces = new SurfaceTable();
    const A = surfaceScope();
    const B = surfaceScope();
    const teardown = new Map<number, () => void>();
    const a = surfaces.add("A", geometry(-1.6), A.registry);
    const b = surfaces.add("B", geometry(-1), B.registry);
    teardown.set(a.epoch, A.runtime.connect());
    teardown.set(b.epoch, B.runtime.connect());
    // The coordinator tears a surface's own runtime down on removal.
    surfaces.subscribe((e) => {
      if (e.type === "removed") teardown.get(e.ref.epoch)?.();
    });
    A.mount("chart");
    B.mount("chart");
    const pa = A.runtime.extract("chart", "adaptive", {
      position: [0, 1, -1],
    });
    const pb = B.runtime.extract("chart", "adaptive", {
      position: [1, 1, -1],
    });
    if (!pa.ok || !pb.ok) throw new Error("extraction failed");
    // Instance ids are per runtime: equal strings, different presentations.
    // Workspace-level addressing is therefore structured (surface + item +
    // instance), never the instance id alone.
    expect(pa.presentation.instanceId).toBe(pb.presentation.instanceId);
    const refA: ScopedPresentationRef = {
      item: surfaces.itemRef(a, "chart")!,
      instanceId: pa.presentation.instanceId,
    };
    const refB: ScopedPresentationRef = {
      item: surfaces.itemRef(b, "chart")!,
      instanceId: pb.presentation.instanceId,
    };
    expect(refA.item.registrationKey).not.toBe(refB.item.registrationKey);

    expect(surfaces.remove(a)).toBe(true);
    expect(A.runtime.getSnapshot().presentations).toEqual([]);
    expect(B.runtime.getSnapshot().presentations).toEqual([pb.presentation]);
    // The removed surface's action is gone; the other surface's works once.
    expect(surfaces.isCurrent(refA.item)).toBe(false);
    expect(A.runtime.invoke(refA.instanceId, "act")).toBe(false);
    expect(surfaces.isCurrent(refB.item)).toBe(true);
    expect(B.runtime.invoke(refB.instanceId, "act")).toBe(true);
    expect(A.onAction).not.toHaveBeenCalled();
    expect(B.onAction).toHaveBeenCalledTimes(1);
    teardown.get(b.epoch)!();
  });
});

describe("A9 compatibility with the single-surface runtime", () => {
  it("the surface coordinate contract equals the DOM projection's page placement", () => {
    const pose: SpatialWebSurfacePose = {
      position: [-0.42, 1.42, -1.02],
      rotation: [0.1, 0.15, -0.05],
      width: 1.62,
      height: 1.35,
    };
    const resolution = { width: 720, height: 600 };
    const g: SurfaceGeometry = {
      resolution,
      metersPerPixel: pose.width / resolution.width,
      pose: {
        position: pose.position,
        rotation: quaternionFromEuler(pose.rotation),
        scale: 1,
      },
    };
    for (const [u, v] of [
      [0, 0],
      [720, 600],
      [360, 300],
      [12.5, 590],
    ]) {
      const dom = surfacePoint(pose, resolution, u!, v!);
      const core = cssToWorld(g, u!, v!);
      dom.forEach((x, i) => expect(core[i]).toBeCloseTo(x, 12));
    }
  });

  it("frame authority's default rule is the runtime's earliest-host rule", () => {
    const registry = new SpatialRegistry();
    const runtime = new PresentationRuntime(registry, {
      extractNative: () => false,
      attach: () => false,
      placement: () => null,
      nativeElement: () => null,
      sourceElement: () => null,
      setSourceVisibility: () => false,
    });
    const stop = runtime.connect();
    const first = runtime.connectHost();
    const second = runtime.connectHost();
    first.frame(FRAME);
    second.frame(FRAME);
    const authority = new FrameAuthority<CameraFrame>();
    const one = authority.connect("first");
    const two = authority.connect("second");
    expect(authority.submit(one, 1, FRAME)).toBe("accepted");
    expect(authority.submit(two, 1, FRAME)).toBe("not-authoritative");
    // Same outcome: only the first host's camera gives rays.
    expect(first.rayAt(400, 300)).not.toBeNull();
    expect(second.rayAt(400, 300)).toBeNull();
    // Disconnecting the authority clears it in both.
    first.disconnect();
    authority.disconnect(one);
    expect(second.rayAt(400, 300)).toBeNull();
    expect(authority.current()).toBeNull();
    second.frame(FRAME);
    expect(second.rayAt(400, 300)).not.toBeNull();
    expect(authority.submit(two, 2, FRAME)).toBe("accepted");
    stop();
  });
});
