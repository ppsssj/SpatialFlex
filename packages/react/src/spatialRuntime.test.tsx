// @vitest-environment jsdom
import { SpatialRegistry } from "@spatialflex/core";
import { act, StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialPlacement,
  useSpatialRegistry,
} from "./index.js";
import {
  useSpatialManipulationState,
  useSpatialPresentations,
  type SpatialPresentations,
} from "./spatial.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const at = { position: [0, 1.5, -1] as const };
const ray = (x: number) => ({
  origin: [x, 1.5, 0] as const,
  direction: [0, 0, -1] as const,
});

let mounts = 0;
function Card({ name }: { name: string }) {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    mounts++;
  }, []);
  return (
    <button data-card={name} onClick={() => setClicks((n) => n + 1)}>
      {clicks}
    </button>
  );
}

/** Captures what the hooks return inside a workspace. */
const seen: Record<
  string,
  {
    spatial: SpatialPresentations;
    placement: string | null;
    registry: SpatialRegistry;
    active: unknown;
  }
> = {};
function Probe({ name }: { name: string }) {
  const spatial = useSpatialPresentations();
  const placement = useSpatialPlacement("card");
  const registry = useSpatialRegistry();
  const { active } = useSpatialManipulationState(spatial.runtime);
  useEffect(() => {
    seen[name] = { spatial, placement, registry, active };
  });
  return <output data-probe={name}>{placement ?? "attached"}</output>;
}

function App({
  showCard = true,
  showProbe = true,
  registry,
  name = "a",
}: {
  showCard?: boolean;
  showProbe?: boolean;
  registry?: SpatialRegistry;
  name?: string;
}) {
  return (
    <SpatialWorkspace {...(registry && { registry })}>
      {showProbe && <Probe name={name} />}
      {showCard && (
        <SpatialItem id="card" label="Card" detachable>
          <Card name={name} />
        </SpatialItem>
      )}
    </SpatialWorkspace>
  );
}

let root: Root;
let container: HTMLDivElement;
const render = (ui: ReactNode) =>
  act(() => root.render(<StrictMode>{ui}</StrictMode>));
const panel = (name = "a") =>
  container
    .querySelector(`[data-card="${name}"]`)!
    .closest<HTMLElement>("[data-spatialflex-panel]")!;
beforeEach(() => {
  mounts = 0;
  for (const key of Object.keys(seen)) delete seen[key];
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useSpatialPlacement (reactive placement)", () => {
  it("re-renders on extraction, restore, unmount and re-registration", () => {
    render(<App />);
    const probe = () => container.querySelector("[data-probe=a]")!.textContent;
    expect(probe()).toBe("attached");
    act(() => {
      seen.a!.spatial.runtime.extract("card", "native", at);
    });
    expect(probe()).toBe("external");
    act(() => {
      seen.a!.spatial.runtime.restore("card");
    });
    expect(probe()).toBe("attached");
    act(() => {
      seen.a!.spatial.runtime.extract("card", "native", at);
    });
    const key = seen.a!.registry.registrationOf("card");
    render(<App showCard={false} />);
    expect(probe()).toBe("attached");
    expect(seen.a!.spatial.presentations).toEqual([]);
    render(<App />);
    expect(probe()).toBe("attached");
    expect(seen.a!.registry.registrationOf("card")).not.toBe(key);
  });
});

