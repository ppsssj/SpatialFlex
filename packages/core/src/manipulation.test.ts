import { describe, expect, it } from "vitest";
import {
  IDENTITY_ROTATION,
  KEYBOARD_STEPS,
  SCALE_LIMITS,
  SpatialManipulator,
  rotateVector,
  transformPoint,
  validateTransform,
  yawOf,
  yawQuaternion,
  type SpatialRay,
  type SpatialTransform,
  type SpatialVector3,
} from "./manipulation";

const EYE: SpatialVector3 = [0, 0, 0];
/** A ray from the eye through a world point. */
const toward = (point: SpatialVector3): SpatialRay => ({
  origin: EYE,
  direction: point,
});
/** A ray straight down -z through (x, y): the drag plane stays z-aligned. */
const down = (x: number, y: number): SpatialRay => ({
  origin: [x, y, 0],
  direction: [0, 0, -1],
});
const at = (position: SpatialVector3, scale = 1): SpatialTransform => ({
  position,
  rotation: IDENTITY_ROTATION,
  scale,
});
const EXTENT = { width: 0.6, height: 0.4 };

function setup(position: SpatialVector3 = [0, 0, -2]) {
  const m = new SpatialManipulator();
  m.attach("p1", {
    registrationId: "card",
    initial: at(position),
    extent: EXTENT,
  });
  return m;
}

const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

