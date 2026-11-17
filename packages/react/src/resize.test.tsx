// @vitest-environment jsdom
import { SpatialRegistry } from "@spatialflex/core";
import { act, StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_PANEL_SIZE,
  SpatialItem,
  SpatialWorkspace,
  useSpatialController,
  type SpatialController,
} from "./index";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout. The slot reports the original placement; the panel
// reports its inline size when it has one, else its natural size.
const VIEWPORT = { width: 1024, height: 768 };
let slotRect = { left: 300, top: 120, width: 240, height: 190 };
const NATURAL_PANEL = { width: 240, height: 220 };
let captured: Set<number>;

beforeEach(() => {
  const root = document.documentElement;
  Object.defineProperty(root, "clientWidth", {
    configurable: true,
    get: () => VIEWPORT.width,
  });
  Object.defineProperty(root, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT.height,
  });
  slotRect = { left: 300, top: 120, width: 240, height: 190 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (!this.hasAttribute("data-spatialflex-panel")) {
        const { left, top, width, height } = slotRect;
        return DOMRect.fromRect({ x: left, y: top, width, height });
      }
      return DOMRect.fromRect({
        x: parseFloat(this.style.left) || 0,
        y: parseFloat(this.style.top) || 0,
        width: parseFloat(this.style.width) || NATURAL_PANEL.width,
        height: parseFloat(this.style.height) || NATURAL_PANEL.height,
      });
    },
  );
  // jsdom lacks pointer capture; track it to check that it is released.
  captured = new Set();
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: (id: number) => captured.add(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    hasPointerCapture: (id: number) => captured.has(id),
  });
});

let lifecycle: { mounts: number; unmounts: number };
function Probe() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    lifecycle.mounts++;
    return () => {
      lifecycle.unmounts++;
    };
  }, []);
  return (
    <button data-probe onClick={() => setCount((c) => c + 1)}>
      {count}
    </button>
  );
}

let controller: SpatialController;
function CaptureController() {
  const current = useSpatialController();
  useEffect(() => {
    controller = current;
  }, [current]);
  return null;
}

let root: Root | undefined;
let container: HTMLElement;
let registry: SpatialRegistry;

function render(ui: ReactNode = <View />) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root!.render(ui));
}

function View({ resizable = true }: { resizable?: boolean }) {
  return (
    <SpatialWorkspace registry={registry}>
      <CaptureController />
      <SpatialItem id="image-b" detachable movable resizable={resizable}>
        <Probe />
      </SpatialItem>
      <SpatialItem id="image-c" detachable movable>
        <p>C</p>
      </SpatialItem>
    </SpatialWorkspace>
  );
}

beforeEach(() => {
  lifecycle = { mounts: 0, unmounts: 0 };
  registry = new SpatialRegistry();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.restoreAllMocks();
});

const item = (id: string) =>
  container.querySelector<HTMLElement>(`[data-spatialflex-item="${id}"]`)!;
const panel = (id: string) =>
  item(id).querySelector<HTMLElement>("[data-spatialflex-panel]")!;
const handle = (id: string) =>
  item(id).querySelector<HTMLElement>("[data-spatialflex-resize-handle]");
const bar = (id: string) =>
  item(id).querySelector<HTMLElement>("[data-spatialflex-panel-bar]")!;
const sizeOf = (id: string) => registry.get(id)?.layout.size;

function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  pointerId = 1,
) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        // Like browsers: the primary button is pressed between down and up.
        buttons: type === "pointerdown" || type === "pointermove" ? 1 : 0,
        pointerId,
        clientX: x,
        clientY: y,
      }),
    );
  });
}

function resizeBy(dx: number, dy: number) {
  const target = handle("image-b")!;
  pointer(target, "pointerdown", 500, 400);
  pointer(target, "pointermove", 500 + dx, 400 + dy);
  pointer(target, "pointerup", 500 + dx, 400 + dy);
}