describe("useSpatialPresentations (React bindings)", () => {
  it("reconciles native targets and handles; unmount mid-drag invalidates the session", () => {
    const added = vi.spyOn(HTMLElement.prototype, "addEventListener");
    render(<App />);
    const element = panel();
    const card = container.querySelector("[data-card=a]");
    act(() => {
      expect(seen.a!.spatial.runtime.extract("card", "native", at).ok).toBe(
        true,
      );
    });
    // Same node, one presentation, handles bound once per type.
    expect(container.querySelector("[data-card=a]")).toBe(card);
    expect(seen.a!.spatial.presentations).toMatchObject([
      { itemId: "card", kind: "native", instanceId: "native-1" },
    ]);
    const onPanel = (type: string) =>
      added.mock.calls.filter(
        (c, i) => added.mock.contexts[i] === element && c[0] === type,
      ).length;
    expect(onPanel("pointerdown")).toBe(1);
    expect(onPanel("keydown")).toBe(1);
    // SpatialItem rendered its handles; a session starts through them.
    const runtime = seen.a!.spatial.runtime;
    const token = runtime.manipulation.begin("card", "translate", 1, ray(0))!;
    act(() => runtime.manipulation.update(token, ray(0.2)));
    expect(seen.a!.active).toMatchObject({ itemId: "card", mode: "translate" });
    // Unmount during the drag: the presentation ends with the registration.
    render(<App showCard={false} />);
    expect(seen.a!.spatial.presentations).toEqual([]);
    expect(seen.a!.active).toBeNull();
    act(() => runtime.manipulation.update(token, ray(0.5)));
    render(<App />);
    act(() => runtime.manipulation.end(token, true));
    expect(runtime.manipulation.poseOf("card")).toBeUndefined();
    expect(seen.a!.spatial.presentations).toEqual([]);
  });

  it("restore releases only SDK-owned state; the component keeps its state and mounts", () => {
    render(<App />);
    const button = container.querySelector<HTMLButtonElement>("[data-card=a]")!;
    act(() => button.click());
    const before = mounts;
    const runtime = seen.a!.spatial.runtime;
    act(() => {
      runtime.extract("card", "native", at);
    });
    const host = runtime.connectHost();
    act(() => {
      runtime.restore("card");
    });
    expect(
      Object.keys(panel().dataset).filter(
        (k) => !k.startsWith("spatialflex") && k !== "status",
      ),
    ).toEqual([]);
    expect(panel().style.transform).toBe("");
    expect(container.querySelector("[data-card=a]")).toBe(button);
    expect(button.textContent).toBe("1");
    expect(mounts).toBe(before);
    host.disconnect();
  });

  it("unmounting the bindings ends every presentation and restores the original", () => {
    render(<App />);
    act(() => {
      seen.a!.spatial.runtime.extract("card", "native", at);
    });
    const registry = seen.a!.registry;
    render(<App showProbe={false} />);
    expect(registry.get("card")!.status).toBe("attached");
    expect(panel().dataset.spatialflexPlacement).toBeUndefined();
  });

  it("two workspaces with the same item id are independent", () => {
    act(() =>
      root.render(
        <StrictMode>
          <App name="a" />
          <App name="b" />
        </StrictMode>,
      ),
    );
    const a = seen.a!;
    const b = seen.b!;
    expect(a.registry).not.toBe(b.registry);
    expect(a.spatial.runtime).not.toBe(b.spatial.runtime);
    expect(a.registry.registrationOf("card")).not.toBe(
      b.registry.registrationOf("card"),
    );
    act(() => {
      a.spatial.runtime.extract("card", "native", at);
    });
    expect(seen.a!.placement).toBe("external");
    expect(seen.b!.placement).toBeNull();
    expect(seen.b!.spatial.presentations).toEqual([]);
    expect(panel("b").dataset.spatialflexPlacement).toBeUndefined();
    const token = a.spatial.runtime.manipulation.begin(
      "card",
      "translate",
      1,
      ray(0),
    );
    expect(token).not.toBeNull();
    expect(
      b.spatial.runtime.manipulation.begin("card", "translate", 1, ray(0)),
    ).toBeNull();
    // Handles are bound on A's element only.
    expect(
      panel("a").querySelector("[data-spatialflex-handle]"),
    ).not.toBeNull();
    expect(panel("b").querySelector("[data-spatialflex-handle]")).toBeNull();
  });

  it("a replaced workspace provider gets a new runtime; the old one is released", () => {
    const first = new SpatialRegistry();
    render(<App registry={first} />);
    const oldRuntime = seen.a!.spatial.runtime;
    act(() => {
      oldRuntime.extract("card", "native", at);
    });
    const second = new SpatialRegistry();
    render(<App registry={second} />);
    expect(seen.a!.spatial.runtime).not.toBe(oldRuntime);
    expect(seen.a!.registry).toBe(second);
    expect(oldRuntime.getSnapshot().presentations).toEqual([]);
    expect(seen.a!.spatial.presentations).toEqual([]);
    expect(oldRuntime.extract("card", "native", at)).toMatchObject({
      ok: false,
    });
    act(() => {
      expect(seen.a!.spatial.runtime.extract("card", "native", at).ok).toBe(
        true,
      );
    });
  });

  it("repeated StrictMode mounts leave no registry subscription behind", () => {
    const registry = new SpatialRegistry();
    const live = { items: 0, views: 0 };
    const subscribe = registry.subscribe.bind(registry);
    const subscribeViews = registry.subscribeViews.bind(registry);
    vi.spyOn(registry, "subscribe").mockImplementation((listener) => {
      live.items++;
      const stop = subscribe(listener);
      return () => {
        live.items--;
        stop();
      };
    });
    vi.spyOn(registry, "subscribeViews").mockImplementation((listener) => {
      live.views++;
      const stop = subscribeViews(listener);
      return () => {
        live.views--;
        stop();
      };
    });
    for (let i = 0; i < 3; i++) {
      render(<App registry={registry} />);
      act(() => {
        seen.a!.spatial.runtime.extract("card", "native", at);
      });
      render(<App registry={registry} showProbe={false} showCard={false} />);
      expect(live.views).toBe(0);
    }
    // Only the hooks' own subscriptions remain while nothing is mounted.
    expect(live.items).toBe(0);
  });

  it("renders on the server with an empty snapshot", () => {
    const html = renderToString(<App />);
    expect(html).toContain('data-probe="a"');
    expect(html).toContain("attached");
  });
});
