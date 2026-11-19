import { describe, expect, it, vi } from "vitest";
import { SpatialFlexError } from "./errors";
import { SpatialRegistry } from "./registry";

describe("SpatialRegistry", () => {
  describe("registration and lookup", () => {
    it("registers an item and looks it up by ID", () => {
      const registry = new SpatialRegistry();
      registry.register({ id: "image-a" });

      expect(registry.has("image-a")).toBe(true);
      expect(registry.get("image-a")).toEqual({
        id: "image-a",
        capabilities: { detachable: false, movable: false, resizable: false },
        status: "attached",
        layout: { position: null, size: null, visible: true },
      });
      expect(registry.get("missing")).toBeUndefined();
    });

    it("lists items in registration order", () => {
      const registry = new SpatialRegistry();
      registry.register({ id: "image-a" });
      registry.register({ id: "image-b" });
      registry.register({ id: "image-c" });

      expect(registry.list().map((item) => item.id)).toEqual([
        "image-a",
        "image-b",
        "image-c",
      ]);
    });

    it.each(["", "   ", undefined, 42])("rejects invalid ID %j", (id) => {
      const registry = new SpatialRegistry();

      expect(() => registry.register({ id: id as string })).toThrowError(
        expect.objectContaining({ code: "INVALID_ITEM_ID" }),
      );
      expect(registry.list()).toEqual([]);
    });
  });

  describe("duplicate IDs", () => {
    it("rejects a duplicate ID without overwriting the existing item", () => {
      const registry = new SpatialRegistry();
      registry.register({ id: "image-a", capabilities: { movable: true } });

      let error: unknown;
      try {
        registry.register({ id: "image-a", capabilities: { movable: false } });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(SpatialFlexError);
      expect(error).toMatchObject({ code: "DUPLICATE_ITEM_ID" });
      expect(registry.list()).toHaveLength(1);
      expect(registry.get("image-a")?.capabilities.movable).toBe(true);
    });

    it("allows an ID to be registered again after it was removed", () => {
      const registry = new SpatialRegistry();
      registry.register({ id: "image-a" }).unregister();

      expect(() => registry.register({ id: "image-a" })).not.toThrow();
    });
  });

  describe("unregistration", () => {
    it("removes the item through its registration handle", () => {
      const registry = new SpatialRegistry();
      const registration = registry.register({ id: "image-a" });

      registration.unregister();

      expect(registry.has("image-a")).toBe(false);
      expect(registry.list()).toEqual([]);
    });

    it("removes the item by ID", () => {
      const registry = new SpatialRegistry();
      registry.register({ id: "image-a" });

      expect(registry.unregister("image-a")).toBe(true);
      expect(registry.unregister("image-a")).toBe(false);
      expect(registry.has("image-a")).toBe(false);
    });

    it("ignores a stale handle after the ID is registered again", () => {
      const registry = new SpatialRegistry();
      const stale = registry.register({ id: "image-a" });
      stale.unregister();
      registry.register({ id: "image-a", capabilities: { movable: true } });

      stale.unregister();
      stale.update({ movable: false });

      expect(registry.get("image-a")?.capabilities.movable).toBe(true);
    });
  });

  describe("metadata", () => {
    it("defaults capabilities to false and applies the ones given", () => {
      const registry = new SpatialRegistry();
      registry.register({
        id: "image-a",
        capabilities: { detachable: true, resizable: true },
      });

      expect(registry.get("image-a")?.capabilities).toEqual({
        detachable: true,
        movable: false,
        resizable: true,
      });
    });

    it("updates capabilities in place, keeping registration order", () => {
      const registry = new SpatialRegistry();
      const a = registry.register({ id: "image-a" });
      registry.register({ id: "image-b" });
      const before = registry.get("image-a");

      a.update({ movable: true });

      const after = registry.get("image-a");
      expect(after).not.toBe(before);
      expect(after?.capabilities).toEqual({
        detachable: false,
        movable: true,
        resizable: false,
      });
      expect(registry.list().map((item) => item.id)).toEqual([
        "image-a",
        "image-b",
      ]);
    });

    it("produces immutable, JSON-serializable records", () => {
      const registry = new SpatialRegistry();
      registry.register({ id: "image-a", capabilities: { detachable: true } });
      const record = registry.get("image-a")!;

      expect(JSON.parse(JSON.stringify(record))).toEqual(record);
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.capabilities)).toBe(true);
      expect(Object.isFrozen(record.layout)).toBe(true);
      expect(Object.isFrozen(registry.list())).toBe(true);
    });
  });

  describe("subscriptions and snapshots", () => {
    it("notifies listeners on every change until unsubscribed", () => {
      const registry = new SpatialRegistry();
      const listener = vi.fn();
      const unsubscribe = registry.subscribe(listener);

      const registration = registry.register({ id: "image-a" });
      registration.update({ movable: true });
      registration.unregister();
      expect(listener).toHaveBeenCalledTimes(3);

      unsubscribe();
      registry.register({ id: "image-b" });
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("does not notify or change snapshots for no-op operations", () => {
      const registry = new SpatialRegistry();
      const registration = registry.register({
        id: "image-a",
        capabilities: { movable: true },
      });
      const listener = vi.fn();
      registry.subscribe(listener);
      const snapshot = registry.list();

      registration.update({ movable: true });
      registry.unregister("missing");

      expect(listener).not.toHaveBeenCalled();
      expect(registry.list()).toBe(snapshot);
    });

    it("returns a new list snapshot only after a change", () => {
      const registry = new SpatialRegistry();
      const empty = registry.list();
      expect(registry.list()).toBe(empty);

      registry.register({ id: "image-a" });
      const one = registry.list();
      expect(one).not.toBe(empty);
      expect(registry.list()).toBe(one);
    });
  });

  it("keeps separate registries isolated", () => {
    const first = new SpatialRegistry();
    const second = new SpatialRegistry();

    first.register({ id: "image-a" });

    expect(second.has("image-a")).toBe(false);
    expect(() => second.register({ id: "image-a" })).not.toThrow();
    expect(first.list()).toHaveLength(1);
    expect(second.list()).toHaveLength(1);
  });
});

describe("registration identity (registrationOf)", () => {
  it("is unique per registration, across registries, and never reused", () => {
    const a = new SpatialRegistry();
    const b = new SpatialRegistry();
    const first = a.register({
      id: "card",
      capabilities: { detachable: true },
    });
    const key = a.registrationOf("card")!;
    expect(key).toMatch(/^\d+\/\d+$/);
    b.register({ id: "card" });
    expect(b.registrationOf("card")).not.toBe(key);
    // Stable while the registration lives, through any change.
    a.detach("card");
    a.attach("card");
    first.setView({ body: { kind: "value", label: "x", value: "1" } });
    first.setView(undefined);
    expect(a.registrationOf("card")).toBe(key);
    // A new registration under the same id is a new identity.
    first.unregister();
    expect(a.registrationOf("card")).toBeUndefined();
    a.register({ id: "card" });
    expect(a.registrationOf("card")).not.toBe(key);
    expect(a.registrationOf("other")).toBeUndefined();
  });

  it("an old handle cannot unregister the new registration", () => {
    const registry = new SpatialRegistry();
    const old = registry.register({ id: "card" });
    old.unregister();
    registry.register({ id: "card" });
    const key = registry.registrationOf("card");
    old.unregister();
    expect(registry.registrationOf("card")).toBe(key);
  });
});
