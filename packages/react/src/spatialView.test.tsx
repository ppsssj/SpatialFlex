// @vitest-environment jsdom
import { SpatialRegistry } from "@spatialflex/core";
import {
  act,
  Component,
  StrictMode,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { SpatialItem, SpatialWorkspace, useSpatialViews } from "./index";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLElement;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
});
function render(ui: ReactNode) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => root!.render(ui));
}
function Discovery() {
  const views = useSpatialViews();
  return (
    <output data-views>
      {views
        .map(
          (v) =>
            `${v.id}:${v.body.kind === "value" ? v.body.value : v.body.kind}`,
        )
        .join(",")}
    </output>
  );
}
const body = (value: number) => ({
  kind: "value" as const,
  label: "Count",
  value: String(value),
});

it("discovers mounted views, updates application-owned state and revokes on unmount", () => {
  const registry = new SpatialRegistry();
  const invoke = vi.fn();
  const ui = (value: number, mounted = true) => (
    <SpatialWorkspace registry={registry}>
      {mounted && (
        <SpatialItem
          id="x"
          xr={{
            body: body(value),
            actions: [{ id: "add", label: "+1", invoke }],
          }}
        >
          Original
        </SpatialItem>
      )}
      <Discovery />
    </SpatialWorkspace>
  );
  render(ui(1));
  const original = container.querySelector("[data-spatialflex-panel]");
  expect(container.querySelector("[data-views]")!.textContent).toBe("x:1");
  render(ui(2));
  expect(container.querySelector("[data-spatialflex-panel]")).toBe(original);
  expect(container.querySelector("[data-views]")!.textContent).toBe("x:2");
  const record = registry.views()[0]!;
  act(() => {
    registry.invokeView("x", record.registrationId, "add");
  });
  expect(invoke).toHaveBeenCalledTimes(1);
  render(ui(2, false));
  expect(registry.views()).toEqual([]);
  expect(registry.invokeView("x", record.registrationId, "add")).toBe(false);
});

it("owns local React state, uses the latest closure and preserves the original mount through P0 detach", () => {
  const registry = new SpatialRegistry();
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Counter() {
    const [count, setCount] = useState(0);
    const [step, setStep] = useState(1);
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return (
      <SpatialItem
        id="local"
        detachable
        xr={{
          body: body(count),
          actions: [
            {
              id: "add",
              label: "Add",
              invoke: () => setCount((n) => n + step),
            },
          ],
        }}
      >
        <input aria-label="Original input" defaultValue="kept" />
        <button onClick={() => setStep(5)}>step</button>
        <output>{count}</output>
      </SpatialItem>
    );
  }
  render(
    <SpatialWorkspace registry={registry}>
      <Counter />
      <Discovery />
    </SpatialWorkspace>,
  );
  const record = registry.views()[0]!;
  const input = container.querySelector("input")!;
  input.focus();
  act(() => container.querySelector("button")!.click());
  // body/action labels did not change when the handler's captured step changed.
  expect(registry.views()[0]).toBe(record);
  act(() => {
    registry.invokeView("local", record.registrationId, "add");
  });
  expect(registry.getView("local")!.body).toEqual(body(5));
  act(() => {
    registry.detach("local");
  });
  act(() => {
    registry.attach("local");
  });
  expect(container.querySelector("input")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  act(() => root!.unmount());
  root = undefined;
  expect(unmounted).toHaveBeenCalledTimes(1);
  expect(registry.views()).toEqual([]);
});

it("rotates ownership on remount and xr disable/enable without remounting children", () => {
  const registry = new SpatialRegistry();
  const invoke = vi.fn();
  const ui = (mounted: boolean, enabled: boolean) => (
    <SpatialWorkspace registry={registry}>
      {mounted && (
        <SpatialItem
          id="same"
          xr={
            enabled
              ? { body: body(0), actions: [{ id: "add", label: "+1", invoke }] }
              : undefined
          }
        >
          <input />
        </SpatialItem>
      )}
    </SpatialWorkspace>
  );
  render(ui(true, true));
  const old = registry.views()[0]!;
  const input = container.querySelector("input");
  render(ui(true, false));
  expect(registry.views()).toEqual([]);
  render(ui(true, true));
  expect(container.querySelector("input")).toBe(input);
  expect(registry.invokeView("same", old.registrationId, "add")).toBe(false);
  const second = registry.views()[0]!;
  render(ui(false, true));
  render(ui(true, true));
  expect(registry.invokeView("same", second.registrationId, "add")).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it("StrictMode keeps one active registration and balanced view subscriptions", () => {
  const registry = new SpatialRegistry();
  const nativeSubscribe = registry.subscribeViews.bind(registry);
  let active = 0;
  vi.spyOn(registry, "subscribeViews").mockImplementation((listener) => {
    active++;
    const stop = nativeSubscribe(listener);
    return () => {
      active--;
      stop();
    };
  });
  render(
    <StrictMode>
      <SpatialWorkspace registry={registry}>
        <SpatialItem id="x" xr={{ body: body(1) }} />
        <Discovery />
      </SpatialWorkspace>
    </StrictMode>,
  );
  expect(registry.views()).toHaveLength(1);
  expect(active).toBe(1);
  act(() => root!.unmount());
  root = undefined;
  expect(active).toBe(0);
  expect(registry.views()).toEqual([]);
});

it("SSR and hydration use empty view snapshots without mutating an injected registry", () => {
  const registry = new SpatialRegistry();
  registry.register({ id: "external" }).setView({ body: body(9) });
  const ui = (
    <SpatialWorkspace registry={registry}>
      <SpatialItem id="x" xr={{ body: body(1) }}>
        Original
      </SpatialItem>
      <Discovery />
    </SpatialWorkspace>
  );
  const snapshot = registry.views();
  const html = renderToString(ui);
  expect(registry.views()).toBe(snapshot);
  expect(html).not.toContain("external:9");
  container = document.createElement("div");
  container.innerHTML = html;
  const recovered = vi.fn();
  act(() => {
    root = hydrateRoot(container, ui, { onRecoverableError: recovered });
  });
  expect(recovered).not.toHaveBeenCalled();
  expect(registry.views().map((v) => v.id)).toEqual(["external", "x"]);
  expect(container.querySelector("[data-views]")!.textContent).toBe(
    "external:9,x:1",
  );
});

it("duplicate declarations remain rejected and failed setup cleans the registration", () => {
  const registry = new SpatialRegistry();
  const errors: unknown[] = [];
  class Boundary extends Component<
    { children: ReactNode },
    { failed: boolean }
  > {
    override state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    override render() {
      return this.state.failed ? null : this.props.children;
    }
  }
  container = document.createElement("div");
  root = createRoot(container, { onCaughtError: (e) => errors.push(e) });
  render(
    <Boundary>
      <SpatialWorkspace registry={registry}>
        <SpatialItem id="x" xr={{ body: body(1) }} />
        <SpatialItem id="x" xr={{ body: body(2) }} />
      </SpatialWorkspace>
    </Boundary>,
  );
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain("already registered");
  expect(registry.views()).toEqual([]);
});
