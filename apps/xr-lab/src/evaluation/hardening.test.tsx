// @vitest-environment jsdom
//
// P1-07A lifecycle hardening, in a real React tree: the actual LabShell,
// SpatialFlex integration, surface compositor and Native DOM handles, with
// a stub same-document host that reports Three.js camera frames (no WebGL).
// jsdom has no layout, so element sizes are fixed; everything else (React
// commits, effects, style writes, listeners) is real.
import { act, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA,
  type HostCameraFrame,
  type HostModule,
  type HostRay,
  type XRHostProps,
} from "../contracts/xrHost";
import { createLabStore, type LabStore } from "../fixtures";
import type {
  IntegrationModule,
  LabIntegration,
  LabManipulation,
} from "../integrations/contract";
import { spatialflexIntegration } from "../integrations/spatialflex";
import { useNativeHandles } from "../manipulation/useNativeHandles";
import { useSurfaceCompositor } from "../surface/useSurfaceCompositor";
import { LabShell } from "../shell/LabShell";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = { left: 0, top: 0, width: 980, height: 760 };
function cameraFrame(position = CAMERA.position): HostCameraFrame {
  const camera = new PerspectiveCamera(
    CAMERA.fov,
    VIEWPORT.width / VIEWPORT.height,
    0.01,
    100,
  );
  camera.position.set(...position);
  camera.lookAt(...CAMERA.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const vp = new Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const eye = camera.getWorldPosition(new Vector3());
  return {
    viewProjection: vp.elements,
    viewport: VIEWPORT,
    eye: [eye.x, eye.y, eye.z],
  };
}

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let hostProps: XRHostProps | null = null;
function StubHost(props: XRHostProps) {
  useEffect(() => {
    hostProps = props;
  });
  return <div data-testid="stub-host" />;
}
const stubHost: HostModule = {
  id: "three",
  label: "Stub",
  Host: StubHost,
  webSurface: true,
};
let lab: LabIntegration;
const integration: IntegrationModule = {
  ...spatialflexIntegration,
  useIntegration() {
    const value = spatialflexIntegration.useIntegration();
    useEffect(() => {
      lab = value;
    });
    return value;
  },
};

let root: Root;
let container: HTMLDivElement;
let store: LabStore;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(276);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(150);
  store = createLabStore();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  hostProps = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderShell(fixture: "dashboard" | "hardening" = "dashboard") {
  act(() =>
    root.render(
      <StrictMode>
        <LabShell
          integration={integration}
          host={stubHost}
          store={store}
          emulator="off"
          surface
          fixture={fixture}
        />
      </StrictMode>,
    ),
  );
  frame();
}
const frame = () => act(() => hostProps!.onCameraFrame!(cameraFrame()));
const q = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T>(selector)!;
const click = (selector: string) => act(() => q(selector).click());
const panelOf = (id: string) =>
  q(`[data-spatialflex-item="${id}"] [data-spatialflex-panel]`);

/** Extraction through the surface UI, as a user does it. */
function extract(id: string, presentation: "native" | "adaptive") {
  click('[data-testid="surface-select-mode"]');
  click(`.surface-outline[data-surface-item="${id}"]`);
  click(`[data-testid="surface-presentation-${presentation}"]`);
  const source = q<HTMLSelectElement>('[data-testid="surface-source"]');
  expect(source.value).toBe("reserved");
  click('[data-testid="surface-extract"]');
  frame();
}

describe("compositor style ownership", () => {
  it("API-level Native → Adaptive switch keeps the source's own reserved visibility", () => {
    renderShell();
    const counter = panelOf("shared-counter");
    extract("shared-counter", "native");
    expect(counter.dataset.spatialPlaced).toBe("");
    expect(counter.style.transform).toMatch(/^matrix3d/);
    // One commit: the native presentation ends and an adaptive one starts
    // with the source reserved (hidden, footprint kept) by the SDK.
    act(() => {
      lab.extract!("shared-counter", {
        presentation: "adaptive",
        source: "reserved",
        position: [0.9, 1.4, -1],
      });
    });
    frame();
    expect(lab.panels.map((p) => p.id)).toContain("shared-counter");
    // Compositor-owned presentation is released...
    expect(counter.style.transform).toBe("");
    expect(counter.style.clipPath).toBe("");
    expect(counter.dataset.spatialPlaced).toBeUndefined();
    expect(counter.dataset.spatialVisibility).toBeUndefined();
    // ...but the SDK's own reserved-source style is not.
    expect(counter.style.visibility).toBe("hidden");
    expect(counter.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("element replacement under an unchanged id list", () => {
  const ray: HostRay = { origin: [0, 0, 0], direction: [0, 0, -1] };
  function fakeManipulation() {
    return {
      begin: vi.fn(() => 1),
      update: vi.fn(),
      end: vi.fn(),
      nudge: vi.fn(() => null),
      endKeyboard: vi.fn(() => false),
      subscribe: () => () => {},
      getSnapshot: () => ({ version: 0, active: null, selected: null }),
    } as unknown as LabManipulation & { begin: ReturnType<typeof vi.fn> };
  }
  const nativePanel = () => {
    const element = document.createElement("div");
    element.innerHTML =
      '<div data-spatialflex-handle="translate"><span data-spatialflex-handle="translate" role="button" tabindex="0">t</span></div>';
    document.body.append(element);
    return element;
  };
  const pointerDown = (target: Element) => {
    const event = Object.assign(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      { pointerId: 1 },
    );
    target.dispatchEvent(event);
  };

  it("Native DOM handles follow the element, not only the id", () => {
    const manipulation = fakeManipulation();
    const a = nativePanel();
    const b = nativePanel();
    let swap: (element: HTMLElement) => void = () => {};
    function Harness() {
      const [element, setElement] = useState<HTMLElement>(a);
      useEffect(() => {
        swap = setElement;
      }, []);
      useNativeHandles(
        manipulation,
        ["item"],
        (id) => (id === "item" ? element : null),
        () => ray,
      );
      return null;
    }
    act(() => root.render(<Harness />));
    act(() => swap(b));
    pointerDown(a.querySelector("[role=button]")!);
    expect(manipulation.begin).not.toHaveBeenCalled();
    pointerDown(b.querySelector("[role=button]")!);
    expect(manipulation.begin).toHaveBeenCalledTimes(1);
    a.remove();
    b.remove();
  });

  it("the compositor releases a replaced element", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    let swap: (element: HTMLElement) => void = () => {};
    let compositor: ReturnType<typeof useSurfaceCompositor> | null = null;
    function Harness() {
      const [element, setElement] = useState<HTMLElement>(a);
      useEffect(() => {
        swap = setElement;
      }, []);
      const c = useSurfaceCompositor(true, [], ["item"], (id) =>
        id === "item" ? element : null,
      );
      useEffect(() => {
        compositor = c;
      });
      const { attachLayer, attachPage } = c;
      return (
        <div ref={attachLayer}>
          <div ref={attachPage} />
        </div>
      );
    }
    act(() => root.render(<Harness />));
    act(() =>
      compositor!.placeNative("item", {
        position: [0.9, 1.5, -1],
        rotation: [0, 0.15, 0],
        metersPerPixel: 0.00225,
      }),
    );
    act(() => compositor!.onCameraFrame(cameraFrame()));
    expect(a.style.transform).toMatch(/^matrix3d/);
    act(() => swap(b));
    act(() => compositor!.onCameraFrame(cameraFrame()));
    expect(b.style.transform).toMatch(/^matrix3d/);
    expect(a.style.transform).toBe("");
    expect(a.dataset.spatialVisibility).toBeUndefined();
    expect(a.dataset.spatialPlaced).toBeUndefined();
  });
});