describe("spatial transform contract", () => {
  it("accepts finite transforms and normalizes the rotation", () => {
    const result = validateTransform({
      position: [1, 2, 3],
      rotation: [0, 2, 0, 0],
      scale: 1.5,
    });
    expect(result.supported).toBe(true);
    if (result.supported) {
      expect(result.value.rotation).toEqual([0, 1, 0, 0]);
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it.each([
    null,
    "transform",
    { position: [0, 0], rotation: [0, 0, 0, 1], scale: 1 },
    { position: [0, NaN, 0], rotation: [0, 0, 0, 1], scale: 1 },
    { position: [0, Infinity, 0], rotation: [0, 0, 0, 1], scale: 1 },
    { position: [0, 0, 0], rotation: [0, 0, 0, 0], scale: 1 },
    { position: [0, 0, 0], rotation: [0, 0, NaN, 1], scale: 1 },
    { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: 0 },
    { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: -1 },
    { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: NaN },
    { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: Infinity },
    { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: "1" },
    {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: SCALE_LIMITS.max * 2,
    },
    { position: ["0", 0, 0], rotation: [0, 0, 0, 1], scale: 1 },
  ])("rejects %j", (value) => {
    expect(validateTransform(value).supported).toBe(false);
  });

  it("rotates about +y with right-handed yaw", () => {
    const q = yawQuaternion(Math.PI / 2);
    close(rotateVector(q, [0, 0, 1]), [1, 0, 0]);
    expect(yawOf(q)).toBeCloseTo(Math.PI / 2);
    close(
      transformPoint({ position: [1, 0, 0], rotation: q, scale: 2 }, [0, 0, 1]),
      [3, 0, 0],
    );
  });

  it("rejects invalid presentations", () => {
    const m = new SpatialManipulator();
    expect(() =>
      m.attach("", {
        registrationId: "a",
        initial: at([0, 0, 0]),
        extent: EXTENT,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ITEM_ID" }));
    expect(() =>
      m.attach("p", {
        registrationId: "a",
        initial: { ...at([0, 0, 0]), scale: 0 },
        extent: EXTENT,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LAYOUT" }));
    expect(() =>
      m.attach("p", {
        registrationId: "a",
        initial: at([0, 0, 0]),
        extent: { width: 0, height: 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LAYOUT" }));
    m.attach("p", {
      registrationId: "a",
      initial: at([0, 0, 0]),
      extent: EXTENT,
    });
    expect(() =>
      m.attach("p", {
        registrationId: "a",
        initial: at([0, 0, 0]),
        extent: EXTENT,
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_ITEM_ID" }));
  });
});

describe("pointer manipulation", () => {
  it("translates so the grabbed point follows the ray (perspective-correct)", () => {
    for (const depth of [2, 4]) {
      const m = setup([0, 0, -depth]);
      const token = m.begin("p1", "translate", {
        pointerId: 1,
        ray: toward([0, 0, -1]),
      })!;
      expect(token).not.toBeNull();
      // The same angular pointer movement moves a farther panel farther.
      expect(m.update(token, toward([0.1, 0.05, -1]))).toBe(true);
      close(m.transform("p1")!.position, [0.1 * depth, 0.05 * depth, -depth]);
      expect(m.commit(token)).toBe(true);
      close(m.transform("p1")!.position, [0.1 * depth, 0.05 * depth, -depth]);
    }
  });

  it("keeps the grab offset: the panel does not jump to the pointer", () => {
    const m = setup();
    // Grab 0.2 m right of the center.
    const token = m.begin("p1", "translate", {
      pointerId: 1,
      ray: toward([0.2, 0, -2]),
    })!;
    m.update(token, toward([0.2, 0, -2]));
    close(m.transform("p1")!.position, [0, 0, -2]);
  });

  it("rotates by yaw from horizontal pointer movement", () => {
    const m = setup();
    const token = m.begin("p1", "rotate", {
      pointerId: 1,
      ray: toward([0, 0, -2]),
    })!;
    // One radius (half the width) to the right: one radian.
    m.update(token, toward([0.3, 0, -2]));
    expect(yawOf(m.transform("p1")!.rotation)).toBeCloseTo(1);
    close(m.transform("p1")!.position, [0, 0, -2]);
    m.update(token, toward([-0.15, 0, -2]));
    expect(yawOf(m.transform("p1")!.rotation)).toBeCloseTo(-0.5);
  });

  it("resizes uniformly around the center, within the limits", () => {
    const m = setup();
    const token = m.begin("p1", "resize", {
      pointerId: 1,
      ray: down(0.3, 0.2),
    })!;
    m.update(token, down(0.45, 0.3));
    expect(m.transform("p1")!.scale).toBeCloseTo(1.5);
    close(m.transform("p1")!.position, [0, 0, -2]);
    m.update(token, down(30, 20));
    expect(m.transform("p1")!.scale).toBe(SCALE_LIMITS.max);
    m.update(token, down(0.003, 0.002));
    expect(m.transform("p1")!.scale).toBe(SCALE_LIMITS.min);
    // Grabbing the exact center cannot define a resize ratio.
    m.cancel(token);
    expect(
      m.begin("p1", "resize", { pointerId: 1, ray: down(0, 0) }),
    ).toBeNull();
  });

  it("cancel returns to the start pose; commit keeps the result", () => {
    const m = setup();
    const t1 = m.begin("p1", "translate", {
      pointerId: 1,
      ray: toward([0, 0, -1]),
    })!;
    m.update(t1, toward([0.1, 0, -1]));
    expect(m.cancel(t1)).toBe(true);
    close(m.transform("p1")!.position, [0, 0, -2]);
    expect(m.active).toBeNull();
    const t2 = m.begin("p1", "translate", {
      pointerId: 1,
      ray: toward([0, 0, -1]),
    })!;
    m.update(t2, toward([0.1, 0, -1]));
    m.commit(t2);
    // Cancelling without a session changes nothing.
    expect(m.cancel()).toBe(false);
    close(m.transform("p1")!.position, [0.2, 0, -2]);
  });

  it("rejects duplicate presses, stale tokens and invalid input", () => {
    const m = setup();
    const token = m.begin("p1", "translate", {
      pointerId: 1,
      ray: toward([0, 0, -1]),
    })!;
    // A second press while a session is active.
    expect(
      m.begin("p1", "rotate", { pointerId: 2, ray: toward([0, 0, -1]) }),
    ).toBeNull();
    expect(m.update(token + 1, toward([0.1, 0, -1]))).toBe(false);
    for (const ray of [
      { origin: [0, 0, 0], direction: [0, 0, 0] },
      { origin: [0, NaN, 0], direction: [0, 0, -1] },
      { origin: [0, 0, 0], direction: [Infinity, 0, -1] },
      // Pointing away from the drag plane.
      toward([0, 0, 1]),
    ])
      expect(m.update(token, ray as SpatialRay)).toBe(false);
    close(m.transform("p1")!.position, [0, 0, -2]);
    m.commit(token);
    // After commit, the token is stale.
    expect(m.update(token, toward([0.1, 0, -1]))).toBe(false);
    expect(m.commit(token)).toBe(false);
    expect(m.cancel(token)).toBe(false);
    // Unknown presentations, modes and pointers cannot begin.
    expect(
      m.begin("nope", "translate", { pointerId: 1, ray: toward([0, 0, -1]) }),
    ).toBeNull();
    expect(
      m.begin("p1", "spin" as never, { pointerId: 1, ray: toward([0, 0, -1]) }),
    ).toBeNull();
    expect(
      m.begin("p1", "translate", { pointerId: NaN, ray: toward([0, 0, -1]) }),
    ).toBeNull();
    // A ray pointing away from the panel cannot grab it.
    expect(
      m.begin("p1", "translate", { pointerId: 1, ray: toward([0, 0, 1]) }),
    ).toBeNull();
  });

  it("an ended presentation's input never reaches a new instance of the component", () => {
    const m = new SpatialManipulator();
    const detachNative = m.attach("native-1", {
      registrationId: "card",
      initial: at([0, 0, -2]),
      extent: EXTENT,
    });
    const token = m.begin("native-1", "translate", {
      pointerId: 1,
      ray: toward([0, 0, -1]),
    })!;
    // Restore (or Native → Adaptive) ends the instance mid-drag.
    detachNative();
    expect(m.active).toBeNull();
    m.attach("presentation-2", {
      registrationId: "card",
      initial: at([1, 0, -2]),
      extent: EXTENT,
    });
    expect(m.update(token, toward([0.3, 0, -1]))).toBe(false);
    expect(m.commit(token)).toBe(false);
    close(m.transform("presentation-2")!.position, [1, 0, -2]);
    // The old detach function cannot remove the new instance either.
    detachNative();
    expect(m.has("presentation-2")).toBe(true);
    // A new extraction starts from its own initial pose.
    expect(m.target("presentation-2")!.initial.position).toEqual([1, 0, -2]);
  });

  it("reset returns to the instance's initial pose", () => {
    const m = setup();
    const token = m.begin("p1", "translate", {
      pointerId: 1,
      ray: toward([0, 0, -1]),
    })!;
    m.update(token, toward([0.1, 0, -1]));
    m.commit(token);
    expect(m.reset("p1")).toBe(true);
    expect(m.transform("p1")).toEqual(m.target("p1")!.initial);
    expect(m.reset("nope")).toBe(false);
  });

  it("manipulates presentations independently", () => {
    const m = setup();
    m.attach("p2", {
      registrationId: "chart",
      initial: at([1, 0, -2]),
      extent: EXTENT,
    });
    const token = m.begin("p2", "translate", {
      pointerId: 1,
      ray: down(1, 0),
    })!;
    m.update(token, down(1.5, 0));
    m.commit(token);
    close(m.transform("p2")!.position, [1.5, 0, -2]);
    close(m.transform("p1")!.position, [0, 0, -2]);
    expect(m.selected).toBe("p2");
    expect(m.targets().map((t) => t.presentationId)).toEqual(["p1", "p2"]);
  });

  it("notifies subscribers with a new snapshot", () => {
    const m = setup();
    const seen: number[] = [];
    const unsubscribe = m.subscribe(() => seen.push(m.getSnapshot().version));
    const token = m.begin("p1", "rotate", {
      pointerId: 7,
      ray: toward([0, 0, -1]),
    })!;
    expect(m.getSnapshot().active).toMatchObject({
      token,
      presentationId: "p1",
      registrationId: "card",
      mode: "rotate",
      input: "pointer",
      pointerId: 7,
    });
    m.commit(token);
    unsubscribe();
    m.reset("p1");
    expect(seen).toHaveLength(2);
    expect(seen[1]!).toBeGreaterThan(seen[0]!);
  });
});

describe("layout placement shift", () => {
  it("moves the initial and current pose together", () => {
    const m = setup();
    m.nudge("p1", "translate", "right");
    expect(m.shift("p1", [0, 0.5, 0])).toBe(true);
    close(m.transform("p1")!.position, [KEYBOARD_STEPS.translate[0], 0.5, -2]);
    close(m.target("p1")!.initial.position, [0, 0.5, -2]);
    // The keyboard session continues from the shifted start.
    m.cancel();
    close(m.transform("p1")!.position, [0, 0.5, -2]);
    expect(m.shift("p1", [NaN, 0, 0])).toBe(false);
    expect(m.shift("nope", [0, 0, 0])).toBe(false);
  });

  it("ends a pointer drag whose grab plane no longer matches", () => {
    const m = setup();
    const token = m.begin("p1", "translate", {
      pointerId: 1,
      ray: down(0, 0),
    })!;
    m.update(token, down(0.1, 0));
    m.shift("p1", [1, 0, 0]);
    expect(m.active).toBeNull();
    expect(m.update(token, down(0.3, 0))).toBe(false);
    close(m.transform("p1")!.position, [1.1, 0, -2]);
  });
});

describe("keyboard manipulation", () => {
  it("steps through the same controller; Escape (cancel) restores", () => {
    const m = setup();
    const token = m.nudge("p1", "translate", "right")!;
    m.nudge("p1", "translate", "up", true);
    close(m.transform("p1")!.position, [
      KEYBOARD_STEPS.translate[0],
      KEYBOARD_STEPS.translate[1],
      -2,
    ]);
    m.nudge("p1", "rotate", "left");
    expect(yawOf(m.transform("p1")!.rotation)).toBeCloseTo(
      -KEYBOARD_STEPS.rotate[0],
    );
    expect(m.nudge("p1", "rotate", "up")).toBeNull();
    m.nudge("p1", "resize", "up");
    expect(m.transform("p1")!.scale).toBeCloseTo(KEYBOARD_STEPS.resize[0]);
    expect(m.active).toMatchObject({
      token,
      input: "keyboard",
      mode: "resize",
    });
    expect(m.cancel(token)).toBe(true);
    expect(m.transform("p1")).toEqual(m.target("p1")!.initial);
  });

  it("commits steps on a pointer press and never interrupts a pointer drag", () => {
    const m = setup();
    m.nudge("p1", "translate", "right");
    const token = m.begin("p1", "translate", {
      pointerId: 1,
      ray: toward([0, 0, -1]),
    })!;
    expect(token).not.toBeNull();
    expect(m.nudge("p1", "translate", "right")).toBeNull();
    m.cancel(token);
    // The keyboard step was committed before the press.
    close(m.transform("p1")!.position, [KEYBOARD_STEPS.translate[0], 0, -2]);
  });

  it("clamps keyboard resizing to the limits", () => {
    const m = setup();
    for (let i = 0; i < 30; i++) m.nudge("p1", "resize", "down", true);
    expect(m.transform("p1")!.scale).toBe(SCALE_LIMITS.min);
  });
});
