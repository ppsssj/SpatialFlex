import { describe, expect, it } from "vitest";
import {
  assertExtraction,
  defaultPresentation,
  presentationSupport,
  validateExtraction,
  validatePresentationStrategy,
  type ExtractionContext,
} from "./presentation";
import { SpatialRegistry } from "./registry";
import { validateDetachmentStrategy } from "./strategies";

const FULL: ExtractionContext = {
  detachable: true,
  hasView: true,
  nativeHost: true,
};

describe("presentation strategy contract", () => {
  for (const presentation of ["native", "adaptive"] as const)
    for (const source of ["visible", "reserved", "collapsed"] as const)
      it(`${presentation} + ${source} is explicitly accepted or rejected`, () => {
        const supported =
          (presentation === "native" && source !== "visible") ||
          (presentation === "adaptive" && source !== "collapsed");
        const result = validateExtraction({ presentation, source }, FULL);
        expect(result.supported).toBe(supported);
        if (result.supported)
          expect(result.value).toEqual({ presentation, source });
        else {
          expect(result.reason.length).toBeGreaterThan(20);
          expect(() =>
            assertExtraction({ presentation, source }, FULL),
          ).toThrowError(
            expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }),
          );
        }
      });

  it("is a separate dimension from the source layout policy", () => {
    // P1-05 strategies are unchanged by the new presentation contract.
    expect(
      validateDetachmentStrategy({
        mode: "move",
        source: "collapse",
        target: "xr",
      }).supported,
    ).toBe(false);
    expect(validatePresentationStrategy("reserved").supported).toBe(false);
  });

  it("adaptive requires a declared XR view; native does not", () => {
    const noView = { ...FULL, hasView: false };
    expect(presentationSupport("adaptive", noView)).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/SpatialItem xr/),
    });
    expect(presentationSupport("native", noView)).toEqual({ supported: true });
  });

  it("native requires a detachable item and a DOM compositor host", () => {
    expect(
      presentationSupport("native", { ...FULL, detachable: false }),
    ).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/detachable/),
    });
    expect(
      presentationSupport("native", { ...FULL, nativeHost: false }),
    ).toMatchObject({
      supported: false,
      reason: expect.stringMatching(/compositor/),
    });
    expect(
      presentationSupport("adaptive", { ...FULL, nativeHost: false }),
    ).toEqual({
      supported: true,
    });
  });

  it.each([
    null,
    "native",
    {},
    { presentation: "native" },
    { presentation: "teleport", source: "reserved" },
    { presentation: "native", source: "placeholder" },
    { presentation: { toString: (): string => "native" }, source: "reserved" },
  ])("rejects malformed requests %j without coercion", (value) => {
    expect(validateExtraction(value, FULL).supported).toBe(false);
  });

  it("defaults to adaptive with an XR view and native without one", () => {
    expect(defaultPresentation(undefined, true)).toBe("adaptive");
    expect(defaultPresentation(undefined, false)).toBe("native");
    expect(defaultPresentation("native", true)).toBe("native");
  });
});

describe("SpatialRegistry presentation declarations", () => {
  it("are scoped to the registration and removed with it", () => {
    const registry = new SpatialRegistry();
    const first = registry.register({ id: "card" });
    let notified = 0;
    registry.subscribe(() => notified++);
    expect(registry.presentationOf("card")).toBeUndefined();
    first.setPresentation("native");
    expect(registry.presentationOf("card")).toBe("native");
    first.setPresentation("native");
    expect(notified).toBe(1);
    expect(() => first.setPresentation("teleport" as never)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }),
    );
    first.unregister();
    expect(registry.presentationOf("card")).toBeUndefined();
    const second = registry.register({ id: "card" });
    // A stale handle cannot change the new registration.
    first.setPresentation("adaptive");
    expect(registry.presentationOf("card")).toBeUndefined();
    second.setPresentation("adaptive");
    expect(registry.presentationOf("card")).toBe("adaptive");
    second.setPresentation(undefined);
    expect(registry.presentationOf("card")).toBeUndefined();
  });
});
