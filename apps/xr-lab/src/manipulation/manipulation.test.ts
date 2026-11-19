// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostRay } from "../contracts/xrHost";
import { trackManipulationPointer } from "../hosts/shared/manipulationPointer";
import {
  ManipulationAdapter,
  type ManipulablePresentation,
} from "../integrations/spatialflex/manipulation";

const native = (instance: string): ManipulablePresentation => ({
  itemId: "shared-counter",
  presentationId: instance,
  registrationId: "1:1",
  kind: "native",
  initial: { position: [0, 0, -2], rotation: [0, 0, 0, 1], scale: 1 },
  extent: { width: 0.6, height: 0.4 },
});
const adaptive = (instance: string): ManipulablePresentation => ({
  ...native(instance),
  kind: "adaptive",
  initial: { position: [1, 0, -2], rotation: [0, 0, 0, 1], scale: 1 },
});
const ray = (x: number): HostRay => ({
  origin: [x, 0, 0],
  direction: [0, 0, -1],
});

describe("ManipulationAdapter (presentation instance lifecycle)", () => {
  it("attaches each instance once and addresses it by item id", () => {
    const adapter = new ManipulationAdapter();
    adapter.sync([native("native-1")]);
    const token = adapter.begin("shared-counter", "translate", 1, ray(0))!;
    adapter.update(token, ray(0.25));
    adapter.end(token, true);
    // A later sync with the same instance keeps the manipulated pose.
    adapter.sync([native("native-1")]);
    expect(adapter.poseOf("shared-counter")!.position).toEqual([0.25, 0, -2]);
    expect(adapter.targets()).toMatchObject([
      { itemId: "shared-counter", presentationId: "native-1", kind: "native" },
    ]);
    expect(adapter.items("native")).toEqual(["shared-counter"]);
    expect(adapter.items("adaptive")).toEqual([]);
  });

  it("Native → Adaptive: input of the ended instance is rejected; the new one starts at its own pose", () => {
    const adapter = new ManipulationAdapter();
    adapter.sync([native("native-1")]);
    const token = adapter.begin("shared-counter", "translate", 1, ray(0))!;
    adapter.update(token, ray(0.1));
    expect(adapter.getSnapshot().active).toMatchObject({
      itemId: "shared-counter",
      presentationId: "native-1",
      mode: "translate",
      input: "pointer",
    });
    // Restore + extract as XR Adaptive mid-drag.
    adapter.sync([adaptive("presentation-2")]);
    expect(adapter.getSnapshot().active).toBeNull();
    adapter.update(token, ray(0.5));
    adapter.end(token, true);
    expect(adapter.poseOf("shared-counter")).toEqual(
      adaptive("presentation-2").initial,
    );
    expect(adapter.items("adaptive")).toEqual(["shared-counter"]);
  });

  it("keyboard sessions, cancel, reset and selection by item id", () => {
    const adapter = new ManipulationAdapter();
    adapter.sync([
      native("native-1"),
      { ...adaptive("presentation-1"), itemId: "image-panel" },
    ]);
    adapter.nudge("shared-counter", "translate", "right", false);
    expect(adapter.getSnapshot()).toMatchObject({
      active: { input: "keyboard", itemId: "shared-counter" },
      selected: "shared-counter",
    });
    // Ending a keyboard session of another item does nothing.
    expect(adapter.endKeyboard("image-panel", true)).toBe(false);
    expect(adapter.endKeyboard("shared-counter", false)).toBe(true);
    expect(adapter.poseOf("shared-counter")!.position).toEqual([0, 0, -2]);
    adapter.nudge("shared-counter", "resize", "up", true);
    expect(adapter.endKeyboard("shared-counter", true)).toBe(true);
    expect(adapter.poseOf("shared-counter")!.scale).toBeCloseTo(1.25);
    expect(adapter.reset("shared-counter")).toBe(true);
    expect(adapter.poseOf("shared-counter")!.scale).toBe(1);
    expect(adapter.select("image-panel")).toBe(true);
    expect(adapter.getSnapshot().selected).toBe("image-panel");
    expect(adapter.select("unknown")).toBe(false);
    // Snapshots are stable between changes (useSyncExternalStore).
    expect(adapter.getSnapshot()).toBe(adapter.getSnapshot());
  });

  it("a moved layout placement shifts the instance, keeping manipulation", () => {
    const adapter = new ManipulationAdapter();
    adapter.sync([adaptive("presentation-1")]);
    const token = adapter.begin("shared-counter", "translate", 1, ray(1))!;
    adapter.update(token, ray(1.2));
    adapter.end(token, true);
    // The integration's Move button moved the panel by 0.1 m on x.
    const moved = adaptive("presentation-1");
    adapter.sync([
      {
        ...moved,
        initial: { ...moved.initial, position: [1.1, 0, -2] },
      },
    ]);
    const [x] = adapter.poseOf("shared-counter")!.position;
    expect(x).toBeCloseTo(1.3, 12);
    // Reset returns to the moved placement.
    adapter.reset("shared-counter");
    expect(adapter.poseOf("shared-counter")!.position[0]).toBeCloseTo(1.1, 12);
  });

  it("ended items are inert", () => {
    const adapter = new ManipulationAdapter();
    adapter.sync([native("native-1")]);
    adapter.dispose();
    expect(adapter.poseOf("shared-counter")).toBeUndefined();
    expect(adapter.begin("shared-counter", "translate", 1, ray(0))).toBeNull();
    expect(
      adapter.nudge("shared-counter", "translate", "left", false),
    ).toBeNull();
    expect(adapter.reset("shared-counter")).toBe(false);
  });
});