describe("resize handle", () => {
  it("is shown only for detached, resizable items", () => {
    render();
    expect(handle("image-b")).toBeNull();

    act(() => controller.detach("image-b"));
    act(() => controller.detach("image-c"));

    expect(handle("image-b")).not.toBeNull();
    expect(handle("image-c")).toBeNull();

    act(() => controller.attach("image-b"));
    expect(handle("image-b")).toBeNull();
  });

  it("resizes the panel with the pointer and releases pointer capture", () => {
    render();
    act(() => controller.detach("image-b"));

    const target = handle("image-b")!;
    pointer(target, "pointerdown", 500, 400);
    expect(captured.has(1)).toBe(true);
    pointer(target, "pointermove", 560, 440);
    expect(sizeOf("image-b")).toEqual({ width: 300, height: 260 });
    pointer(target, "pointerup", 560, 440);
    expect(captured.size).toBe(0);
    pointer(target, "pointermove", 900, 900);

    expect(sizeOf("image-b")).toEqual({ width: 300, height: 260 });
    expect(panel("image-b").style).toMatchObject({
      width: "300px",
      height: "260px",
      overflow: "hidden",
    });
  });

  it("keeps at least the minimum size", () => {
    render();
    act(() => controller.detach("image-b"));

    resizeBy(-1000, -1000);

    expect(sizeOf("image-b")).toEqual(MIN_PANEL_SIZE);
  });

  it("keeps the panel inside the viewport", () => {
    render();
    act(() => controller.detach("image-b"));

    resizeBy(5000, 5000);

    // Panel at (300, 120) in a 1024x768 viewport.
    expect(sizeOf("image-b")).toEqual({ width: 724, height: 648 });
  });

  it("re-fits the size when the window shrinks", () => {
    render();
    act(() => controller.detach("image-b"));
    resizeBy(300, 300);

    VIEWPORT.width = 700;
    VIEWPORT.height = 500;
    try {
      act(() => window.dispatchEvent(new Event("resize")));
    } finally {
      VIEWPORT.width = 1024;
      VIEWPORT.height = 768;
    }

    const { x, y } = registry.get("image-b")!.layout.position!;
    const { width, height } = sizeOf("image-b")!;
    expect(x + width).toBeLessThanOrEqual(700);
    expect(y + height).toBeLessThanOrEqual(500);
  });
});

describe("placeholder vs panel size", () => {
  it("keeps the original placeholder size while the panel is resized", () => {
    render();
    act(() => controller.detach("image-b"));

    resizeBy(100, 120);

    expect(sizeOf("image-b")).toEqual({ width: 340, height: 340 });
    expect(item("image-b").style).toMatchObject({
      width: "240px",
      height: "190px",
    });
  });

  it("restores the original layout on attach and the panel size on re-detach", () => {
    render();
    act(() => controller.detach("image-b"));
    resizeBy(100, 120);

    act(() => controller.attach("image-b"));
    expect(item("image-b").style.cssText).toBe("");
    expect(panel("image-b").style.cssText).toBe("");
    expect(sizeOf("image-b")).toEqual({ width: 340, height: 340 });

    // The page layout changed meanwhile: the placeholder is re-measured,
    // while the panel keeps its last size.
    slotRect = { ...slotRect, width: 200, height: 150 };
    act(() => controller.detach("image-b"));

    expect(item("image-b").style).toMatchObject({
      width: "200px",
      height: "150px",
    });
    expect(panel("image-b").style).toMatchObject({
      width: "340px",
      height: "340px",
    });
  });

  it("uses the original width as the natural panel size before any resize", () => {
    render();
    act(() => controller.detach("image-b"));

    expect(sizeOf("image-b")).toBeNull();
    expect(panel("image-b").style.width).toBe("240px");
    expect(panel("image-b").style.height).toBe("");
    expect(panel("image-b").style.overflow).toBe("");
  });
});

