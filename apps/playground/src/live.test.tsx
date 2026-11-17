// @vitest-environment jsdom
//
// P0-04: detached SpatialItems stay functionally connected to the original
// application. These tests render the real playground <App> and measure four
// things separately: component identity (mount counts), domain actions,
// active subscriptions, and domain/layout state.
import { SpatialRegistry } from "@spatialflex/core";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createGalleryStore, type GalleryStore } from "./galleryStore";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Components in the playground that subscribe to the domain store:
// SharedCounter (app), ImageBControls, DomainImageB, SharedCounter (image-b).
const DOMAIN_SUBSCRIBERS = 4;
// Components that subscribe to the SpatialFlex registry: two DetachToggles,
// three SpatialItems and RegistryDebugView.
const REGISTRY_SUBSCRIBERS = 6;

let root: Root | undefined;
let container: HTMLElement;
let store: GalleryStore;
let registry: SpatialRegistry;
let registrySubscriptions: { active: number; total: number };

/** Counts active registry subscriptions without changing the SDK. */
function instrumentRegistry(target: SpatialRegistry) {
  const subscribe = target.subscribe.bind(target);
  registrySubscriptions = { active: 0, total: 0 };
  target.subscribe = (listener) => {
    const unsubscribe = subscribe(listener);
    registrySubscriptions.active++;
    registrySubscriptions.total++;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      registrySubscriptions.active--;
      unsubscribe();
    };
  };
}

function render(wrap: (ui: ReactNode) => ReactNode = (ui) => ui) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(wrap(<App store={store} registry={registry} />)));
}

function unmount() {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
}

beforeEach(() => {
  // jsdom has no layout: give the viewport a size so panels can move.
  const html = document.documentElement;
  Object.defineProperty(html, "clientWidth", {
    configurable: true,
    value: 1024,
  });
  Object.defineProperty(html, "clientHeight", {
    configurable: true,
    value: 768,
  });
  store = createGalleryStore();
  registry = new SpatialRegistry();
  instrumentRegistry(registry);
});

afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

// --- DOM helpers -----------------------------------------------------------

const byTestId = <T extends HTMLElement = HTMLElement>(
  id: string,
  scope: ParentNode = container,
) => scope.querySelector<T>(`[data-testid="${id}"]`)!;
const item = (id: string) =>
  container.querySelector<HTMLElement>(`[data-spatialflex-item="${id}"]`)!;
const imageB = () => item("image-b");
const appCount = () => byTestId("shared-count-app").textContent;
const imageBCount = () =>
  byTestId("shared-count-image-b", imageB()).textContent;
const statusB = () => imageB().dataset.status;
const click = (element: HTMLElement) => act(() => element.click());
const clickButton = (text: string) =>
  click(
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === text,
    )!,
  );
const detachB = () => clickButton("Detach Image B");
const attachB = () => clickButton("Attach Image B");
const incrementFromApp = () => click(byTestId("increment-app"));
const incrementFromImageB = () =>
  click(byTestId("increment-image-b", imageB()));
const localCount = () => byTestId("count", imageB()).textContent;
const instance = () => byTestId("instance", imageB()).textContent;
const lifecycleText = () => byTestId("lifecycle", imageB()).textContent;

function drag(dx: number, dy: number) {
  const bar = imageB().querySelector("[data-spatialflex-panel-bar] span")!;
  const fire = (type: string, x: number, y: number) =>
    act(() => {
      bar.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          pointerId: 7,
          clientX: x,
          clientY: y,
        }),
      );
    });
  fire("pointerdown", 10, 10);
  fire("pointermove", 10 + dx, 10 + dy);
  fire("pointerup", 10 + dx, 10 + dy);
}

function setValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const actions = () => store.getDiagnostics().actionCalls.increment;
const activeDomainSubscriptions = () =>
  store.getDiagnostics().activeSubscriptions;

// --- Tests -----------------------------------------------------------------

describe("bidirectional shared counter (issue walkthrough)", () => {
  it("keeps both views consistent and runs one action per click", () => {
    render();
    const imageBInstance = instance();

    // 1. Starts at 0.
    expect([appCount(), imageBCount()]).toEqual(["0", "0"]);

    // 2-3. Original UI → both views.
    incrementFromApp();
    expect([appCount(), imageBCount()]).toEqual(["1", "1"]);
    expect(actions()).toBe(1);

    // 4. Detach.
    detachB();
    expect(statusB()).toBe("detached");

    // 5-6. Detached Image B → original app.
    incrementFromImageB();
    expect([appCount(), imageBCount()]).toEqual(["2", "2"]);
    expect(actions()).toBe(2);

    // 7. Move.
    const before = store.getState();
    drag(120, 80);
    expect(registry.get("image-b")?.layout.position).toEqual({ x: 120, y: 80 });
    expect(store.getState()).toBe(before); // moving touches no domain state

    // 8-9. Original UI again.
    incrementFromApp();
    expect([appCount(), imageBCount()]).toEqual(["3", "3"]);
    expect(actions()).toBe(3);

    // 10-11. Attach.
    attachB();
    expect(statusB()).toBe("attached");
    expect([appCount(), imageBCount()]).toEqual(["3", "3"]);

    expect(store.getState().sharedCount).toBe(3);
    expect(actions()).toBe(3);
    expect(instance()).toBe(imageBInstance);
  });
});

