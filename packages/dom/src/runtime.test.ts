// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindNativeHandles,
  NativeCompositor,
  projectPoint,
  viewportClipPath,
  viewportPanelTransform,
  type CameraFrame,
  type NativeHandleManipulation,
  type NativeIssues,
  type SpatialWebSurfacePose,
} from "./index.js";

/** A camera at `eye` looking down -z (column-major perspective × view). */
function cameraFrame(
  viewport = { left: 100, top: 50, width: 800, height: 600 },
  eye: [number, number, number] = [0, 1.5, 1],
): CameraFrame {
  const fov = (50 * Math.PI) / 180;
  const f = 1 / Math.tan(fov / 2);
  const aspect = viewport.width / viewport.height;
  const near = 0.01,
    far = 100;
  const p = [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ];
  // View: translate by -eye (no rotation).
  const v = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1];
  const m = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        m[c * 4 + r]! += p[k * 4 + r]! * v[c * 4 + k]!;
  return { viewProjection: m, viewport, eye };
}

/** Applies a CSS matrix3d string to a local point (as the browser does). */
function applyMatrix3d(matrix: string, u: number, v: number) {
  const m = matrix.slice("matrix3d(".length, -1).split(",").map(Number);
  const x = m[0]! * u + m[4]! * v + m[12]!;
  const y = m[1]! * u + m[5]! * v + m[13]!;
  const w = m[3]! * u + m[7]! * v + m[15]!;
  return { x: x / w, y: y / w };
}

const pose: SpatialWebSurfacePose = {
  position: [0.2, 1.4, -1],
  rotation: [0, 0.3, 0],
  width: 0.6,
  height: 0.4,
};
const resolution = { width: 300, height: 200 };

