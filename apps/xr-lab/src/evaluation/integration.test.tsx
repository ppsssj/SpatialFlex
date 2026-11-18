// @vitest-environment jsdom
//
// The same contract tests for every integration mode. Each mode is driven
// only through the shared IntegrationModule interface and the shared app
// fixture; no mode gets test-only access.
import { act, StrictMode, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Dashboard,
  LabStoreContext,
  createLabStore,
  type LabStore,
} from "../fixtures";
import { baselineIntegration } from "../integrations/baseline";
import type {
  IntegrationModule,
  LabIntegration,
} from "../integrations/contract";
import { spatialflexIntegration } from "../integrations/spatialflex";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MODES: IntegrationModule[] = [
  baselineIntegration,
  spatialflexIntegration,
];
const ITEMS = ["shared-counter", "live-chart", "image-panel"];

let lab: LabIntegration;
function Capture({ integration }: { integration: IntegrationModule }) {
  const value = integration.useIntegration();
  useEffect(() => {
    lab = value;
  });
  return (
    <Dashboard
      {...(value.renderWidget && { renderWidget: value.renderWidget })}
    />
  );
}

let root: Root | undefined;
let container: HTMLElement;
let store: LabStore;

function render(integration: IntegrationModule, wrap = (ui: ReactNode) => ui) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const { Provider } = integration;
  act(() =>
    root!.render(
      wrap(
        <LabStoreContext value={store}>
          <Provider>
            <Capture integration={integration} />
          </Provider>
        </LabStoreContext>,
      ),
    ),
  );
}

function unmount() {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
}

beforeEach(() => {
  store = createLabStore();
});
afterEach(unmount);

const webCount = () =>
  container.querySelector('[data-testid="web-count"]')!.textContent;
const clickWebIncrement = () =>
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[data-testid="web-increment"]')!
      .click(),
  );
const panel = (id: string) => lab.panels.find((p) => p.id === id);
const counterValue = () => {
  const body = panel("shared-counter")?.body;
  return body?.kind === "value" ? body.value : undefined;
};

describe("SpatialFlex strategy integration", () => {
  it("keeps one presentation, rejects old presentation actions and preserves mount/subscription counts", () => {
    render(spatialflexIntegration);
    const original = container.querySelector('[data-testid="web-count"]');
    const initial = store.getDiagnostics();
    act(() =>
      lab.detach!("shared-counter", {
        mode: "move",
        source: "collapse",
        target: "web",
      }),
    );
    expect(lab.items.find((v) => v.id === "shared-counter")?.detached).toBe(
      true,
    );
    act(() => lab.show("shared-counter"));
    expect(lab.items.find((v) => v.id === "shared-counter")?.detached).toBe(
      false,
    );
    const old = lab;
    const owner = old.actionOwners!["shared-counter"];
    act(() => lab.hide("shared-counter"));
    act(() => lab.show("shared-counter"));
    expect(lab.actionOwners!["shared-counter"]).not.toBe(owner);
    act(() => old.onPanelButton("shared-counter", "increment"));
    expect(webCount()).toBe("0");
    act(() => lab.onPanelButton("shared-counter", "increment"));
    expect(webCount()).toBe("1");
    act(() =>
      lab.detach!("shared-counter", {
        mode: "move",
        source: "placeholder",
        target: "web",
      }),
    );
    expect(lab.panels).toHaveLength(0);
    expect(container.querySelector('[data-testid="web-count"]')).toBe(original);
    expect(store.getDiagnostics().componentMounts).toEqual(
      initial.componentMounts,
    );
    expect(store.getDiagnostics().activeSubscriptions).toBe(
      initial.activeSubscriptions,
    );
    expect(() =>
      lab.show("shared-counter", {
        mode: "move",
        source: "collapse",
        target: "web",
      }),
    ).toThrow(/Mirror/);
  });
});
const increments = () => store.getDiagnostics().actionCalls.increment;
const run = (fn: () => unknown) => {
  let result: unknown;
  act(() => {
    result = fn();
  });
  return result;
};

