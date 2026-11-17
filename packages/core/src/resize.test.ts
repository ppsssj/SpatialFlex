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

describe("resize", () => {
  it("resizes a detached, resizable item", () => {
    const { registry, listener } = setup();
    registry.detach("image-b", { position: { x: 10, y: 20 } });

    expect(registry.resize("image-b", { width: 320, height: 240 })).toBe(true);

    expect(registry.get("image-b")?.layout).toEqual({
      position: { x: 10, y: 20 },
      size: { width: 320, height: 240 },
      visible: true,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for an unchanged size", () => {
    const { registry, listener } = setup();
    registry.detach("image-b");
    registry.resize("image-b", { width: 320, height: 240 });
    const snapshot = registry.list();

    expect(registry.resize("image-b", { width: 320, height: 240 })).toBe(false);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.list()).toBe(snapshot);
  });

  it("keeps the size while attached and restores it on the next detach", () => {
    const { registry } = setup();
    registry.detach("image-b");
    registry.resize("image-b", { width: 300, height: 200 });
    registry.attach("image-b");

    expect(registry.get("image-b")).toMatchObject({
      status: "attached",
      layout: { size: { width: 300, height: 200 } },
    });

    registry.detach("image-b");
    expect(registry.get("image-b")?.layout.size).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("replaces records immutably and copies the size", () => {
    const { registry } = setup();
    registry.detach("image-b");
    const before = registry.get("image-b")!;
    const size = { width: 300, height: 200 };

    registry.resize("image-b", size);
    size.width = 999;

    const after = registry.get("image-b")!;
    expect(after).not.toBe(before);
    expect(before.layout.size).toBeNull();
    expect(after.layout.size).toEqual({ width: 300, height: 200 });
    expect(Object.isFrozen(after.layout.size)).toBe(true);
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  });

  it("does not change position, status or capabilities", () => {
    const { registry } = setup();
    registry.detach("image-b", { position: { x: 1, y: 2 } });
    const before = registry.get("image-b")!;

    registry.resize("image-b", { width: 50, height: 60 });

    const after = registry.get("image-b")!;
    expect(after.layout.position).toEqual(before.layout.position);
    expect(after.status).toBe("detached");
    expect(after.capabilities).toBe(before.capabilities);
  });
});

describe("resize errors", () => {
  it("rejects an unknown ID", () => {
    const { registry, listener } = setup();
    expect(() =>
      registry.resize("missing", { width: 10, height: 10 }),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_ITEM_ID" }));
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects an item that is not resizable", () => {
    const { registry } = setup({ ...ALL, resizable: false });
    registry.detach("image-b");

    expect(() =>
      registry.resize("image-b", { width: 10, height: 10 }),
    ).toThrowError(expect.objectContaining({ code: "NOT_RESIZABLE" }));
    expect(registry.get("image-b")?.layout.size).toBeNull();
  });

  it("rejects an attached item", () => {
    const { registry } = setup();
    expect(() =>
      registry.resize("image-b", { width: 10, height: 10 }),
    ).toThrowError(expect.objectContaining({ code: "NOT_DETACHED" }));
  });

  it.each([
    { width: Number.NaN, height: 10 },
    { width: 10, height: Number.POSITIVE_INFINITY },
    { width: 0, height: 10 },
    { width: 10, height: -5 },
  ])("rejects invalid size %j", (size) => {
    const { registry } = setup();
    registry.detach("image-b");
    const before = registry.get("image-b");

    expect(() => registry.resize("image-b", size)).toThrowError(
      expect.objectContaining({ code: "INVALID_LAYOUT" }),
    );
    expect(registry.get("image-b")).toBe(before);
  });

  it("rejects a zero size when detaching", () => {
    const { registry } = setup();
    expect(() =>
      registry.detach("image-b", { size: { width: 0, height: 0 } }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LAYOUT" }));
  });
});

describe("resize and registration ownership", () => {
  it("stops resizing once the item is no longer resizable", () => {
    const { registry, registration } = setup();
    registry.detach("image-b");
    registry.resize("image-b", { width: 100, height: 100 });

    registration.update({ resizable: false });

    expect(registry.get("image-b")).toMatchObject({
      status: "detached",
      layout: { size: { width: 100, height: 100 } },
    });
    expect(() =>
      registry.resize("image-b", { width: 120, height: 120 }),
    ).toThrowError(expect.objectContaining({ code: "NOT_RESIZABLE" }));
  });

  it("does not carry a resized layout over to a replacement registration", () => {
    const { registry, registration } = setup();
    registry.detach("image-b");
    registry.resize("image-b", { width: 100, height: 100 });
    registration.unregister();

    registry.register({ id: "image-b", capabilities: ALL });
    registration.update({ resizable: false });

    expect(registry.get("image-b")).toMatchObject({
      status: "attached",
      capabilities: { resizable: true },
      layout: { size: null },
    });
  });

  it("keeps resized layouts isolated between registries", () => {
    const first = new SpatialRegistry();
    const second = new SpatialRegistry();
    for (const registry of [first, second]) {
      registry.register({ id: "image-b", capabilities: ALL });
      registry.detach("image-b");
    }

    first.resize("image-b", { width: 100, height: 100 });

    expect(second.get("image-b")?.layout.size).toBeNull();
  });
});
