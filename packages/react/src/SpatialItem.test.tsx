// @vitest-environment jsdom
import { SpatialRegistry, type SpatialItemRecord } from "@spatialflex/core";
import { act, Component, StrictMode, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialItem,
  useSpatialItems,
} from "./index";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement;
let caughtErrors: unknown[];

function render(ui: ReactNode) {
  if (!root) {
    container = document.createElement("div");
    caughtErrors = [];
    root = createRoot(container, {
      onCaughtError: (error) => caughtErrors.push(error),
    });
  }
  act(() => root!.render(ui));
}

function unmount() {
  act(() => root?.unmount());
  root = undefined;
}

afterEach(unmount);

const ids = (registry: SpatialRegistry) =>
  registry.list().map((item) => item.id);

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  override state = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    return this.state.error ? <p>failed</p> : this.props.children;
  }
}

describe("<SpatialItem>", () => {
  it("registers on mount and renders children inside its slot and panel", () => {
    const registry = new SpatialRegistry();
    render(
      <SpatialWorkspace registry={registry}>
        <SpatialItem id="image-a" detachable movable resizable>
          <img alt="Image A" />
        </SpatialItem>
      </SpatialWorkspace>,
    );

    expect(container.innerHTML).toBe(
      '<div data-spatialflex-item="image-a" data-status="attached">' +
        '<div data-spatialflex-panel="" data-status="attached">' +
        '<img alt="Image A"></div></div>',
    );
    expect(registry.get("image-a")).toMatchObject({
      status: "attached",
      capabilities: { detachable: true, movable: true, resizable: true },
    });
  });

  it("unregisters on unmount", () => {
    const registry = new SpatialRegistry();
    const view = (showB: boolean) => (
      <SpatialWorkspace registry={registry}>
        <SpatialItem id="image-a" />
        {showB && <SpatialItem id="image-b" />}
      </SpatialWorkspace>
    );

    render(view(true));
    expect(ids(registry)).toEqual(["image-a", "image-b"]);

    render(view(false));
    expect(ids(registry)).toEqual(["image-a"]);

    unmount();
    expect(ids(registry)).toEqual([]);
  });

  it("registers exactly once under StrictMode", () => {
    const registry = new SpatialRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);

    render(
      <StrictMode>
        <SpatialWorkspace registry={registry}>
          <SpatialItem id="image-a" />
          <SpatialItem id="image-b" />
        </SpatialWorkspace>
      </StrictMode>,
    );

    expect(caughtErrors).toEqual([]);
    expect(ids(registry)).toEqual(["image-a", "image-b"]);
    // StrictMode mounts, unmounts and mounts effects again.
    expect(listener).toHaveBeenCalledTimes(6);

    unmount();
    expect(ids(registry)).toEqual([]);
  });

  it("rejects a duplicate ID in the same workspace", () => {
    const registry = new SpatialRegistry();
    render(
      <SpatialWorkspace registry={registry}>
        <SpatialItem id="image-a" movable />
        <ErrorBoundary>
          <SpatialItem id="image-a" />
        </ErrorBoundary>
      </SpatialWorkspace>,
    );

    expect(caughtErrors).toEqual([
      expect.objectContaining({ code: "DUPLICATE_ITEM_ID" }),
    ]);
    expect(container.textContent).toBe("failed");
    expect(ids(registry)).toEqual(["image-a"]);
    expect(registry.get("image-a")?.capabilities.movable).toBe(true);
  });

  it("isolates items in separate workspaces", () => {
    const first = new SpatialRegistry();
    const second = new SpatialRegistry();
    render(
      <>
        <SpatialWorkspace registry={first}>
          <SpatialItem id="image-a" movable />
        </SpatialWorkspace>
        <SpatialWorkspace registry={second}>
          <SpatialItem id="image-a" />
          <SpatialItem id="image-b" />
        </SpatialWorkspace>
      </>,
    );

    expect(caughtErrors).toEqual([]);
    expect(ids(first)).toEqual(["image-a"]);
    expect(ids(second)).toEqual(["image-a", "image-b"]);
    expect(first.get("image-a")?.capabilities.movable).toBe(true);
    expect(second.get("image-a")?.capabilities.movable).toBe(false);
  });

  it("gives each workspace its own registry by default", () => {
    function Ids() {
      return useSpatialItems()
        .map((item) => item.id)
        .join(",");
    }
    render(
      <>
        <SpatialWorkspace>
          <SpatialItem id="image-a" />
          <Ids />
        </SpatialWorkspace>
        |
        <SpatialWorkspace>
          <SpatialItem id="image-a" />
          <SpatialItem id="image-b" />
          <Ids />
        </SpatialWorkspace>
      </>,
    );

    expect(caughtErrors).toEqual([]);
    expect(container.textContent).toBe("image-a|image-a,image-b");
  });

  it("throws outside a SpatialWorkspace", () => {
    render(
      <ErrorBoundary>
        <SpatialItem id="image-a" />
      </ErrorBoundary>,
    );

    expect(caughtErrors).toEqual([
      expect.objectContaining({ code: "MISSING_WORKSPACE" }),
    ]);
  });

  describe("rerenders", () => {
    const view = (
      registry: SpatialRegistry,
      props: Partial<ItemProps> = {},
    ) => (
      <SpatialWorkspace registry={registry}>
        <SpatialItem id="image-a" {...props} />
        <SpatialItem id="image-b" />
      </SpatialWorkspace>
    );
    type ItemProps = { id: string; movable: boolean };

    it("does not touch the registry when props are unchanged", () => {
      const registry = new SpatialRegistry();
      render(view(registry, { movable: true }));
      const snapshot = registry.list();
      const listener = vi.fn();
      registry.subscribe(listener);

      render(view(registry, { movable: true }));

      expect(listener).not.toHaveBeenCalled();
      expect(registry.list()).toBe(snapshot);
    });

    it("updates capabilities in place", () => {
      const registry = new SpatialRegistry();
      render(view(registry));
      const listener = vi.fn();
      registry.subscribe(listener);

      render(view(registry, { movable: true }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(ids(registry)).toEqual(["image-a", "image-b"]);
      expect(registry.get("image-a")?.capabilities.movable).toBe(true);
    });

    it("re-registers under a new ID with the current capabilities", () => {
      const registry = new SpatialRegistry();
      render(view(registry));

      render(view(registry, { id: "image-z", movable: true }));

      expect(ids(registry)).toEqual(["image-b", "image-z"]);
      expect(registry.get("image-z")?.capabilities.movable).toBe(true);
    });
  });
});

describe("useSpatialItems / useSpatialItem", () => {
  it("re-renders on registry changes and keeps snapshots stable otherwise", () => {
    const registry = new SpatialRegistry();
    const seen: (readonly SpatialItemRecord[])[] = [];
    function Probe() {
      seen.push(useSpatialItems());
      return null;
    }
    let setTick: (tick: number) => void = () => {};
    function App({ showB }: { showB: boolean }) {
      const [tick, set] = useState(0);
      setTick = set;
      return (
        <SpatialWorkspace registry={registry}>
          <SpatialItem id="image-a" />
          {showB && <SpatialItem id="image-b" />}
          <Probe />
          {tick}
        </SpatialWorkspace>
      );
    }

    render(<App showB />);
    const latest = seen.at(-1)!;
    expect(latest.map((item) => item.id)).toEqual(["image-a", "image-b"]);

    act(() => setTick(1));
    expect(seen.at(-1)).toBe(latest);

    render(<App showB={false} />);
    expect(seen.at(-1)!.map((item) => item.id)).toEqual(["image-a"]);
  });

  it("looks up a single item by ID", () => {
    let item: SpatialItemRecord | undefined;
    function Probe() {
      item = useSpatialItem("image-b");
      return null;
    }
    const view = (showB: boolean) => (
      <SpatialWorkspace>
        {showB && <SpatialItem id="image-b" resizable />}
        <Probe />
      </SpatialWorkspace>
    );

    render(view(true));
    expect(item?.capabilities.resizable).toBe(true);

    render(view(false));
    expect(item).toBeUndefined();
  });
});