describe("A/B. state and actions in both directions", () => {
  it("A. original-app updates reach detached Image B", () => {
    render();
    detachB();

    incrementFromApp();
    incrementFromApp();

    expect(imageBCount()).toBe("2");
    expect(statusB()).toBe("detached");
  });

  it("B. actions in detached Image B update the original app", () => {
    render();
    detachB();

    incrementFromImageB();

    expect(appCount()).toBe("1");
    expect(store.getState().sharedCount).toBe(1);
  });

  it("both buttons call the same application-owned action", () => {
    const increment = vi.spyOn(store.actions, "increment");
    render();
    detachB();

    incrementFromApp();
    incrementFromImageB();

    expect(increment).toHaveBeenCalledTimes(2);
  });
});

describe("C. exactly-once action processing", () => {
  it("processes each click once, attached, detached, after moving and after re-attaching", () => {
    render();
    const listener = vi.fn();
    store.subscribe(listener);

    incrementFromImageB();
    detachB();
    incrementFromImageB();
    drag(50, 50);
    drag(-20, 30);
    incrementFromImageB();
    incrementFromApp();
    attachB();
    incrementFromImageB();

    expect(actions()).toBe(5);
    expect(store.getState().sharedCount).toBe(5);
    expect(listener).toHaveBeenCalledTimes(5); // one state change per action
  });
});

describe("D. dynamic image data while detached", () => {
  it("updates the same <img> and caption without remounting", () => {
    render();
    detachB();
    const img = imageB().querySelector("img")!;
    const caption = imageB().querySelector("figcaption")!;
    const srcBefore = img.src;
    const imageBInstance = instance();

    setValue(byTestId<HTMLSelectElement>("image-b-variant"), "night");
    setValue(byTestId<HTMLInputElement>("image-b-caption"), "Night shift");

    expect(imageB().querySelector("img")).toBe(img);
    expect(imageB().querySelector("figcaption")).toBe(caption);
    expect(img.src).not.toBe(srcBefore);
    expect(decodeURIComponent(img.src)).toContain("#1e3a8a");
    expect(img.alt).toBe("Image B · night");
    expect(caption.textContent).toBe("Night shift");
    expect(container.querySelectorAll('img[alt^="Image B"]')).toHaveLength(1);
    expect(store.getDiagnostics().actionCalls).toMatchObject({
      setImageVariant: 1,
      setImageCaption: 1,
    });
    expect(instance()).toBe(imageBInstance);
    expect(statusB()).toBe("detached");
  });
});

describe("E. local React state is independent of domain state", () => {
  it("keeps local useState and component identity across detach, move and attach", () => {
    render();
    const imageBInstance = instance();
    const lifecycle = lifecycleText();
    const localButton = byTestId("live-counter", imageB()).querySelector(
      "button",
    )!;
    for (let i = 0; i < 5; i++) click(localButton);

    detachB();
    expect(localCount()).toBe("5");
    click(localButton);
    drag(40, 40);
    expect(localCount()).toBe("6");
    attachB();

    expect(localCount()).toBe("6");
    // Local clicks are not domain actions, and domain state is untouched.
    expect(actions()).toBe(0);
    expect(store.getState().sharedCount).toBe(0);
    // Identity: same instance, same mount counts, same DOM node.
    expect(instance()).toBe(imageBInstance);
    expect(lifecycleText()).toBe(lifecycle);
    expect(byTestId("live-counter", imageB()).querySelector("button")).toBe(
      localButton,
    );
  });
});

describe("F. React context", () => {
  it("delivers context changes to the detached item", () => {
    render();
    detachB();
    expect(byTestId("theme", imageB()).textContent).toBe("ocean");

    setValue(byTestId<HTMLSelectElement>("theme-select"), "sunset");

    expect(byTestId("theme", imageB()).textContent).toBe("sunset");
    expect(statusB()).toBe("detached");
  });
});