describe("interactions", () => {
  it("does not start a resize while dragging, or a drag while resizing", () => {
    render();
    act(() => controller.detach("image-b"));
    const start = registry.get("image-b")!.layout;

    pointer(bar("image-b"), "pointerdown", 310, 130, 1);
    pointer(handle("image-b")!, "pointerdown", 500, 400, 2);
    pointer(handle("image-b")!, "pointermove", 600, 500, 2);
    expect(sizeOf("image-b")).toBeNull();
    pointer(bar("image-b"), "pointermove", 330, 150, 1);
    expect(registry.get("image-b")!.layout.position).toEqual({
      x: 320,
      y: 140,
    });
    pointer(bar("image-b"), "pointerup", 330, 150, 1);

    pointer(handle("image-b")!, "pointerdown", 500, 400, 3);
    pointer(bar("image-b"), "pointerdown", 330, 150, 4);
    pointer(bar("image-b"), "pointermove", 400, 400, 4);
    expect(registry.get("image-b")!.layout.position).toEqual({
      x: 320,
      y: 140,
    });
    pointer(handle("image-b")!, "pointermove", 520, 410, 3);
    expect(sizeOf("image-b")).toEqual({ width: 260, height: 230 });
    pointer(handle("image-b")!, "pointerup", 520, 410, 3);

    expect(start.position).toEqual({ x: 300, y: 120 });
    expect(captured.size).toBe(0);
  });

  it("blocks native drag-and-drop only while dragging or resizing", () => {
    render();
    act(() => controller.detach("image-b"));
    const content = item("image-b").querySelector("[data-probe]")!;
    const dragstart = () => {
      const event = new Event("dragstart", { bubbles: true, cancelable: true });
      act(() => {
        content.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };

    expect(dragstart()).toBe(false);
    pointer(bar("image-b"), "pointerdown", 310, 130);
    expect(dragstart()).toBe(true);
    pointer(bar("image-b"), "pointerup", 310, 130);
    expect(dragstart()).toBe(false);
  });

  it("ends the interaction when pointer capture is lost", () => {
    render();
    act(() => controller.detach("image-b"));
    const target = handle("image-b")!;

    pointer(target, "pointerdown", 500, 400);
    pointer(target, "lostpointercapture", 500, 400);
    pointer(target, "pointermove", 600, 500);

    expect(sizeOf("image-b")).toBeNull();
    pointer(bar("image-b"), "pointerdown", 310, 130, 2);
    pointer(bar("image-b"), "pointermove", 320, 140, 2);
    expect(registry.get("image-b")!.layout.position).toEqual({
      x: 310,
      y: 130,
    });
  });

  it("ends the interaction when the button was released unseen", () => {
    render();
    act(() => controller.detach("image-b"));
    const target = handle("image-b")!;

    pointer(target, "pointerdown", 500, 400);
    pointer(target, "pointermove", 520, 420);
    expect(captured.has(1)).toBe(true);
    // No pointerup arrived; the next move has no button pressed.
    act(() => {
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          buttons: 0,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    expect(sizeOf("image-b")).toEqual({ width: 260, height: 240 });
    expect(captured.size).toBe(0);
    pointer(bar("image-b"), "pointerdown", 310, 130, 2);
    pointer(bar("image-b"), "pointermove", 320, 140, 2);
    expect(registry.get("image-b")!.layout.position).toEqual({
      x: 310,
      y: 130,
    });
  });

  it("clears an interaction that was cut short by attaching", () => {
    render();
    act(() => controller.detach("image-b"));
    pointer(handle("image-b")!, "pointerdown", 500, 400);

    act(() => controller.attach("image-b"));
    act(() => controller.detach("image-b"));
    resizeBy(20, 20);

    expect(sizeOf("image-b")).toEqual({ width: 260, height: 240 });
  });
});

describe("component identity", () => {
  it.each([
    ["without StrictMode", (ui: ReactNode) => ui, 1],
    ["in StrictMode", (ui: ReactNode) => <StrictMode>{ui}</StrictMode>, 2],
  ])("keeps the same instance through resizing %s", (_, wrap, mounts) => {
    render(wrap(<View />));
    const button = container.querySelector<HTMLButtonElement>("[data-probe]")!;
    for (let i = 0; i < 5; i++) act(() => button.click());

    act(() => controller.detach("image-b"));
    resizeBy(80, 60);
    resizeBy(-40, 10);
    act(() => button.click());
    act(() => controller.attach("image-b"));

    expect(container.querySelector("[data-probe]")).toBe(button);
    expect(button.textContent).toBe("6");
    expect(lifecycle).toEqual({ mounts, unmounts: mounts - 1 });
  });
});

describe("controller.resize errors", () => {
  it("rejects resizing attached and non-resizable items", () => {
    render(<View resizable={false} />);

    expect(() =>
      controller.resize("image-b", { width: 300, height: 300 }),
    ).toThrowError(expect.objectContaining({ code: "NOT_RESIZABLE" }));

    render(<View />);
    expect(() =>
      controller.resize("image-b", { width: 300, height: 300 }),
    ).toThrowError(expect.objectContaining({ code: "NOT_DETACHED" }));
    expect(() =>
      controller.resize("missing", { width: 300, height: 300 }),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_ITEM_ID" }));
  });

  it("removes the handle when an item stops being resizable", () => {
    render();
    act(() => controller.detach("image-b"));
    resizeBy(40, 40);

    render(<View resizable={false} />);

    expect(handle("image-b")).toBeNull();
    expect(registry.get("image-b")?.status).toBe("detached");
    expect(panel("image-b").style.width).toBe("280px");
  });
});
