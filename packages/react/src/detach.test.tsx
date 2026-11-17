// @vitest-environment jsdom
import { SpatialRegistry } from "@spatialflex/core";
import {
  act,
  createContext,
  StrictMode,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialController,
  type SpatialController,
} from "./index";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout: give the viewport and elements fixed sizes.
const VIEWPORT = { width: 1024, height: 768 };
const SLOT_RECT = { left: 300, top: 120, width: 240, height: 190 };
const PANEL_SIZE = { width: 240, height: 220 };

function stubLayout() {
  const root = document.documentElement;
  Object.defineProperty(root, "clientWidth", {
    configurable: true,
    get: () => VIEWPORT.width,
  });
  Object.defineProperty(root, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT.height,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const { left, top, width, height } = this.hasAttribute(
        "data-spatialflex-panel",
      )
        ? { left: 0, top: 0, ...PANEL_SIZE }
        : SLOT_RECT;
      return DOMRect.fromRect({ x: left, y: top, width, height });
    },
  );
}

const ThemeContext = createContext("none");
let lifecycle: { mounts: number; unmounts: number; clicks: number };

/** Local state, a click handler, a context value and lifecycle counters. */
function Probe() {
  const [count, setCount] = useState(0);
  const theme = useContext(ThemeContext);
  useEffect(() => {
    lifecycle.mounts++;
    return () => {
      lifecycle.unmounts++;
    };
  }, []);
  return (
    <button
      data-probe
      onClick={() => {
        lifecycle.clicks++;
        setCount((c) => c + 1);
      }}
    >
      {theme}:{count}
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

function Gallery({
  registry,
  capabilities = { detachable: true, movable: true },
}: {
  registry: SpatialRegistry;
  capabilities?: { detachable?: boolean; movable?: boolean };
}) {
  return (
    <ThemeContext value="ocean">
      <SpatialWorkspace registry={registry}>
        <CaptureController />
        <SpatialItem id="image-a" detachable>
          <img alt="Image A" />
        </SpatialItem>
        <SpatialItem id="image-b" label="Image B" {...capabilities}>
          <Probe />
        </SpatialItem>
        <SpatialItem id="image-c" detachable>
          <img alt="Image C" />
        </SpatialItem>
      </SpatialWorkspace>
    </ThemeContext>
  );
}

let root: Root | undefined;
let container: HTMLElement;
let caughtErrors: unknown[];

function render(ui: ReactNode) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container, {
      onCaughtError: (error) => caughtErrors.push(error),
    });
  }
  act(() => root!.render(ui));
}

function unmount() {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
}

beforeEach(() => {
  lifecycle = { mounts: 0, unmounts: 0, clicks: 0 };
  caughtErrors = [];
  stubLayout();
});

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

const probe = () => container.querySelector<HTMLButtonElement>("[data-probe]")!;
const click = (element: HTMLElement) => act(() => element.click());
const item = (id: string) =>
  container.querySelector<HTMLElement>(`[data-spatialflex-item="${id}"]`)!;
const panel = (id: string) =>
  item(id).querySelector<HTMLElement>("[data-spatialflex-panel]")!;
const panelBar = (id: string) =>
  item(id).querySelector<HTMLElement>("[data-spatialflex-panel-bar]");

function pointer(target: Element, type: string, x: number, y: number) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: y,
      }),
    );
  });
}

describe("React state across detach/attach", () => {
  it.each([
    ["without StrictMode", (ui: ReactNode) => ui, 1],
    ["in StrictMode", (ui: ReactNode) => <StrictMode>{ui}</StrictMode>, 2],
  ])("keeps the same component instance %s", (_, wrap, mountsAtStart) => {
    const registry = new SpatialRegistry();
    render(wrap(<Gallery registry={registry} />));
    const button = probe();
    // StrictMode runs effects twice on mount by design.
    const baseline = { mounts: mountsAtStart, unmounts: mountsAtStart - 1 };
    expect(lifecycle).toMatchObject(baseline);

    for (let i = 0; i < 5; i++) click(probe());
    expect(probe().textContent).toBe("ocean:5");

    act(() => controller.detach("image-b"));
    expect(registry.get("image-b")?.status).toBe("detached");
    expect(probe().textContent).toBe("ocean:5");

    click(probe());
    expect(probe().textContent).toBe("ocean:6");

    act(() => controller.attach("image-b"));
    expect(registry.get("image-b")?.status).toBe("attached");
    expect(probe().textContent).toBe("ocean:6");

    // Same DOM node, same instance, one handler call per click.
    expect(probe()).toBe(button);
    expect(lifecycle).toEqual({ ...baseline, clicks: 6 });
    expect(container.querySelectorAll("[data-probe]")).toHaveLength(1);
    expect(caughtErrors).toEqual([]);
  });
});

