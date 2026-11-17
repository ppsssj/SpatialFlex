import { describe, expect, it, vi } from "vitest";
import { SpatialRegistry } from "./registry";

const ALL = { detachable: true, movable: true, resizable: true };

function setup(capabilities = ALL) {
  const registry = new SpatialRegistry();
  const registration = registry.register({ id: "image-b", capabilities });
  const listener = vi.fn();
  registry.subscribe(listener);
  return { registry, registration, listener };
}

describe("detach / attach lifecycle", () => {
  it("detaches with the given layout and attaches again", () => {
    const { registry } = setup();

    expect(
      registry.detach("image-b", {
        position: { x: 40, y: 80 },
        size: { width: 240, height: 190 },
      }),
    ).toBe(true);
    expect(registry.get("image-b")).toMatchObject({
      status: "detached",
      layout: {
        position: { x: 40, y: 80 },
        size: { width: 240, height: 190 },
        visible: true,
      },
    });

    expect(registry.attach("image-b")).toBe(true);
    expect(registry.get("image-b")?.status).toBe("attached");
  });

  it("keeps the layout while attached and reuses it on the next detach", () => {
    const { registry } = setup();
    registry.detach("image-b", { position: { x: 10, y: 20 } });
    registry.move("image-b", { x: 300, y: 200 });
    registry.attach("image-b");

    expect(registry.get("image-b")?.layout.position).toEqual({
      x: 300,
      y: 200,
    });

    registry.detach("image-b");
    expect(registry.get("image-b")?.layout.position).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("is idempotent: repeated calls do not notify", () => {
    const { registry, listener } = setup();

    expect(registry.attach("image-b")).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    registry.detach("image-b", { position: { x: 1, y: 2 } });
    const snapshot = registry.list();
    expect(registry.detach("image-b", { position: { x: 9, y: 9 } })).toBe(
      false,
    );
    expect(registry.move("image-b", { x: 1, y: 2 })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.list()).toBe(snapshot);
    expect(registry.get("image-b")?.layout.position).toEqual({ x: 1, y: 2 });
  });

  it("survives 20 detach/attach cycles with one notification per change", () => {
    const { registry, listener } = setup();
    for (let i = 0; i < 20; i++) {
      registry.detach("image-b", { position: { x: i, y: i } });
      registry.attach("image-b");
    }

    expect(listener).toHaveBeenCalledTimes(40);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("image-b")).toMatchObject({
      status: "attached",
      layout: { position: { x: 19, y: 19 } },
    });
  });

  it("keeps records immutable and other items untouched", () => {
    const { registry } = setup();
    registry.register({ id: "image-a" });
    const imageA = registry.get("image-a");
    const before = registry.get("image-b");

    registry.detach("image-b", { position: { x: 5, y: 6 } });

    const after = registry.get("image-b")!;
    expect(after).not.toBe(before);
    expect(before?.status).toBe("attached");
    expect(registry.get("image-a")).toBe(imageA);
    expect(Object.isFrozen(after.layout)).toBe(true);
    expect(Object.isFrozen(after.layout.position)).toBe(true);
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
    expect(registry.list().map((item) => item.id)).toEqual([
      "image-b",
      "image-a",
    ]);
  });

  it("copies the layout values it is given", () => {
    const { registry } = setup();
    const position = { x: 1, y: 2 };
    registry.detach("image-b", { position });
    position.x = 999;

    expect(registry.get("image-b")?.layout.position).toEqual({ x: 1, y: 2 });
  });
});

describe("move", () => {
  it("moves a detached item", () => {
    const { registry, listener } = setup();
    registry.detach("image-b");

    expect(registry.move("image-b", { x: 120, y: 64 })).toBe(true);
    expect(registry.get("image-b")?.layout.position).toEqual({
      x: 120,
      y: 64,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rejects moving an attached item", () => {
    const { registry } = setup();
    expect(() => registry.move("image-b", { x: 1, y: 1 })).toThrowError(
      expect.objectContaining({ code: "NOT_DETACHED" }),
    );
  });

  it("rejects moving an item that is not movable", () => {
    const { registry } = setup({ ...ALL, movable: false });
    registry.detach("image-b");

    expect(() => registry.move("image-b", { x: 1, y: 1 })).toThrowError(
      expect.objectContaining({ code: "NOT_MOVABLE" }),
    );
  });
});

describe("errors", () => {
  it.each([
    ["detach", (r: SpatialRegistry) => r.detach("missing")],
    ["attach", (r: SpatialRegistry) => r.attach("missing")],
    ["move", (r: SpatialRegistry) => r.move("missing", { x: 0, y: 0 })],
  ])("%s rejects an unknown ID", (_, call) => {
    const { registry, listener } = setup();
    expect(() => call(registry)).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_ITEM_ID" }),
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects detaching an item that is not detachable", () => {
    const { registry, listener } = setup({ ...ALL, detachable: false });

    expect(() => registry.detach("image-b")).toThrowError(
      expect.objectContaining({ code: "NOT_DETACHABLE" }),
    );
    expect(registry.get("image-b")?.status).toBe("attached");
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    { position: { x: Number.NaN, y: 0 } },
    { position: { x: 0, y: Number.POSITIVE_INFINITY } },
    { size: { width: -1, height: 10 } },
    { size: { width: 10, height: Number.NaN } },
  ])("rejects invalid layout %j", (options) => {
    const { registry } = setup();

    expect(() => registry.detach("image-b", options)).toThrowError(
      expect.objectContaining({ code: "INVALID_LAYOUT" }),
    );
    expect(registry.get("image-b")?.status).toBe("attached");
  });
});

describe("registration handles across the lifecycle", () => {
  it("keeps the handle valid after detach, move and attach", () => {
    const { registry, registration } = setup();
    registry.detach("image-b");
    registry.move("image-b", { x: 3, y: 4 });

    registration.update({ resizable: false });
    expect(registry.get("image-b")).toMatchObject({
      status: "detached",
      capabilities: { resizable: false },
    });

    registration.unregister();
    expect(registry.has("image-b")).toBe(false);
  });

  it("attaches a detached item when it stops being detachable", () => {
    const { registry, registration, listener } = setup();
    registry.detach("image-b", { position: { x: 7, y: 8 } });

    registration.update({ detachable: false });

    expect(registry.get("image-b")).toMatchObject({
      status: "attached",
      layout: { position: { x: 7, y: 8 } },
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not let a stale handle affect a replacement item", () => {
    const { registry, registration } = setup();
    registry.detach("image-b");
    registration.unregister();

    registry.register({ id: "image-b", capabilities: ALL });
    expect(registry.get("image-b")?.status).toBe("attached");
    expect(registry.get("image-b")?.layout.position).toBeNull();

    registration.update({ detachable: false });
    registration.unregister();
    expect(registry.get("image-b")?.capabilities.detachable).toBe(true);
  });

  it("does not let a handle outlive removal by ID", () => {
    const { registry, registration } = setup();
    registry.unregister("image-b");
    registry.register({ id: "image-b" });

    registration.unregister();
    expect(registry.has("image-b")).toBe(true);
  });
});

it("keeps lifecycle state isolated between registries", () => {
  const first = new SpatialRegistry();
  const second = new SpatialRegistry();
  first.register({ id: "image-b", capabilities: ALL });
  second.register({ id: "image-b", capabilities: ALL });

  first.detach("image-b");

  expect(first.get("image-b")?.status).toBe("detached");
  expect(second.get("image-b")?.status).toBe("attached");
});
