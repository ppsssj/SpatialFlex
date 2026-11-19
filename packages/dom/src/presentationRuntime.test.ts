// @vitest-environment jsdom
import { SpatialRegistry } from "@spatialflex/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PresentationRuntime,
  type PresentationController,
} from "./presentationRuntime.js";

/**
 * A minimal controller over a real registry, with the semantics of
 * @spatialflex/react's controller that the runtime relies on: placement
 * follows the registry status, and unregistering drops it.
 */
function controllerFor(registry: SpatialRegistry) {
  const external = new Set<string>();
  const elements = new Map<string, { slot: HTMLElement; panel: HTMLElement }>();
  const controller: PresentationController = {
    extractNative: (id) => {
      if (registry.get(id)?.status !== "attached" || !elements.has(id))
        return false;
      external.add(id);
      return registry.detach(id);
    },
    attach: (id) => {
      const attached = registry.attach(id);
      if (attached) external.delete(id);
      return attached;
    },
    placement: (id) =>
      registry.get(id)?.status === "detached"
        ? external.has(id)
          ? "external"
          : "viewport"
        : null,
    nativeElement: (id) =>
      controller.placement(id) === "external"
        ? (elements.get(id)?.panel ?? null)
        : null,
    sourceElement: (id) =>
      registry.has(id) ? (elements.get(id)?.slot ?? null) : null,
    setSourceVisibility: (id, v) => registry.setSourceVisibility(id, v),
  };
  /** Registers an item and its DOM, like a mounted SpatialItem. */
  const mount = (id: string, view = false, wrapper = document.body) => {
    const slot = document.createElement("div");
    const panel = document.createElement("div");
    panel.innerHTML =
      '<span data-spatialflex-handle="translate" role="button" tabindex="0">t</span>';
    slot.append(panel);
    wrapper.append(slot);
    elements.set(id, { slot, panel });
    const registration = registry.register({
      id,
      capabilities: { detachable: true },
    });
    if (view)
      registration.setView({
        body: { kind: "value", label: "n", value: "1" },
        actions: [{ id: "add", label: "+1", invoke: onAdd }],
      });
    return {
      registration,
      panel,
      unmount: () => {
        external.delete(id);
        elements.delete(id);
        registration.unregister();
        slot.remove();
      },
    };
  };
  const onAdd = vi.fn();
  return { controller, mount, onAdd };
}

const at = { position: [0, 1.5, -1] as const };
const ray = (x: number) => ({
  origin: [x, 1.5, 0] as const,
  direction: [0, 0, -1] as const,
});

