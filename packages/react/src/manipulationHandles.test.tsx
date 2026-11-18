// @vitest-environment jsdom
import { SpatialRegistry } from "@spatialflex/core";
import { act, StrictMode, useEffect, useState } from "react";
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

let mounts = 0;
function Card() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounts++;
  }, []);
  return (
    <div data-card>
      <button data-inc onClick={() => setCount((c) => c + 1)}>
        {count}
      </button>
    </div>
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
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(276);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(150);
  act(() =>
    root.render(
      <StrictMode>
        <SpatialWorkspace registry={new SpatialRegistry()}>
          <Capture />
          <SpatialItem id="card" label="Card" detachable movable resizable>
            <Card />
          </SpatialItem>
        </SpatialWorkspace>
      </StrictMode>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const handles = () =>
  [...container.querySelectorAll<HTMLElement>("[data-spatialflex-handle]")].map(
    (h) => [h.dataset.spatialflexHandle, h.getAttribute("role")],
  );

describe("spatial manipulation handles (external placement)", () => {
  it("are rendered only while the panel is placed externally", () => {
    expect(handles()).toEqual([]);
    act(() => controller.detach("card"));
    // Viewport placement keeps the SDK's own drag and resize.
    expect(handles()).toEqual([]);
    act(() => controller.attach("card"));
    act(() => controller.extractNative("card", "placeholder"));
    expect(handles()).toEqual([
      ["translate", null],
      ["translate", "button"],
      ["rotate", "button"],
      ["resize", "button"],
    ]);
    act(() => controller.attach("card"));
    expect(handles()).toEqual([]);
  });

  it("are focusable and labelled; Attach stays the bar's button", () => {
    act(() => controller.extractNative("card", "placeholder"));
    const focusable = [
      ...container.querySelectorAll<HTMLElement>(
        "[data-spatialflex-handle][role=button]",
      ),
    ];
    expect(
      focusable.map((h) => [h.tabIndex, h.getAttribute("aria-label")]),
    ).toEqual([
      [0, "Move Card in space"],
      [0, "Rotate Card in space"],
      [0, "Resize Card in space"],
    ]);
    const bar = container.querySelector("[data-spatialflex-panel-bar]")!;
    expect(bar.querySelector("button")!.textContent).toBe("Attach");
    // The resize handle lies inside the panel (its own containing block).
    const resize = container.querySelector<HTMLElement>(
      '[data-spatialflex-handle="resize"]',
    )!;
    expect(resize.parentElement!.hasAttribute("data-spatialflex-panel")).toBe(
      true,
    );
    expect(resize.style.position).toBe("absolute");
  });

  it("never remount or re-parent the content", () => {
    const card = container.querySelector("[data-card]")!;
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-inc]")!.click(),
    );
    const before = mounts;
    act(() => controller.extractNative("card", "placeholder"));
    act(() => controller.attach("card"));
    act(() => controller.extractNative("card", "collapse"));
    expect(container.querySelector("[data-card]")).toBe(card);
    expect(container.querySelector("[data-inc]")!.textContent).toBe("1");
    expect(mounts).toBe(before);
  });
});