describe.each(MODES)("$id integration", (integration) => {
  it("offers the three dashboard items", () => {
    render(integration);
    expect(lab.items.map((item) => item.id).sort()).toEqual([...ITEMS].sort());
    expect(lab.panels).toEqual([]);
  });

  it("keeps the original dashboard working", () => {
    render(integration);
    clickWebIncrement();
    clickWebIncrement();
    expect(webCount()).toBe("2");
    expect(increments()).toBe(2);
  });

  it("1. reflects web actions in the XR panel", () => {
    render(integration);
    run(() => lab.show("shared-counter"));
    expect(counterValue()).toBe("0");

    clickWebIncrement();

    expect(counterValue()).toBe("1");
  });

  it("2. runs XR panel actions as the app's own action", () => {
    render(integration);
    run(() => lab.show("shared-counter"));

    run(() => lab.onPanelButton("shared-counter", "increment"));

    expect(webCount()).toBe("1");
    expect(counterValue()).toBe("1");
    expect(store.getState().actionCount).toBe(1);
  });

  it("3. processes each action exactly once", () => {
    render(integration);
    run(() => lab.show("shared-counter"));

    for (let i = 0; i < 3; i++)
      run(() => lab.onPanelButton("shared-counter", "increment"));
    for (let i = 0; i < 2; i++) clickWebIncrement();

    expect(increments()).toBe(5);
    expect(store.getState()).toMatchObject({ sharedCount: 5, actionCount: 5 });
    expect([webCount(), counterValue()]).toEqual(["5", "5"]);
  });

  it("4. moves and selects panels without touching domain state", () => {
    render(integration);
    run(() => lab.show("shared-counter"));
    const state = store.getState();
    const [x, y, z] = panel("shared-counter")!.position;

    run(() => lab.move("shared-counter", [0.1, -0.2, 0]));
    run(() => lab.onPanelSelect("shared-counter"));

    expect(panel("shared-counter")!.position).toEqual([x + 0.1, y - 0.2, z]);
    expect(panel("shared-counter")!.selected).toBe(true);
    expect(store.getState()).toBe(state);
  });

  it("5. keeps app state across 20 show/hide cycles", () => {
    render(integration);
    run(() => lab.show("shared-counter"));
    run(() => lab.onPanelButton("shared-counter", "increment"));
    const subscriptions = store.getDiagnostics().activeSubscriptions;

    for (let i = 0; i < 20; i++) {
      run(() => lab.hide("shared-counter"));
      expect(lab.panels).toEqual([]);
      run(() => lab.show("shared-counter"));
    }
    run(() => lab.onPanelClose("shared-counter"));

    expect(lab.panels).toEqual([]);
    expect(store.getState().sharedCount).toBe(1);
    expect(store.getDiagnostics().activeSubscriptions).toBe(subscriptions);
    run(() => lab.show("shared-counter"));
    expect(counterValue()).toBe("1");
    expect(panel("shared-counter")!.position).toEqual([0, 1.4, -1.2]);
  });

  it("6. removes the XR panel when its widget unmounts", () => {
    render(integration);
    run(() => lab.show("image-panel"));
    expect(panel("image-panel")).toBeDefined();

    run(() => store.actions.setImageMounted(false));

    expect(panel("image-panel")).toBeUndefined();
    expect(lab.items.map((item) => item.id)).not.toContain("image-panel");
    expect(run(() => lab.show("image-panel"))).toBe(false);
    run(() => lab.onPanelButton("image-panel", "next-variant"));
    expect(store.getDiagnostics().actionCalls.setImageVariant).toBe(0);

    run(() => store.actions.setImageMounted(true));
    expect(lab.items.find((item) => item.id === "image-panel")?.shown).toBe(
      false,
    );
  });

  it("6. releases every subscription on unmount", () => {
    render(integration);
    run(() => lab.show("shared-counter"));
    expect(store.getDiagnostics().activeSubscriptions).toBeGreaterThan(0);

    unmount();

    expect(store.getDiagnostics().activeSubscriptions).toBe(0);
  });

  it("7. rejects unknown items, buttons and hidden panels", () => {
    render(integration);
    expect(run(() => lab.show("unknown-item"))).toBe(false);
    expect(run(() => lab.show(""))).toBe(false);
    expect(lab.panels).toEqual([]);

    run(() => lab.onPanelButton("unknown-item", "increment"));
    run(() => lab.onPanelButton("shared-counter", "increment")); // not shown
    run(() => lab.show("shared-counter"));
    run(() => lab.onPanelButton("shared-counter", "unknown-button"));

    expect(increments()).toBe(0);
    expect(run(() => lab.hide("live-chart"))).toBe(false);
    expect(run(() => lab.move("live-chart", [1, 0, 0]))).toBe(false);
  });

  it("runs the image panel's action through the app", () => {
    render(integration);
    run(() => lab.show("image-panel"));

    run(() => lab.onPanelButton("image-panel", "next-variant"));

    expect(store.getState().imageVariant).toBe("night");
    expect(panel("image-panel")!.body).toMatchObject({
      kind: "swatch",
      caption: "night",
    });
  });

  it("behaves the same under StrictMode", () => {
    render(integration, (ui) => <StrictMode>{ui}</StrictMode>);
    run(() => lab.show("shared-counter"));
    run(() => lab.onPanelButton("shared-counter", "increment"));
    clickWebIncrement();

    expect(increments()).toBe(2);
    expect([webCount(), counterValue()]).toEqual(["2", "2"]);
    unmount();
    expect(store.getDiagnostics().activeSubscriptions).toBe(0);
  });
});

describe("mode-specific wiring", () => {
  it("baseline renders widgets without SpatialFlex", () => {
    render(baselineIntegration);
    expect(lab.source).toBe("static list in the baseline integration");
    expect(container.querySelector("[data-spatialflex-item]")).toBeNull();
  });

  it("spatialflex registers each widget as a SpatialItem", () => {
    render(spatialflexIntegration);
    expect(lab.source).toBe("SpatialFlex registry");
    const registered = [
      ...container.querySelectorAll("[data-spatialflex-item]"),
    ].map((el) => el.getAttribute("data-spatialflex-item"));
    expect(registered).toEqual(ITEMS);
  });
});
