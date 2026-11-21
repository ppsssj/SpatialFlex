// @vitest-environment jsdom
// P1-08B1: the Multi-Surface WorkspaceCoordinator over real SpatialRegistry
// and PresentationRuntime instances (one per Surface, ADR 0001).
import { SpatialRegistry } from "@spatialflex/core";
import {
  WorkspaceContractError,
  type SurfaceGeometry,
} from "@spatialflex/core/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentationController } from "../presentationRuntime.js";
import { WorkspaceCoordinator } from "./coordinator.js";

const geometry = (x: number): SurfaceGeometry => ({
  resolution: { width: 720, height: 600 },
  metersPerPixel: 0.00225,
  pose: { position: [x, 1.4, -1.5], rotation: [0, 0, 0, 1], scale: 1 },
});

const FRAME = {
  viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 1],
  viewport: { left: 0, top: 0, width: 800, height: 600 },
  eye: [0, 0, 0] as const,
};

/** One Surface's source scope, with its registry listeners counted. */
function scope() {
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
    const slot = document.createElement("div");
    document.body.append(slot);
    slots.set(id, slot);
    const registration = registry.register({ id });
    registration.setView({
      body: { kind: "value", label: "n", value: "1" },
      actions: [{ id: "act", label: "Act", invoke: onAction }],
    });
    return {
      unregister: () => {
        registration.unregister();
        slot.remove();
        slots.delete(id);
      },
    };
  };
  return {
    registry,
    controller,
    mount,
    onAction,
    listeners: () => listeners,
  };
}

const adaptive = { position: [0, 1, -1] as const };

let coordinator: WorkspaceCoordinator;
afterEach(() => coordinator?.dispose());