describe("detached presentation", () => {
  it("floats the panel over the original placement and keeps a placeholder", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    const imageA = item("image-a").outerHTML;
    const imageC = item("image-c").outerHTML;

    act(() => controller.detach("image-b"));

    expect(registry.get("image-b")?.layout).toEqual({
      position: { x: 300, y: 120 },
      size: { width: 240, height: 190 },
      visible: true,
    });
    expect(item("image-b").dataset.status).toBe("detached");
    expect(item("image-b").style).toMatchObject({
      width: "240px",
      height: "190px",
    });
    expect(panel("image-b").style).toMatchObject({
      position: "fixed",
      left: "300px",
      top: "120px",
      width: "240px",
    });
    expect(panel("image-b").getAttribute("role")).toBe("dialog");
    expect(panel("image-b").getAttribute("aria-label")).toBe("Image B");
    expect(panelBar("image-b")?.textContent).toBe("Image BAttach");

    // Images A and C are untouched.
    expect(item("image-a").outerHTML).toBe(imageA);
    expect(item("image-c").outerHTML).toBe(imageC);
  });

  it("attaches through the panel's Attach button", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));

    click(panelBar("image-b")!.querySelector("button")!);

    expect(registry.get("image-b")?.status).toBe("attached");
    expect(panelBar("image-b")).toBeNull();
    expect(item("image-b").style.cssText).toBe("");
    expect(panel("image-b").style.cssText).toBe("");
  });

  it("reopens at the last position after re-detaching", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));
    act(() => controller.move("image-b", { x: 40, y: 60 }));
    act(() => controller.attach("image-b"));
    act(() => controller.detach("image-b"));

    expect(panel("image-b").style).toMatchObject({ left: "40px", top: "60px" });
  });
});

describe("moving", () => {
  it("drags the panel with the pointer", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));
    const bar = panelBar("image-b")!;

    pointer(bar, "pointerdown", 310, 130);
    pointer(bar, "pointermove", 360, 200);
    expect(registry.get("image-b")?.layout.position).toEqual({
      x: 350,
      y: 190,
    });
    pointer(bar, "pointerup", 360, 200);
    pointer(bar, "pointermove", 500, 500);

    expect(registry.get("image-b")?.layout.position).toEqual({
      x: 350,
      y: 190,
    });
    expect(panel("image-b").style).toMatchObject({
      left: "350px",
      top: "190px",
    });
  });

  it("does not start a drag from the Attach button", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));
    const button = panelBar("image-b")!.querySelector("button")!;

    pointer(button, "pointerdown", 310, 130);
    pointer(button, "pointermove", 360, 200);

    expect(registry.get("image-b")?.layout.position).toEqual({
      x: 300,
      y: 120,
    });
  });

  it("keeps the panel inside the viewport", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));

    act(() => controller.move("image-b", { x: 5000, y: -50 }));
    expect(registry.get("image-b")?.layout.position).toEqual({
      x: VIEWPORT.width - PANEL_SIZE.width,
      y: 0,
    });

    act(() => controller.move("image-b", { x: 10.6, y: 20.4 }));
    expect(registry.get("image-b")?.layout.position).toEqual({ x: 11, y: 20 });
  });

  it("re-clamps on window resize and removes the listener afterwards", () => {
    const registry = new SpatialRegistry();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const resizeCalls = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === "resize").length;

    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));
    act(() => controller.move("image-b", { x: 700, y: 500 }));

    VIEWPORT.width = 600;
    VIEWPORT.height = 400;
    try {
      act(() => window.dispatchEvent(new Event("resize")));
      expect(registry.get("image-b")?.layout.position).toEqual({
        x: 600 - PANEL_SIZE.width,
        y: 400 - PANEL_SIZE.height,
      });
    } finally {
      VIEWPORT.width = 1024;
      VIEWPORT.height = 768;
    }

    act(() => controller.attach("image-b"));
    expect(resizeCalls(add)).toBeGreaterThan(0);
    expect(resizeCalls(remove)).toBe(resizeCalls(add));
  });

  it("does not drag an item that is not movable", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} capabilities={{ detachable: true }} />);
    act(() => controller.detach("image-b"));
    const bar = panelBar("image-b")!;

    pointer(bar, "pointerdown", 310, 130);
    pointer(bar, "pointermove", 360, 200);

    expect(registry.get("image-b")?.layout.position).toEqual({
      x: 300,
      y: 120,
    });
    expect(bar.dataset.movable).toBe("false");
  });
});

