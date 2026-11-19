// @vitest-environment jsdom
//
// P1-07A lifecycle hardening, in a real React tree: the actual LabShell,
// SpatialFlex integration, surface compositor and Native DOM handles, with
// a stub same-document host that reports Three.js camera frames (no WebGL).
// jsdom has no layout, so element sizes are fixed; everything else (React
// commits, effects, style writes, listeners) is real.
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA,
  type HostCameraFrame,
  type HostModule,
  type XRHostProps,
} from "../contracts/xrHost";
import { createLabStore, type LabStore } from "../fixtures";
import type {
  IntegrationModule,
  LabIntegration,
} from "../integrations/contract";
import { spatialflexIntegration } from "../integrations/spatialflex";
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

// P1-07B3: Native DOM handles and composition moved from the lab's own
// hooks (`useNativeHandles`, the surface's NativeCompositor) to the SDK
// PresentationRuntime. The same invariants, through the lab's real path:
// a remounted component extracted again is a new element under the same
// id; only the new one takes input and is composited.
describe("element replacement under an unchanged id list", () => {
  const IMAGE = "image-panel";
  const handleOf = () =>
    q(
      `[data-spatialflex-item="${IMAGE}"] [data-spatialflex-handle="translate"][role=button]`,
    );
  const pointerDown = (target: Element) => {
    const event = Object.assign(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      { pointerId: 1 },
    );
    target.dispatchEvent(event);
  };
  /** Extract, then unmount, remount and extract the new element again. */
  function replace() {
    renderShell();
    extract(IMAGE, "native");
    const old = { panel: panelOf(IMAGE), handle: handleOf() };
    expect(old.panel.style.transform).toMatch(/^matrix3d/);
    act(() => store.actions.setImageMounted(false));
    act(() => store.actions.setImageMounted(true));
    frame();
    extract(IMAGE, "native");
    const next = { panel: panelOf(IMAGE), handle: handleOf() };
    expect(next.panel).not.toBe(old.panel);
    return { old, next };
  }

  it("Native DOM handles follow the element, not only the id", () => {
    const { old, next } = replace();
    const begin = vi.spyOn(lab.manipulation!, "begin");
    pointerDown(old.handle);
    expect(begin).not.toHaveBeenCalled();
    pointerDown(next.handle);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0]![0]).toBe(IMAGE);
  });

  it("the compositor releases a replaced element", () => {
    const { old, next } = replace();
    expect(next.panel.style.transform).toMatch(/^matrix3d/);
    expect(old.panel.style.transform).toBe("");
    expect(old.panel.dataset.spatialVisibility).toBeUndefined();
    expect(old.panel.dataset.spatialPlaced).toBeUndefined();
  });
});
