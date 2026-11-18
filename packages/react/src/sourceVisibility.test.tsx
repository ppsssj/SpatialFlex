// @vitest-environment jsdom
import { act, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialController,
  type SpatialController,
} from "./index";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mounts = 0;
function Card() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounts++;
  }, []);
  return (
    <button data-card onClick={() => setCount((c) => c + 1)}>
      {count}
    </button>
  );
}

let controller: SpatialController;
function Capture() {
  const value = useSpatialController();
  useEffect(() => {
    controller = value;
  }, [value]);
  return null;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mounts = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (show = true) =>
  act(() =>
    root.render(
      <StrictMode>
        <SpatialWorkspace>
          <Capture />
          {show && (
            <SpatialItem id="card" detachable>
              <Card />
            </SpatialItem>
          )}
          <span data-unregistered>plain</span>
        </SpatialWorkspace>
      </StrictMode>,
    ),
  );

const slot = () =>
  container.querySelector<HTMLElement>("[data-spatialflex-item]")!;
const panel = () =>
  container.querySelector<HTMLElement>("[data-spatialflex-panel]")!;
const card = () => container.querySelector<HTMLButtonElement>("[data-card]")!;

describe("SpatialItem source visibility", () => {
  it("reserves the footprint without remounting, then restores", () => {
    render();
    act(() => card().click());
    const node = card();
    const mountsBefore = mounts;
    act(() => controller.setSourceVisibility("card", "reserved"));
    expect(slot().dataset.sourceVisibility).toBe("reserved");
    // Hidden, inert and out of the accessibility tree, but still in flow.
    expect(panel().style.visibility).toBe("hidden");
    expect(panel().style.position).toBe("");
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(panel().getAttribute("aria-hidden")).toBe("true");
    expect(slot().style.display).toBe("");
    expect(card()).toBe(node);
    expect(card().textContent).toBe("1");

    act(() => controller.setSourceVisibility("card", "visible"));
    expect(slot().dataset.sourceVisibility).toBeUndefined();
    expect(panel().style.visibility).toBe("");
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(card()).toBe(node);
    act(() => card().click());
    expect(card().textContent).toBe("2");
    expect(mounts).toBe(mountsBefore);
  });

  it("exposes source elements only for registered, connected items", () => {
    render();
    expect(controller.sourceElement("card")).toBe(slot());
    expect(controller.sourceElement("unknown")).toBeNull();
    render(false);
    expect(controller.sourceElement("card")).toBeNull();
  });

  it("a moved item is shown even after its source was reserved", () => {
    render();
    act(() => controller.setSourceVisibility("card", "reserved"));
    act(() => controller.detach("card"));
    expect(slot().dataset.sourceVisibility).toBeUndefined();
    expect(panel().style.visibility).toBe("");
    expect(panel().style.position).toBe("fixed");
    expect(() => controller.setSourceVisibility("card", "reserved")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }),
    );
  });

  it("remounting the same logical id starts visible", () => {
    render();
    act(() => controller.setSourceVisibility("card", "reserved"));
    render(false);
    render();
    expect(slot().dataset.sourceVisibility).toBeUndefined();
    expect(panel().hasAttribute("inert")).toBe(false);
  });
});