describe("P1-08B1 WorkspaceCoordinator", () => {
  it("registers two independent Surfaces, each with its own runtime", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const B = scope();
    const a = coordinator.addSurface("A", A, { geometry: geometry(-0.6) });
    const b = coordinator.addSurface("B", B, { geometry: geometry(0.6) });
    expect(a.runtime).not.toBe(b.runtime);
    expect(a.ref.epoch).not.toBe(b.ref.epoch);
    expect(
      coordinator.getSnapshot().surfaces.map((s) => s.ref.surfaceId),
    ).toEqual(["A", "B"]);
    // Each runtime follows only its own registry.
    expect(A.listeners()).toBe(2);
    expect(B.listeners()).toBe(2);
  });

  it("the same item id on two Surfaces stays independent", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const B = scope();
    const a = coordinator.addSurface("A", A, { geometry: geometry(-0.6) });
    const b = coordinator.addSurface("B", B, { geometry: geometry(0.6) });
    A.mount("chart");
    B.mount("chart");
    const pa = coordinator.extract(a.ref, "chart", "adaptive", adaptive);
    const pb = coordinator.extract(b.ref, "chart", "adaptive", adaptive);
    if (!pa.ok || !pb.ok) throw new Error("extract failed");
    // Instance ids are per runtime: equal strings, different presentations.
    expect(pa.presentation.instanceId).toBe(pb.presentation.instanceId);
    expect(pa.ref.item.surface).toEqual(a.ref);
    expect(pb.ref.item.surface).toEqual(b.ref);
    expect(pa.ref.item.registrationKey).not.toBe(pb.ref.item.registrationKey);
    expect(coordinator.invoke(pa.ref, "act")).toBe(true);
    expect(A.onAction).toHaveBeenCalledTimes(1);
    expect(B.onAction).not.toHaveBeenCalled();
    expect(coordinator.presentations()).toHaveLength(2);
  });

  it("removing A ends only A's presentations; B keeps working", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const B = scope();
    const a = coordinator.addSurface("A", A, { geometry: geometry(-0.6) });
    const b = coordinator.addSurface("B", B, { geometry: geometry(0.6) });
    A.mount("chart");
    B.mount("chart");
    const pa = coordinator.extract(a.ref, "chart", "adaptive", adaptive);
    const pb = coordinator.extract(b.ref, "chart", "adaptive", adaptive);
    if (!pa.ok || !pb.ok) throw new Error("extract failed");

    expect(coordinator.removeSurface(a.ref)).toBe(true);
    expect(coordinator.removeSurface(a.ref)).toBe(false); // stale: no-op
    expect(a.runtime.getSnapshot().presentations).toEqual([]);
    expect(A.listeners()).toBe(0);
    expect(coordinator.isLive(a.ref)).toBe(false);
    expect(coordinator.invoke(pa.ref, "act")).toBe(false);
    expect(A.onAction).not.toHaveBeenCalled();
    // B is untouched.
    expect(b.runtime.getSnapshot().presentations).toEqual([pb.presentation]);
    expect(B.listeners()).toBe(2);
    expect(coordinator.invoke(pb.ref, "act")).toBe(true);
    expect(B.onAction).toHaveBeenCalledTimes(1);
  });

  it("re-registering A gives a new epoch; old-epoch refs are refused", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const a1 = coordinator.addSurface("A", A, { geometry: geometry(-0.6) });
    A.mount("chart");
    const old = coordinator.extract(a1.ref, "chart", "adaptive", adaptive);
    if (!old.ok) throw new Error("extract failed");
    coordinator.removeSurface(a1.ref);

    // Same id, same registry (the same React subtree re-registered).
    const a2 = coordinator.addSurface("A", A, { geometry: geometry(-0.6) });
    expect(a2.ref.epoch).toBeGreaterThan(a1.ref.epoch);
    const fresh = coordinator.extract(a2.ref, "chart", "adaptive", adaptive);
    if (!fresh.ok) throw new Error("extract failed");
    // The new runtime numbers instances from 1 again and the item's
    // registration is unchanged: only the Surface epoch tells them apart.
    expect(fresh.ref.instanceId).toBe(old.ref.instanceId);
    expect(fresh.ref.item.registrationKey).toBe(old.ref.item.registrationKey);
    expect(coordinator.isCurrent(old.ref)).toBe(false);
    expect(coordinator.invoke(old.ref, "act")).toBe(false);
    expect(coordinator.restore(old.ref)).toBe(false);
    expect(coordinator.extract(a1.ref, "chart", "native", adaptive)).toEqual({
      ok: false,
      reason: expect.stringContaining("not live"),
    });
    expect(coordinator.setGeometry(a1.ref, geometry(0))).toBe(false);
    expect(coordinator.connectHost(a1.ref)).toBeNull();
    expect(A.onAction).not.toHaveBeenCalled();
    expect(coordinator.invoke(fresh.ref, "act")).toBe(true);
    expect(A.onAction).toHaveBeenCalledTimes(1);
  });

  it("a remounted item (new registration) invalidates its scoped refs", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const a = coordinator.addSurface("A", A, { geometry: geometry(0) });
    const item = A.mount("chart");
    const p = coordinator.extract(a.ref, "chart", "adaptive", adaptive);
    if (!p.ok) throw new Error("extract failed");
    item.unregister();
    A.mount("chart");
    expect(coordinator.isCurrent(p.ref)).toBe(false);
    expect(coordinator.invoke(p.ref, "act")).toBe(false);
    expect(coordinator.itemRef(a.ref, "chart")?.registrationKey).not.toBe(
      p.ref.item.registrationKey,
    );
  });

  it("rejects duplicate ids and shared registries without creating runtimes", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const B = scope();
    coordinator.addSurface("A", A, { geometry: geometry(0) });
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (e) {
        return (e as WorkspaceContractError).code;
      }
      return null;
    };
    expect(
      code(() => coordinator.addSurface("A", B, { geometry: geometry(0) })),
    ).toBe("DUPLICATE_SURFACE_ID");
    expect(B.listeners()).toBe(0);
    expect(
      code(() => coordinator.addSurface("C", A, { geometry: geometry(0) })),
    ).toBe("SHARED_SOURCE_SCOPE");
    expect(A.listeners()).toBe(2);
    expect(
      code(() => coordinator.addSurface(" ", B, { geometry: geometry(0) })),
    ).toBe("INVALID_SURFACE_ID");
    expect(coordinator.getSnapshot().surfaces).toHaveLength(1);
  });

  it("repeated add/remove cycles leak no registry listeners or Surfaces", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const B = scope();
    const b = coordinator.addSurface("B", B, { geometry: geometry(0.6) });
    const onChange = vi.fn();
    const stop = coordinator.subscribe(onChange);
    let last = 0;
    for (let i = 0; i < 50; i++) {
      const a = coordinator.addSurface("A", A, { geometry: geometry(-0.6) });
      expect(a.ref.epoch).toBeGreaterThan(last);
      last = a.ref.epoch;
      A.mount(`item-${i}`);
      coordinator.extract(a.ref, `item-${i}`, "adaptive", adaptive);
      expect(coordinator.removeSurface(a.ref)).toBe(true);
      expect(A.listeners()).toBe(0);
    }
    expect(onChange).toHaveBeenCalledTimes(100);
    stop();
    expect(coordinator.getSnapshot().surfaces.map((s) => s.ref)).toEqual([
      b.ref,
    ]);
    expect(B.listeners()).toBe(2);
  });

  it("setGeometry and connectHost act on the current incarnation", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const a = coordinator.addSurface("A", A, { geometry: geometry(0) });
    const v = coordinator.getSnapshot().version;
    expect(coordinator.setGeometry(a.ref, geometry(1))).toBe(true);
    expect(coordinator.getSnapshot().version).toBe(v + 1);
    expect(coordinator.surface(a.ref)?.geometry.pose.position[0]).toBe(1);
    const host = coordinator.connectHost(a.ref)!;
    host.frame(FRAME);
    expect(host.rayAt(400, 300)).not.toBeNull();
    host.disconnect();
  });

  it("dispose removes every Surface, then refuses use", () => {
    coordinator = new WorkspaceCoordinator();
    const A = scope();
    const B = scope();
    coordinator.addSurface("A", A, { geometry: geometry(0) });
    coordinator.addSurface("B", B, { geometry: geometry(1) });
    const listener = vi.fn();
    coordinator.subscribe(listener);
    coordinator.dispose();
    expect(A.listeners() + B.listeners()).toBe(0);
    expect(coordinator.getSnapshot().surfaces).toEqual([]);
    expect(() =>
      coordinator.addSurface("A", A, { geometry: geometry(0) }),
    ).toThrow(WorkspaceContractError);
    listener.mockClear();
    coordinator.dispose();
    expect(listener).not.toHaveBeenCalled();
  });
});
