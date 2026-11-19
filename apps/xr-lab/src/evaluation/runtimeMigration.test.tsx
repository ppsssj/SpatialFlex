// @vitest-environment jsdom
//
// P1-07B3: the lab's SpatialFlex integration on the SDK's shared
// PresentationRuntime, in a real React tree (LabShell, the SpatialFlex
// adapter, the page surface as the runtime's Native DOM host) with a stub
// same-document host that reports Three.js camera frames (no WebGL).
// jsdom has no layout, so element sizes are fixed.
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { PresentationRuntime } from "@spatialflex/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA,
  type HostCameraFrame,
  type HostModule,
  type HostRay,
  type XRHostProps,
} from "../contracts/xrHost";
import { createLabStore, type LabStore } from "../fixtures";
import { baselineIntegration } from "../integrations/baseline";
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
function cameraFrame(): HostCameraFrame {
  const camera = new PerspectiveCamera(
    CAMERA.fov,
    VIEWPORT.width / VIEWPORT.height,
    0.01,
    100,
  );
  camera.position.set(...CAMERA.position);
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
const observed = (module: IntegrationModule): IntegrationModule => ({
  ...module,
  useIntegration() {
    const value = module.useIntegration();
    useEffect(() => {
      lab = value;
    });
    return value;
  },
});

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

function renderShell(module: IntegrationModule = spatialflexIntegration) {
  act(() =>
    root.render(
      <StrictMode>
        <LabShell
          integration={observed(module)}
          host={stubHost}
          store={store}
          emulator="off"
          surface
        />
      </StrictMode>,
    ),
  );
  if (hostProps?.onCameraFrame) frame();
}
const frame = () => act(() => hostProps!.onCameraFrame!(cameraFrame()));
const COUNTER = "shared-counter";
const panelOf = (id: string) =>
  container.querySelector<HTMLElement>(
    `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
  )!;
const extraction = (id: string) =>
  lab.surfaceItems!.find((item) => item.id === id)!.extraction;
const extract = (
  id: string,
  presentation: "native" | "adaptive",
  source: string = "reserved",
) => {
  let done = false;
  act(() => {
    done = lab.extract!(id, {
      presentation,
      source,
      position: [0.9, 1.4, -1],
      rotation: [0, 0, 0],
      metersPerPixel: 0.00225,
    });
  });
  frame();
  return done;
};
/** A world ray from the camera through a presentation's current position. */
const rayTo = (id: string, dx = 0): HostRay => {
  const [x, y, z] = lab.manipulation!.poseOf(id)!.position;
  const [ex, ey, ez] = CAMERA.position;
  const d = [x + dx - ex, y - ey, z - ez];
  const n = Math.hypot(...d);
  return {
    origin: [ex, ey, ez],
    direction: [d[0]! / n, d[1]! / n, d[2]! / n],
  };
};

describe("M4 strategy transitions on the shared runtime", () => {
  it("Adaptive → Native and Native → Adaptive switch in one transaction, with the lab's source names", () => {
    renderShell();
    expect(extract(COUNTER, "adaptive")).toBe(true);
    const adaptive = extraction(COUNTER)!;
    expect(adaptive).toMatchObject({
      presentation: "adaptive",
      source: "reserved",
      presentationId: expect.stringMatching(/^presentation-\d+$/),
    });
    // Adaptive → Native: the panel ends, the original is composited.
    expect(extract(COUNTER, "native", "collapsed")).toBe(true);
    expect(extraction(COUNTER)).toMatchObject({
      presentation: "native",
      // Lab policy `collapsed` (controller argument `collapse`).
      source: "collapsed",
      presentationId: expect.stringMatching(/^native-\d+$/),
    });
    expect(lab.panels).toEqual([]);
    expect(panelOf(COUNTER).style.transform).toMatch(/^matrix3d/);
    // Native → Adaptive.
    expect(extract(COUNTER, "adaptive", "visible")).toBe(true);
    expect(extraction(COUNTER)).toMatchObject({
      presentation: "adaptive",
      source: "visible",
    });
    expect(extraction(COUNTER)!.presentationId).not.toBe(
      adaptive.presentationId,
    );
    expect(panelOf(COUNTER).style.transform).toBe("");
    expect(lab.manipulation!.targets().map((t) => t.kind)).toEqual([
      "adaptive",
    ]);
  });

  it("a refused switch keeps the current presentation unchanged (rollback)", () => {
    renderShell();
    extract(COUNTER, "adaptive");
    const before = extraction(COUNTER)!;
    const pose = lab.manipulation!.poseOf(COUNTER);
    // An ancestor that captures fixed positioning: Native DOM is refused.
    const widgets = container.querySelector<HTMLElement>(".widgets")!;
    widgets.style.filter = "blur(1px)";
    expect(extract(COUNTER, "native")).toBe(false);
    widgets.style.filter = "";
    // An invalid source is rejected with the SDK's reason, before any change.
    expect(() => extract(COUNTER, "native", "visible")).toThrow();
    expect(extraction(COUNTER)).toEqual(before);
    expect(lab.panels.map((p) => p.id)).toEqual([COUNTER]);
    expect(lab.manipulation!.poseOf(COUNTER)).toEqual(pose);
    expect(panelOf(COUNTER).style.visibility).toBe("hidden");
    // Same strategy again is refused too, without a new instance.
    expect(extract(COUNTER, "adaptive")).toBe(false);
    expect(extraction(COUNTER)).toEqual(before);
  });
});

describe("M5 input ownership across presentation instances", () => {
  it("an ended instance's pointer session cannot move its replacement", () => {
    renderShell();
    extract(COUNTER, "adaptive");
    const manipulation = lab.manipulation!;
    const token = manipulation.begin(COUNTER, "translate", 1, rayTo(COUNTER))!;
    expect(token).not.toBeNull();
    act(() => manipulation.update(token, rayTo(COUNTER, 0.1)));
    expect(manipulation.getSnapshot().active).not.toBeNull();
    act(() => void lab.restore!(COUNTER));
    expect(manipulation.getSnapshot().active).toBeNull();
    extract(COUNTER, "adaptive");
    const start = manipulation.poseOf(COUNTER);
    act(() => manipulation.update(token, rayTo(COUNTER, 0.3)));
    act(() => manipulation.end(token, true));
    expect(manipulation.poseOf(COUNTER)).toEqual(start);
    expect(manipulation.getSnapshot().active).toBeNull();
  });

  it("stale button, select and close callbacks of an ended instance never reach the new one", () => {
    renderShell();
    extract(COUNTER, "adaptive");
    const stale = hostProps!;
    const staleOwner = lab.actionOwners![COUNTER];
    act(() => void lab.restore!(COUNTER));
    extract(COUNTER, "adaptive");
    const live = extraction(COUNTER)!.presentationId;
    expect(lab.actionOwners![COUNTER]).not.toBe(staleOwner);
    const count = store.getState().sharedCount;
    act(() => {
      stale.onPanelButton(COUNTER, "increment");
      stale.onPanelSelect(COUNTER);
      stale.onPanelClose(COUNTER);
    });
    expect(store.getState().sharedCount).toBe(count);
    expect(extraction(COUNTER)!.presentationId).toBe(live);
    expect(lab.items.find((i) => i.id === COUNTER)!.selected).toBe(false);
    // The live callbacks act on the live instance, once.
    act(() => hostProps!.onPanelButton(COUNTER, "increment"));
    expect(store.getState().sharedCount).toBe(count + 1);
    act(() => hostProps!.onPanelSelect(COUNTER));
    expect(lab.items.find((i) => i.id === COUNTER)!.selected).toBe(true);
    expect(lab.manipulation!.getSnapshot().selected).toBe(COUNTER);
    act(() => hostProps!.onPanelClose(COUNTER));
    expect(extraction(COUNTER)).toBeNull();
  });

  it("Move offsets belong to an instance: a new instance starts at its slot", () => {
    renderShell();
    act(() => void lab.show(COUNTER));
    const start = lab.manipulation!.poseOf(COUNTER)!.position;
    act(() => {
      lab.move(COUNTER, [0.1, 0, 0]);
      lab.move(COUNTER, [0.1, 0, 0]);
    });
    const moved = lab.manipulation!.poseOf(COUNTER)!.position;
    expect(moved[0]).toBeCloseTo(start[0] + 0.2, 9);
    expect(lab.panels[0]!.position[0]).toBeCloseTo(start[0] + 0.2, 9);
    act(() => void lab.hide(COUNTER));
    act(() => void lab.show(COUNTER));
    expect(lab.manipulation!.poseOf(COUNTER)!.position).toEqual(start);
  });
});

describe("M7 Baseline isolation", () => {
  it("Baseline works without creating or connecting a SpatialFlex runtime", () => {
    const connect = vi.spyOn(PresentationRuntime.prototype, "connect");
    const connectHost = vi.spyOn(PresentationRuntime.prototype, "connectHost");
    // Left by earlier tests in this jsdom document.
    document.getElementById("spatialflex-native-visibility")?.remove();
    renderShell(baselineIntegration);
    expect(lab.connectNativeHost).toBeUndefined();
    expect(lab.manipulation).toBeUndefined();
    act(() => void lab.show(COUNTER));
    expect(lab.panels.map((p) => p.id)).toEqual([COUNTER]);
    act(() => hostProps!.onPanelButton(COUNTER, "increment"));
    expect(store.getState().sharedCount).toBe(1);
    expect(connect).not.toHaveBeenCalled();
    expect(connectHost).not.toHaveBeenCalled();
    expect(document.getElementById("spatialflex-native-visibility")).toBeNull();
    // Positive control: the SpatialFlex integration does connect one.
    act(() => root.unmount());
    root = createRoot(container);
    renderShell();
    expect(connect).toHaveBeenCalled();
    expect(connectHost).toHaveBeenCalledWith({ drawsAdaptive: false });
  });
});