describe("cleanup and repetition", () => {
  it("survives 20 detach/attach cycles without leaking DOM or remounting", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    click(probe());

    for (let i = 0; i < 20; i++) {
      act(() => controller.detach("image-b"));
      expect(
        container.querySelectorAll("[data-spatialflex-panel-bar]"),
      ).toHaveLength(1);
      act(() => controller.attach("image-b"));
    }

    expect(lifecycle).toMatchObject({ mounts: 1, unmounts: 0 });
    expect(probe().textContent).toBe("ocean:1");
    expect(container.querySelectorAll("[data-probe]")).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelectorAll("[data-spatialflex-item]")).toHaveLength(
      3,
    );
    expect(
      container.querySelectorAll("[data-spatialflex-panel-bar]"),
    ).toHaveLength(0);
    expect(registry.list().map((record) => record.id)).toEqual([
      "image-a",
      "image-b",
      "image-c",
    ]);
  });

  it("cleans up when unmounted while detached", () => {
    const registry = new SpatialRegistry();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));

    unmount();

    expect(registry.list()).toEqual([]);
    expect(container.innerHTML).toBe("");
    expect(document.querySelector("[data-spatialflex-panel]")).toBeNull();
    const resize = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === "resize").length;
    expect(resize(remove)).toBe(resize(add));
  });

  it("removes only the detached item when it unmounts", () => {
    const registry = new SpatialRegistry();
    const view = (showB: boolean) => (
      <SpatialWorkspace registry={registry}>
        <CaptureController />
        <SpatialItem id="image-a" detachable />
        {showB && (
          <SpatialItem id="image-b" detachable>
            <Probe />
          </SpatialItem>
        )}
      </SpatialWorkspace>
    );
    render(view(true));
    act(() => controller.detach("image-b"));

    render(view(false));

    expect(registry.list().map((record) => record.id)).toEqual(["image-a"]);
    expect(
      container.querySelectorAll("[data-spatialflex-panel-bar]"),
    ).toHaveLength(0);
    expect(lifecycle).toMatchObject({ mounts: 1, unmounts: 1 });
  });

  it("detaches and attaches without re-registering the item", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    const listener = vi.fn();
    registry.subscribe(listener);

    act(() => controller.detach("image-b"));
    // A capability change while detached updates the same registration.
    render(
      <Gallery
        registry={registry}
        capabilities={{ detachable: true, movable: false }}
      />,
    );
    act(() => controller.attach("image-b"));

    expect(listener).toHaveBeenCalledTimes(3);
    expect(registry.get("image-b")?.capabilities.movable).toBe(false);
    expect(lifecycle).toMatchObject({ mounts: 1, unmounts: 0 });
  });

  it("attaches the panel when the item stops being detachable", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    act(() => controller.detach("image-b"));

    render(
      <Gallery registry={registry} capabilities={{ detachable: false }} />,
    );

    expect(registry.get("image-b")?.status).toBe("attached");
    expect(panelBar("image-b")).toBeNull();
    expect(lifecycle).toMatchObject({ mounts: 1, unmounts: 0 });
  });
});

describe("errors and isolation", () => {
  it("rejects unknown IDs and non-detachable items without changing the DOM", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} capabilities={{ movable: true }} />);
    const html = container.innerHTML;

    expect(() => controller.detach("missing")).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_ITEM_ID" }),
    );
    expect(() => controller.detach("image-b")).toThrowError(
      expect.objectContaining({ code: "NOT_DETACHABLE" }),
    );
    expect(() => controller.move("image-b", { x: 0, y: 0 })).toThrowError(
      expect.objectContaining({ code: "NOT_DETACHED" }),
    );
    expect(container.innerHTML).toBe(html);
  });

  it("keeps detachment isolated between workspaces", () => {
    const first = new SpatialRegistry();
    const second = new SpatialRegistry();
    let secondController!: SpatialController;
    function CaptureSecond() {
      const current = useSpatialController();
      useEffect(() => {
        secondController = current;
      }, [current]);
      return null;
    }
    render(
      <>
        <SpatialWorkspace registry={first}>
          <CaptureController />
          <SpatialItem id="image-b" detachable>
            <p>first</p>
          </SpatialItem>
        </SpatialWorkspace>
        <SpatialWorkspace registry={second}>
          <CaptureSecond />
          <SpatialItem id="image-b" detachable>
            <p>second</p>
          </SpatialItem>
        </SpatialWorkspace>
      </>,
    );

    act(() => controller.detach("image-b"));

    expect(controller).not.toBe(secondController);
    expect(first.get("image-b")?.status).toBe("detached");
    expect(second.get("image-b")?.status).toBe("attached");
    expect(
      container.querySelectorAll("[data-spatialflex-panel-bar]"),
    ).toHaveLength(1);
    expect(caughtErrors).toEqual([]);
  });

  it("returns a stable controller across rerenders", () => {
    const registry = new SpatialRegistry();
    render(<Gallery registry={registry} />);
    const first = controller;

    render(<Gallery registry={registry} />);

    expect(controller).toBe(first);
  });
});