describe("shared manipulation pointer lifecycle", () => {
  const pointer = (
    type: string,
    init: { pointerId?: number; buttons?: number; x?: number } = {},
  ) =>
    Object.assign(new Event(type), {
      pointerId: init.pointerId ?? 1,
      buttons: init.buttons ?? 1,
      clientX: init.x ?? 0,
      clientY: 0,
    });
  const setup = () => {
    const manipulation = { update: vi.fn(), end: vi.fn() };
    const onRelease = vi.fn();
    const dispose = trackManipulationPointer({
      token: 7,
      pointerId: 1,
      toRay: (x) => ray(x),
      manipulation,
      onRelease,
    });
    return { manipulation, onRelease, dispose };
  };
  const added = vi.spyOn(window, "addEventListener");
  const removed = vi.spyOn(window, "removeEventListener");
  afterEach(() => {
    added.mockClear();
    removed.mockClear();
  });

  it("follows only its pointer and commits on release", () => {
    const { manipulation, onRelease } = setup();
    window.dispatchEvent(pointer("pointermove", { x: 5 }));
    window.dispatchEvent(pointer("pointermove", { pointerId: 2, x: 9 }));
    expect(manipulation.update).toHaveBeenCalledTimes(1);
    expect(manipulation.update).toHaveBeenCalledWith(7, ray(5));
    window.dispatchEvent(pointer("pointerup", { pointerId: 2 }));
    expect(manipulation.end).not.toHaveBeenCalled();
    window.dispatchEvent(pointer("pointerup"));
    expect(manipulation.end).toHaveBeenCalledWith(7, true);
    expect(onRelease).toHaveBeenCalledTimes(1);
    // Every listener added is removed again; later events are ignored.
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(
      added.mock.calls.map((c) => c[0]).sort(),
    );
    window.dispatchEvent(pointer("pointermove", { x: 3 }));
    expect(manipulation.update).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels the session but the press is held until release", () => {
    const { manipulation, onRelease } = setup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(manipulation.end).toHaveBeenCalledWith(7, false);
    expect(onRelease).not.toHaveBeenCalled();
    // The rest of the drag neither manipulates nor releases early.
    window.dispatchEvent(pointer("pointermove", { x: 5 }));
    expect(manipulation.update).not.toHaveBeenCalled();
    window.dispatchEvent(pointer("pointerup"));
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(manipulation.end).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "pointercancel",
      () => window.dispatchEvent(pointer("pointercancel")),
      false,
    ],
    ["blur", () => window.dispatchEvent(new Event("blur")), false],
    [
      "a move without the button (missed release)",
      () => window.dispatchEvent(pointer("pointermove", { buttons: 0 })),
      true,
    ],
  ] as const)("%s ends it", (_, act, commit) => {
    const { manipulation, onRelease } = setup();
    act();
    expect(manipulation.end).toHaveBeenCalledWith(7, commit);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("disposal (unmount) cancels exactly once", () => {
    const { manipulation, onRelease, dispose } = setup();
    dispose();
    dispose();
    window.dispatchEvent(pointer("pointerup"));
    expect(manipulation.end).toHaveBeenCalledTimes(1);
    expect(manipulation.end).toHaveBeenCalledWith(7, false);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
