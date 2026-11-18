// @vitest-environment jsdom
import { SpatialRegistry, type PresentationStrategy } from "@spatialflex/core";
import {
  act,
  createContext,
  StrictMode,
  useContext,
  useEffect,
  useState,
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

const Theme = createContext("none");
let mounts = 0;
let unmounts = 0;
function Card() {
  const [count, setCount] = useState(0);
  const theme = useContext(Theme);
  useEffect(() => {
    mounts++;
    return () => {
      unmounts++;
    };
  }, []);
  return (
    <div data-card data-theme={theme}>
      <button data-inc onClick={() => setCount((c) => c + 1)}>
        {count}
      </button>
      <input data-note defaultValue="note" />
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
let registry: SpatialRegistry;
beforeEach(() => {
  mounts = unmounts = 0;
  registry = new SpatialRegistry();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // jsdom has no layout: give elements a layout size.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(276);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(150);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = (
  presentation?: PresentationStrategy,
  props: { detachable?: boolean } = { detachable: true },
) =>
  act(() =>
    root.render(
      <StrictMode>
        <SpatialWorkspace registry={registry}>
          <Theme value="dark">
            <Capture />
            <p data-before>before</p>
            <SpatialItem
              id="card"
              label="Card"
              presentation={presentation}
              {...props}
            >
              <Card />
            </SpatialItem>
            <p data-after>after</p>
          </Theme>
        </SpatialWorkspace>
      </StrictMode>,
    ),
  );

const q = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T>(selector)!;
const slot = () => q("[data-spatialflex-item]");
const panel = () => q("[data-spatialflex-panel]");

describe("Native DOM extraction (external placement)", () => {
  it("presents the same node and instance externally, then restores it", () => {
    render();
    act(() => q<HTMLButtonElement>("[data-inc]").click());
    q<HTMLInputElement>("[data-note]").value = "typed";
    const card = q("[data-card]");
    const button = q("[data-inc]");
    const mountsBefore = mounts;
    const unmountsBefore = unmounts;

    let extracted = false;
    act(() => {
      extracted = controller.extractNative("card", "placeholder");
    });
    expect(extracted).toBe(true);
    expect(registry.get("card")!.status).toBe("detached");
    expect(controller.placement("card")).toBe("external");
    expect(controller.nativeElement("card")).toBe(panel());
    // Same node in the same place in the tree: nothing re-parented or cloned.
    expect(q("[data-card]")).toBe(card);
    expect(card.parentElement!.parentElement).toBe(slot());
    expect(container.querySelectorAll("[data-card]")).toHaveLength(1);
    // The compositor's origin; it owns the transform.
    expect(panel().dataset.spatialflexPlacement).toBe("external");
    expect(panel().style.position).toBe("fixed");
    expect(panel().style.left).toBe("0px");
    expect(panel().style.top).toBe("0px");
    expect(panel().style.transformOrigin).toMatch(/^0(px)? 0(px)?$/);
    expect(panel().style.width).toBe("276px");
    // Placeholder: the layout size, kept in the source.
    expect(slot().style.width).toBe("276px");
    expect(slot().style.height).toBe("150px");
    // No viewport drag/resize affordances while externally placed.
    expect(q("[data-spatialflex-panel-bar]").dataset.movable).toBe("false");
    expect(
      container.querySelector("[data-spatialflex-resize-handle]"),
    ).toBeNull();

    // Original handlers, state, context and field values keep working.
    act(() => q<HTMLButtonElement>("[data-inc]").click());
    expect(button.textContent).toBe("2");
    expect(q("[data-card]").dataset.theme).toBe("dark");
    expect(q<HTMLInputElement>("[data-note]").value).toBe("typed");

    act(() => {
      q<HTMLButtonElement>("[data-spatialflex-panel-bar] button").click();
    });
    expect(registry.get("card")!.status).toBe("attached");
    expect(controller.placement("card")).toBeNull();
    expect(controller.nativeElement("card")).toBeNull();
    expect(panel().style.position).toBe("");
    expect(panel().dataset.spatialflexPlacement).toBeUndefined();
    expect(q("[data-card]")).toBe(card);
    expect(button.textContent).toBe("2");
    expect(mounts).toBe(mountsBefore);
    expect(unmounts).toBe(unmountsBefore);
  });

  it("collapses the source so siblings reflow", () => {
    render();
    act(() => controller.extractNative("card", "collapse"));
    expect(slot().style.display).toBe("contents");
    expect(slot().dataset.sourcePolicy).toBe("collapse");
    act(() => controller.attach("card"));
    expect(slot().style.display).toBe("");
  });

  it("a later P0 Move uses viewport placement again", () => {
    render();
    act(() => controller.extractNative("card", "placeholder"));
    expect(controller.extractNative("card", "placeholder")).toBe(false);
    expect(controller.detach("card")).toBe(false);
    expect(controller.placement("card")).toBe("external");
    act(() => controller.attach("card"));
    act(() => controller.detach("card"));
    expect(controller.placement("card")).toBe("viewport");
    expect(panel().dataset.spatialflexPlacement).toBe("viewport");
    expect(controller.nativeElement("card")).toBeNull();
  });

  it("rejects unregistered, non-detachable items and invalid sources", () => {
    render(undefined, { detachable: false });
    expect(() => controller.extractNative("nope", "placeholder")).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_ITEM_ID" }),
    );
    expect(() => controller.extractNative("card", "placeholder")).toThrowError(
      expect.objectContaining({ code: "NOT_DETACHABLE" }),
    );
    expect(() =>
      controller.extractNative("card", "visible" as never),
    ).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_STRATEGY" }));
    expect(registry.get("card")!.status).toBe("attached");
  });

  it("unmounting while extracted releases the placement", () => {
    render();
    act(() => controller.extractNative("card", "placeholder"));
    act(() =>
      root.render(
        <SpatialWorkspace registry={registry}>
          <Capture />
        </SpatialWorkspace>,
      ),
    );
    expect(controller.placement("card")).toBeNull();
    expect(controller.nativeElement("card")).toBeNull();
    render();
    expect(registry.get("card")!.status).toBe("attached");
    expect(controller.placement("card")).toBeNull();
  });

  it("declares the presentation strategy on the registration", () => {
    render("native");
    expect(registry.presentationOf("card")).toBe("native");
    render("adaptive");
    expect(registry.presentationOf("card")).toBe("adaptive");
    render();
    expect(registry.presentationOf("card")).toBeUndefined();
  });
});