describe("viewport placement (no transformed page)", () => {
  it("maps the element's corners exactly where the world corners project", () => {
    const frame = cameraFrame();
    const placed = viewportPanelTransform(frame, { pose, resolution });
    if (placed.visibility !== "visible") throw new Error(placed.visibility);
    const right = [Math.cos(0.3), 0, -Math.sin(0.3)];
    const corner = (u: number, v: number) =>
      [0, 1, 2].map(
        (i) =>
          pose.position[i]! +
          right[i]! * (u / resolution.width - 0.5) * pose.width +
          (i === 1 ? (0.5 - v / resolution.height) * pose.height : 0),
      ) as [number, number, number];
    for (const [u, v] of [
      [0, 0],
      [300, 0],
      [300, 200],
      [0, 200],
      [120, 80],
    ] as const) {
      const expected = projectPoint(frame, corner(u, v))!;
      const actual = applyMatrix3d(placed.matrix3d, u, v);
      // projectPoint is viewport-relative; the element's containing block
      // is the client viewport.
      expect(actual.x).toBeCloseTo(expected.x + frame.viewport.left, 6);
      expect(actual.y).toBeCloseTo(expected.y + frame.viewport.top, 6);
    }
  });

  it("reports panels seen from behind or behind the camera", () => {
    const back = viewportPanelTransform(cameraFrame(), {
      pose: { ...pose, rotation: [0, Math.PI, 0] },
      resolution,
    });
    expect(back.visibility).toBe("back");
    const behind = viewportPanelTransform(cameraFrame(), {
      pose: { ...pose, position: [0, 1.5, 3] },
      resolution,
    });
    expect(behind.visibility).not.toBe("visible");
  });

  it("clips to the canvas and cuts occluders in front, nothing otherwise", () => {
    const frame = cameraFrame();
    expect(viewportClipPath(frame, pose, resolution, [])).toBe("none");
    // Partly left of the canvas: a polygon inside the element's box.
    const edge = { ...pose, position: [-1.1, 1.4, -1] as const };
    const clipped = viewportClipPath(frame, edge, resolution, []);
    expect(clipped).toMatch(/^polygon\(evenodd, /);
    // A rectangle 20 cm in front of the panel's center: a hole.
    const hole = viewportClipPath(
      frame,
      { ...pose, rotation: [0, 0, 0] },
      resolution,
      [{ center: [0.2, 1.4, -0.8], width: 0.1, height: 0.1 }],
    );
    expect(hole.match(/0px 0px/g)!.length).toBeGreaterThanOrEqual(3);
    // Behind the panel: no hole.
    expect(
      viewportClipPath(frame, { ...pose, rotation: [0, 0, 0] }, resolution, [
        { center: [0.2, 1.4, -1.3], width: 0.1, height: 0.1 },
      ]),
    ).toBe("none");
  });
});

describe("NativeCompositor", () => {
  let element: HTMLElement;
  let wrapper: HTMLElement;
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    wrapper = document.createElement("section");
    element = document.createElement("div");
    wrapper.append(element);
    document.body.append(wrapper);
  });
  afterEach(() => {
    wrapper.remove();
    vi.restoreAllMocks();
  });
  const placement = () => ({
    position: [0.2, 1.4, -1] as const,
    rotation: [0, 0, 0, 1] as const,
    scale: 1,
    metersPerPixel: 0.002,
  });

  it("hides a new element until placed, places it, and releases only its own styles", () => {
    const compositor = new NativeCompositor();
    compositor.setTargets([{ id: "card", element, placement }]);
    expect(element.dataset.spatialVisibility).toBe("hidden");
    expect(
      document.getElementById("spatialflex-native-visibility")?.textContent,
    ).toContain('[data-spatial-visibility="hidden"]{visibility:hidden}');
    compositor.composite(cameraFrame());
    expect(element.style.transform).toMatch(/^matrix3d\(/);
    expect(element.dataset).toMatchObject({
      spatialVisibility: "visible",
      spatialPlaced: "",
    });
    const written = JSON.parse(element.dataset.spatialPose!);
    expect(written).toMatchObject({
      position: [0.2, 1.4, -1],
      width: 0.6,
      height: 0.4,
      resolution: { width: 300, height: 200 },
    });
    // Another owner changes the clip; the application has its own inline
    // visibility. Restore removes only what the compositor still owns.
    element.style.clipPath = "inset(1px)";
    element.style.visibility = "hidden";
    compositor.setTargets([]);
    expect(element.style.transform).toBe("");
    expect(element.style.clipPath).toBe("inset(1px)");
    expect(element.style.visibility).toBe("hidden");
    expect(Object.keys(element.dataset)).toEqual([]);
  });

  it("uniform scale grows the world size, never the CSS size", () => {
    const compositor = new NativeCompositor();
    compositor.setTargets([
      {
        id: "card",
        element,
        placement: () => ({ ...placement(), scale: 1.5 }),
      },
    ]);
    compositor.composite(cameraFrame());
    const written = JSON.parse(element.dataset.spatialPose!);
    expect(written.width).toBeCloseTo(0.9, 12);
    expect(written.height).toBeCloseTo(0.6, 12);
    expect(written.resolution).toEqual({ width: 300, height: 200 });
    expect(element.style.width).toBe("");
  });

  it("refuses an ancestor that breaks containment, reporting it, and recovers", () => {
    const reports: NativeIssues[] = [];
    const compositor = new NativeCompositor({
      onIssues: (issues) => reports.push(issues),
    });
    wrapper.style.filter = "blur(1px)";
    compositor.setTargets([{ id: "card", element, placement }]);
    compositor.composite(cameraFrame());
    expect(element.style.transform).toBe("");
    expect(element.dataset.spatialIssue).toBe("containing-block");
    expect(element.dataset.spatialVisibility).toBe("hidden");
    expect(element.dataset.spatialPlaced).toBeUndefined();
    expect(reports.at(-1)!.get("card")).toMatchObject([
      { element: "section", property: "filter", effect: "containing-block" },
    ]);
    // Ancestor styles are walked when compositing starts: a new extraction
    // of the same element (setTargets after a release) sees the change.
    wrapper.style.filter = "";
    compositor.setTargets([]);
    compositor.setTargets([{ id: "card", element, placement }]);
    compositor.composite(cameraFrame());
    expect(element.dataset.spatialIssue).toBeUndefined();
    expect(element.style.transform).toMatch(/^matrix3d\(/);
    expect(reports.at(-1)!.size).toBe(0);
  });

  it("releases a replaced element and everything on dispose", () => {
    const compositor = new NativeCompositor();
    const other = document.createElement("div");
    wrapper.append(other);
    compositor.setTargets([{ id: "card", element, placement }]);
    compositor.composite(cameraFrame());
    compositor.setTargets([{ id: "card", element: other, placement }]);
    compositor.composite(cameraFrame());
    expect(element.style.transform).toBe("");
    expect(Object.keys(element.dataset)).toEqual([]);
    expect(other.style.transform).toMatch(/^matrix3d\(/);
    compositor.dispose();
    expect(other.style.transform).toBe("");
    expect(Object.keys(other.dataset)).toEqual([]);
  });

  it("an unplaced target stays hidden", () => {
    const compositor = new NativeCompositor();
    compositor.setTargets([
      { id: "card", element, placement: () => undefined },
    ]);
    compositor.composite(cameraFrame());
    expect(element.dataset.spatialVisibility).toBe("hidden");
    expect(element.style.transform).toBe("");
  });
});

describe("bindNativeHandles", () => {
  function manipulation() {
    const listeners = new Set<() => void>();
    let snapshot: ReturnType<NativeHandleManipulation["getSnapshot"]> = {
      active: null,
      selected: null,
    };
    return {
      begin: vi.fn(() => 1),
      update: vi.fn(),
      end: vi.fn(),
      nudge: vi.fn(() => 2),
      endKeyboard: vi.fn(() => true),
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      getSnapshot: () => snapshot,
      emit(next: typeof snapshot) {
        snapshot = next;
        for (const l of listeners) l();
      },
      listeners,
    };
  }
  const ray = { origin: [0, 0, 0] as const, direction: [0, 0, -1] as const };
  const panel = () => {
    const element = document.createElement("div");
    element.innerHTML =
      '<div data-spatialflex-handle="translate"><span data-spatialflex-handle="translate" role="button" tabindex="0">Card</span><button>Attach</button></div>' +
      '<input data-testid="field"><span data-spatialflex-handle="rotate" role="button" tabindex="0">R</span>';
    document.body.append(element);
    return element;
  };
  const press = (target: Element) =>
    target.dispatchEvent(
      Object.assign(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
        { pointerId: 1 },
      ),
    );

  it("handles start sessions; controls inside handles and content do not", () => {
    const m = manipulation();
    const element = panel();
    const binding = bindNativeHandles(m, [{ id: "card", element }], () => ray);
    press(element.querySelector("button")!);
    press(element.querySelector("input")!);
    expect(m.begin).not.toHaveBeenCalled();
    press(element.querySelector('[data-spatialflex-handle="rotate"]')!);
    expect(m.begin).toHaveBeenCalledWith("card", "rotate", 1, ray);
    binding.dispose();
    // The drag in progress was cancelled by dispose.
    expect(m.end).toHaveBeenCalledWith(1, false);
    element.remove();
  });

  it("keyboard steps on a focused handle; feedback attributes follow the snapshot", () => {
    const m = manipulation();
    const element = panel();
    const binding = bindNativeHandles(m, [{ id: "card", element }], () => ray);
    const rotate = element.querySelector<HTMLElement>(
      '[data-spatialflex-handle="rotate"]',
    )!;
    rotate.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(m.nudge).toHaveBeenCalledWith("card", "rotate", "right", false);
    // Typing in a field is not a handle.
    element
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    expect(m.nudge).toHaveBeenCalledTimes(1);
    m.emit({ active: { itemId: "card", mode: "rotate" }, selected: "card" });
    expect(element.dataset).toMatchObject({
      manipulating: "rotate",
      manipulationSelected: "",
    });
    binding.dispose();
    expect(Object.keys(element.dataset)).toEqual([]);
    expect(m.listeners.size).toBe(0);
    element.remove();
  });
});