describe("G. repetition", () => {
  it("does not add subscriptions or duplicate events over 20 detach/attach cycles", () => {
    render();
    const domainTotals = store.getDiagnostics();
    const registryTotal = registrySubscriptions.total;
    expect(activeDomainSubscriptions()).toBe(DOMAIN_SUBSCRIBERS);
    expect(registrySubscriptions.active).toBe(REGISTRY_SUBSCRIBERS);
    const imageBInstance = instance();

    for (let i = 0; i < 20; i++) {
      detachB();
      drag(5, 5);
      expect(activeDomainSubscriptions()).toBe(DOMAIN_SUBSCRIBERS);
      attachB();
    }

    expect(activeDomainSubscriptions()).toBe(DOMAIN_SUBSCRIBERS);
    // No subscriber re-subscribed at all: detaching re-renders, not remounts.
    expect(store.getDiagnostics().totalSubscribes).toBe(
      domainTotals.totalSubscribes,
    );
    expect(registrySubscriptions.active).toBe(REGISTRY_SUBSCRIBERS);
    expect(registrySubscriptions.total).toBe(registryTotal);

    incrementFromImageB();
    expect(actions()).toBe(1);
    expect([appCount(), imageBCount()]).toEqual(["1", "1"]);
    expect(instance()).toBe(imageBInstance);
    expect(
      container.querySelectorAll("[data-testid=shared-count-image-b]"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll("[data-spatialflex-panel-bar]"),
    ).toHaveLength(0);
  });
});

describe("resize and domain state", () => {
  it("resizing changes layout only: no domain action, state or subscription change", () => {
    render();
    detachB();
    const state = store.getState();
    const diagnostics = store.getDiagnostics();
    const imageBInstance = instance();
    const handle = imageB().querySelector("[data-spatialflex-resize-handle]")!;
    const fire = (type: string, x: number, y: number) =>
      act(() => {
        handle.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            pointerId: 9,
            clientX: x,
            clientY: y,
          }),
        );
      });

    fire("pointerdown", 100, 100);
    fire("pointermove", 400, 400);
    fire("pointerup", 400, 400);

    expect(registry.get("image-b")?.layout.size).not.toBeNull();
    expect(store.getState()).toBe(state);
    expect(store.getDiagnostics()).toBe(diagnostics);
    expect(instance()).toBe(imageBInstance);
    incrementFromImageB();
    expect(actions()).toBe(1);
    expect([appCount(), imageBCount()]).toEqual(["1", "1"]);
  });
});

describe("H. unmount", () => {
  it("removes all domain subscriptions and registrations, also when detached", () => {
    render();
    detachB();
    expect(registry.list()).toHaveLength(3);

    unmount();

    expect(activeDomainSubscriptions()).toBe(0);
    const { totalSubscribes, totalUnsubscribes } = store.getDiagnostics();
    expect(totalUnsubscribes).toBe(totalSubscribes);
    expect(registrySubscriptions.active).toBe(0);
    expect(registry.list()).toEqual([]);
  });
});

describe("I. Images A and C", () => {
  it("are unaffected by Image B's lifecycle and domain changes", () => {
    render();
    const imageA = item("image-a").outerHTML;
    const imageC = item("image-c").outerHTML;

    detachB();
    drag(60, 60);
    incrementFromImageB();
    setValue(byTestId<HTMLInputElement>("image-b-caption"), "Changed");
    attachB();

    expect(item("image-a").outerHTML).toBe(imageA);
    expect(item("image-c").outerHTML).toBe(imageC);
    expect(registry.get("image-a")?.status).toBe("attached");
    expect(registry.get("image-c")?.status).toBe("attached");
  });

  it("registry records hold no domain data", () => {
    render();
    detachB();
    incrementFromImageB();

    for (const record of registry.list()) {
      expect(Object.keys(record).sort()).toEqual([
        "capabilities",
        "id",
        "layout",
        "status",
      ]);
      expect(JSON.stringify(record)).not.toMatch(/sharedCount|caption|variant/);
    }
  });
});

describe("J. StrictMode", () => {
  it("leaves exactly one active subscription per subscriber and one action per click", () => {
    render((ui) => <StrictMode>{ui}</StrictMode>);

    // StrictMode subscribes, unsubscribes and subscribes again on mount in
    // development. That is expected, so assert the active count, not totals.
    const mountTotals = store.getDiagnostics();
    expect(activeDomainSubscriptions()).toBe(DOMAIN_SUBSCRIBERS);
    expect(mountTotals.totalSubscribes - mountTotals.totalUnsubscribes).toBe(
      DOMAIN_SUBSCRIBERS,
    );
    expect(registrySubscriptions.active).toBe(REGISTRY_SUBSCRIBERS);
    const imageBInstance = instance();
    const lifecycle = lifecycleText();

    incrementFromApp();
    detachB();
    incrementFromImageB();
    drag(30, 30);
    attachB();

    expect(actions()).toBe(2);
    expect([appCount(), imageBCount()]).toEqual(["2", "2"]);
    expect(activeDomainSubscriptions()).toBe(DOMAIN_SUBSCRIBERS);
    expect(store.getDiagnostics().totalSubscribes).toBe(
      mountTotals.totalSubscribes,
    );
    expect(registrySubscriptions.active).toBe(REGISTRY_SUBSCRIBERS);
    expect(instance()).toBe(imageBInstance);
    expect(lifecycleText()).toBe(lifecycle);

    unmount();
    expect(activeDomainSubscriptions()).toBe(0);
    expect(registrySubscriptions.active).toBe(0);
  });
});
