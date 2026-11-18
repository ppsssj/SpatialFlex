import { describe, expect, it } from "vitest";
import { SpatialRegistry } from "./registry";
import {
  assertSourceVisibility,
  validateSourceVisibility,
} from "./sourceVisibility";
import { validateDetachmentStrategy } from "./strategies";

describe("source visibility policy", () => {
  it.each(["visible", "reserved"] as const)("accepts %s", (value) => {
    expect(validateSourceVisibility(value)).toEqual({
      supported: true,
      visibility: value,
    });
    expect(assertSourceVisibility(value)).toBe(value);
  });

  it("rejects collapsed explicitly, with a reason", () => {
    const result = validateSourceVisibility("collapsed");
    expect(result.supported).toBe(false);
    expect(!result.supported && result.reason).toMatch(/not supported/);
    expect(() => assertSourceVisibility("collapsed")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }),
    );
  });

  it.each([
    undefined,
    null,
    "",
    "hidden",
    "VISIBLE",
    { toString: () => "visible" },
    1,
  ])("rejects malformed input %j without coercion", (value) => {
    expect(validateSourceVisibility(value).supported).toBe(false);
  });

  it("does not change the P1-05 detachment strategy matrix", () => {
    expect(
      validateDetachmentStrategy({
        mode: "mirror",
        source: "placeholder",
        target: "xr",
      }).supported,
    ).toBe(false);
  });
});

describe("SpatialRegistry.setSourceVisibility", () => {
  const setup = () => {
    const registry = new SpatialRegistry();
    const registration = registry.register({
      id: "card",
      capabilities: { detachable: true },
    });
    let notifications = 0;
    registry.subscribe(() => notifications++);
    return { registry, registration, notified: () => notifications };
  };

  it("reserves and restores an attached source as presentation metadata", () => {
    const { registry, notified } = setup();
    expect(registry.get("card")!.layout.visible).toBe(true);
    expect(registry.setSourceVisibility("card", "reserved")).toBe(true);
    expect(registry.get("card")).toMatchObject({
      status: "attached",
      layout: { visible: false },
    });
    expect(registry.setSourceVisibility("card", "reserved")).toBe(false);
    expect(registry.setSourceVisibility("card", "visible")).toBe(true);
    expect(registry.get("card")!.layout.visible).toBe(true);
    expect(notified()).toBe(2);
    expect(Object.isFrozen(registry.get("card")!.layout)).toBe(true);
  });

  it("rejects unknown ids and unsupported policies", () => {
    const { registry } = setup();
    expect(() => registry.setSourceVisibility("nope", "reserved")).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_ITEM_ID" }),
    );
    expect(() =>
      registry.setSourceVisibility("card", "collapsed" as never),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }));
    expect(registry.get("card")!.layout.visible).toBe(true);
  });

  it("never hides a moved source; moving a reserved source shows it", () => {
    const { registry } = setup();
    registry.setSourceVisibility("card", "reserved");
    registry.detach("card");
    expect(registry.get("card")).toMatchObject({
      status: "detached",
      layout: { visible: true },
    });
    expect(() => registry.setSourceVisibility("card", "reserved")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }),
    );
    expect(registry.setSourceVisibility("card", "visible")).toBe(false);
  });

  it("a remounted registration with the same id starts visible", () => {
    const { registry, registration } = setup();
    registry.setSourceVisibility("card", "reserved");
    registration.unregister();
    registry.register({ id: "card" });
    expect(registry.get("card")!.layout.visible).toBe(true);
  });
});
