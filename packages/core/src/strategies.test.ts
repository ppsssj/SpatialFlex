import { describe, expect, it } from "vitest";
import {
  assertDetachmentStrategy,
  validateDetachmentStrategy,
} from "./strategies";

describe("detachment strategies", () => {
  for (const mode of ["move", "mirror", "snapshot"] as const)
    for (const source of ["placeholder", "collapse", "visible"] as const)
      for (const target of ["web", "xr"] as const)
        it(`${mode} + ${source} + ${target} is explicitly accepted or rejected`, () => {
          const strategy = { mode, source, target };
          const supported =
            (mode === "move" && source !== "visible" && target === "web") ||
            (mode === "mirror" && source === "visible" && target === "xr");
          expect(validateDetachmentStrategy(strategy).supported).toBe(
            supported,
          );
          if (supported)
            expect(assertDetachmentStrategy(strategy)).toEqual(strategy);
          else
            expect(() => assertDetachmentStrategy(strategy)).toThrowError(
              expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }),
            );
        });
  it.each([
    { mode: Object.create(null), source: "visible", target: "xr" },
    {
      mode: {
        toString() {
          throw new Error("must not coerce");
        },
      },
      source: "visible",
      target: "xr",
    },
    null,
    undefined,
    {},
    "move",
    { mode: "teleport", source: "visible", target: "xr" },
  ])("rejects malformed runtime options %j", (value) => {
    expect(validateDetachmentStrategy(value).supported).toBe(false);
  });
});
