import { describe, expect, it } from "vitest";
import { ItemManipulator, type ManipulablePresentation } from "./index.js";

const presentation = (
  presentationId: string,
  kind: "native" | "adaptive" = "native",
): ManipulablePresentation => ({
  itemId: "card",
  presentationId,
  registrationId: "card:1",
  kind,
  initial: { position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: 1 },
  extent: { width: 0.6, height: 0.4 },
});
const ray = (x: number) => ({
  origin: [x, 1, 0] as const,
  direction: [0, 0, -1] as const,
});

describe("ItemManipulator (public SDK export)", () => {
  it("addresses the current presentation of an item by item id", () => {
    const items = new ItemManipulator();
    items.sync([presentation("native-1")]);
    expect(items.items("native")).toEqual(["card"]);
    const token = items.begin("card", "translate", 1, ray(0))!;
    items.update(token, ray(0.3));
    items.end(token, true);
    expect(items.poseOf("card")!.position[0]).toBeCloseTo(0.3, 12);
    expect(items.getSnapshot()).toMatchObject({
      active: null,
      selected: "card",
    });
  });

  it("rejects input of an ended presentation; a new one starts at its own pose", () => {
    const items = new ItemManipulator();
    items.sync([presentation("native-1")]);
    const token = items.begin("card", "translate", 1, ray(0))!;
    items.sync([presentation("presentation-2", "adaptive")]);
    items.update(token, ray(0.5));
    items.end(token, true);
    expect(items.poseOf("card")).toEqual(presentation("x").initial);
    expect(items.targets()).toMatchObject([
      { itemId: "card", presentationId: "presentation-2", kind: "adaptive" },
    ]);
  });

  it("keyboard steps commit or revert; dispose detaches everything", () => {
    const items = new ItemManipulator();
    items.sync([presentation("native-1")]);
    expect(items.nudge("card", "rotate", "right", true)).not.toBeNull();
    expect(items.endKeyboard("card", false)).toBe(true);
    expect(items.poseOf("card")!.rotation).toEqual([0, 0, 0, 1]);
    items.nudge("card", "resize", "up", false);
    items.endKeyboard("card", true);
    expect(items.poseOf("card")!.scale).toBeCloseTo(1.1, 12);
    items.dispose();
    expect(items.poseOf("card")).toBeUndefined();
    expect(items.begin("card", "translate", 1, ray(0))).toBeNull();
  });
});