let registry: SpatialRegistry;
let world: ReturnType<typeof controllerFor>;
let runtime: PresentationRuntime;
let disconnect: () => void;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
  registry = new SpatialRegistry();
  world = controllerFor(registry);
  runtime = new PresentationRuntime(registry, world.controller);
  disconnect = runtime.connect();
});
afterEach(() => {
  disconnect();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PresentationRuntime lifecycle", () => {
  it("native extraction creates an instance bound to the registration, manipulable and composited", () => {
    const { panel } = world.mount("card");
    const versions: number[] = [];
    runtime.subscribe(() => versions.push(runtime.getSnapshot().version));
    const result = runtime.extract("card", "native", at);
    expect(result).toMatchObject({
      ok: true,
      presentation: {
        itemId: "card",
        kind: "native",
        instanceId: "native-1",
        registrationKey: registry.registrationOf("card"),
        source: "placeholder",
      },
    });
    expect(versions).toHaveLength(1);
    expect(runtime.getSnapshot().presentations).toHaveLength(1);
    expect(runtime.manipulation.targets()).toMatchObject([
      { itemId: "card", presentationId: "native-1", kind: "native" },
    ]);
    expect(runtime.manipulation.poseOf("card")!.position).toEqual([0, 1.5, -1]);
    // Pending placement until the first frame.
    expect(panel.dataset.spatialVisibility).toBe("hidden");
    // Restore: the original is attached and every runtime-owned mark is gone.
    expect(runtime.restore("card")).toBe(true);
    expect(registry.get("card")!.status).toBe("attached");
    expect(runtime.getSnapshot().presentations).toEqual([]);
    expect(runtime.manipulation.targets()).toEqual([]);
    expect(Object.keys(panel.dataset)).toEqual([]);
  });

  it("re-extraction is a new instance at its own start pose", () => {
    world.mount("card");
    runtime.extract("card", "native", at);
    const token = runtime.manipulation.begin("card", "translate", 1, ray(0))!;
    runtime.manipulation.update(token, ray(0.3));
    runtime.manipulation.end(token, true);
    runtime.restore("card");
    const again = runtime.extract("card", "native", at);
    expect(again.ok && again.presentation.instanceId).toBe("native-2");
    expect(runtime.manipulation.poseOf("card")!.position).toEqual([0, 1.5, -1]);
  });

  it("unmount during a drag ends the presentation; stale input is rejected", () => {
    const { unmount } = world.mount("card");
    runtime.extract("card", "native", at);
    const token = runtime.manipulation.begin("card", "translate", 1, ray(0))!;
    unmount();
    expect(runtime.getSnapshot().presentations).toEqual([]);
    expect(runtime.manipulation.getSnapshot().active).toBeNull();
    runtime.manipulation.update(token, ray(0.5));
    // A new registration under the same id cannot receive the old session.
    world.mount("card");
    runtime.manipulation.update(token, ray(0.6));
    runtime.manipulation.end(token, true);
    expect(runtime.manipulation.poseOf("card")).toBeUndefined();
    expect(runtime.presentationOf("card")).toBeUndefined();
    expect(registry.get("card")!.status).toBe("attached");
  });

  it("a presentation of a replaced registration is never restored onto the new one", () => {
    const first = world.mount("card", true);
    runtime.extract("card", "adaptive", { ...at, source: "reserved" });
    const old = runtime.presentationOf("card")!;
    first.unmount();
    world.mount("card", true);
    expect(runtime.presentationOf("card")).toBeUndefined();
    // Its action is rejected: the instance and the view epoch are gone.
    expect(runtime.invoke(old.instanceId, "add")).toBe(false);
    expect(world.onAdd).not.toHaveBeenCalled();
  });

  it("Adaptive: reserved source, registration-scoped actions, revoked view ends it", () => {
    const { registration } = world.mount("card", true);
    const result = runtime.extract("card", "adaptive", {
      ...at,
      source: "reserved",
    });
    if (!result.ok) throw new Error(result.reason);
    expect(registry.get("card")!.layout.visible).toBe(false);
    expect(runtime.adaptivePanels()).toMatchObject([
      { presentation: { instanceId: "adaptive-1" }, view: { id: "card" } },
    ]);
    expect(runtime.invoke(result.presentation.instanceId, "add")).toBe(true);
    expect(runtime.invoke("adaptive-999", "add")).toBe(false);
    expect(world.onAdd).toHaveBeenCalledTimes(1);
    // Revoking the XR view ends the presentation and shows the source again.
    registration.setView(undefined);
    expect(runtime.presentationOf("card")).toBeUndefined();
    expect(registry.get("card")!.layout.visible).toBe(true);
    expect(runtime.invoke(result.presentation.instanceId, "add")).toBe(false);
  });

  it("switching strategy is a transaction; a failed validation keeps the current presentation", () => {
    const wrapper = document.createElement("section");
    document.body.append(wrapper);
    world.mount("card", true, wrapper);
    // Native → Adaptive succeeds: the original returns, then the panel shows.
    runtime.extract("card", "native", at);
    const switched = runtime.extract("card", "adaptive", at);
    expect(switched.ok).toBe(true);
    expect(registry.get("card")!.status).toBe("attached");
    expect(runtime.getSnapshot().presentations.map((p) => p.kind)).toEqual([
      "adaptive",
    ]);
    // Adaptive → Native refused (an ancestor captures fixed positioning):
    // the adaptive presentation stays exactly as it was.
    wrapper.style.transform = "translateX(2px)";
    const before = runtime.presentationOf("card");
    const refused = runtime.extract("card", "native", at);
    expect(refused).toMatchObject({ ok: false });
    expect(!refused.ok && refused.reason).toMatch(/section has transform/);
    expect(runtime.presentationOf("card")).toBe(before);
    expect(runtime.manipulation.targets().map((t) => t.kind)).toEqual([
      "adaptive",
    ]);
    // Native → Adaptive without a view: refused, native kept.
    world.mount("plain");
    runtime.extract("plain", "native", at);
    expect(runtime.extract("plain", "adaptive", at)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("declares no XR view"),
    });
    expect(runtime.presentationOf("plain")!.kind).toBe("native");
    expect(registry.get("plain")!.status).toBe("detached");
  });

  it("a start that fails after the old presentation ended restores the original", () => {
    world.mount("card", true);
    runtime.extract("card", "adaptive", { ...at, source: "reserved" });
    // The controller refuses to extract (e.g. the element went away).
    vi.spyOn(world.controller, "extractNative").mockReturnValue(false);
    const result = runtime.extract("card", "native", at);
    expect(result).toMatchObject({ ok: false });
    expect(runtime.presentationOf("card")).toBeUndefined();
    expect(registry.get("card")!.layout.visible).toBe(true);
    expect(registry.get("card")!.status).toBe("attached");
    expect(runtime.manipulation.targets()).toEqual([]);
  });

  it("refuses unknown, non-detachable and duplicate requests without side effects", () => {
    expect(runtime.extract("nope", "native", at)).toMatchObject({ ok: false });
    registry.register({ id: "fixed" });
    expect(runtime.nativeSupport("fixed")).toMatchObject({
      supported: false,
      reason: expect.stringContaining("not detachable"),
    });
    world.mount("card");
    runtime.extract("card", "native", at);
    expect(runtime.extract("card", "native", at)).toMatchObject({ ok: false });
    expect(
      runtime.extract("card", "adaptive", { ...at, source: "collapse" }),
    ).toMatchObject({ ok: false });
    expect(runtime.getSnapshot().presentations).toHaveLength(1);
  });

  it("the last host to disconnect ends every presentation; disconnect releases the runtime", () => {
    const { panel } = world.mount("card");
    world.mount("other", true);
    const a = runtime.connectHost();
    const b = runtime.connectHost();
    runtime.extract("card", "native", at);
    runtime.extract("other", "adaptive", at);
    a.disconnect();
    a.disconnect();
    expect(runtime.getSnapshot().presentations).toHaveLength(2);
    b.disconnect();
    expect(runtime.getSnapshot().presentations).toEqual([]);
    expect(registry.get("card")!.status).toBe("attached");
    expect(Object.keys(panel.dataset)).toEqual([]);
    expect(b.rayAt(10, 10)).toBeNull();
    // Runtime disconnect: unsubscribed and inert.
    runtime.extract("card", "native", at);
    disconnect();
    expect(registry.get("card")!.status).toBe("attached");
    expect(runtime.extract("card", "native", at)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not connected"),
    });
    // Reconnecting (React StrictMode) starts afresh.
    disconnect = runtime.connect();
    expect(runtime.extract("card", "native", at).ok).toBe(true);
  });

  it("two runtimes over two registries share nothing, even with the same item id", () => {
    const otherRegistry = new SpatialRegistry();
    const other = controllerFor(otherRegistry);
    const otherRuntime = new PresentationRuntime(
      otherRegistry,
      other.controller,
    );
    const stop = otherRuntime.connect();
    world.mount("card");
    other.mount("card");
    runtime.extract("card", "native", at);
    expect(otherRuntime.getSnapshot().presentations).toEqual([]);
    expect(otherRegistry.get("card")!.status).toBe("attached");
    expect(registry.registrationOf("card")).not.toBe(
      otherRegistry.registrationOf("card"),
    );
    const token = runtime.manipulation.begin("card", "translate", 1, ray(0));
    expect(token).not.toBeNull();
    expect(otherRuntime.manipulation.getSnapshot().active).toBeNull();
    stop();
    expect(runtime.presentationOf("card")).toBeDefined();
  });
});
