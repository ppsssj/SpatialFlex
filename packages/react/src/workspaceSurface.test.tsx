// @vitest-environment jsdom
// P1-08B1: two independent React Surfaces (each its own <SpatialWorkspace>,
// registry and runtime) registered in one WorkspaceCoordinator.
import type { SurfaceGeometry } from "@spatialflex/core/workspace";
import { act, StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpatialItem, SpatialWorkspace } from "./index.js";
import {
  useSpatialSurface,
  useWorkspaceCoordinator,
  useWorkspaceSurfaces,
  type SpatialSurfaceState,
  type WorkspaceCoordinator,
} from "./spatial.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const geometry = (x: number): SurfaceGeometry => ({
  resolution: { width: 400, height: 300 },
  metersPerPixel: 0.0025,
  pose: { position: [x, 1.4, -1.5], rotation: [0, 0, 0, 1], scale: 1 },
});
const A_GEO = geometry(-0.6);
const B_GEO = geometry(0.6);
const at = { position: [0, 1.5, -1] as const };

const mounts: string[] = [];
const actions: string[] = [];
function Counter({ surface }: { surface: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    mounts.push(surface);
  }, [surface]);
  return (
    <button data-counter={surface} onClick={() => setN((v) => v + 1)}>
      {n}
    </button>
  );
}

const seen: Record<string, SpatialSurfaceState> = {};
let coordinatorSeen: WorkspaceCoordinator | null = null;

function SurfaceProbe({
  coordinator,
  id,
  geo,
}: {
  coordinator: WorkspaceCoordinator;
  id: string;
  geo: SurfaceGeometry;
}) {
  const state = useSpatialSurface(coordinator, id, { geometry: geo });
  useEffect(() => {
    seen[id] = state;
  });
  return null;
}

/** One Surface: its own <SpatialWorkspace> and an item with the same id. */
function Surface({
  coordinator,
  id,
  geo,
}: {
  coordinator: WorkspaceCoordinator;
  id: string;
  geo: SurfaceGeometry;
}) {
  return (
    <SpatialWorkspace>
      <SurfaceProbe coordinator={coordinator} id={id} geo={geo} />
      <SpatialItem
        id="chart"
        label="Chart"
        detachable
        xr={{
          body: { kind: "value", label: "surface", value: id },
          actions: [
            {
              id: "act",
              label: "Act",
              invoke: () => actions.push(id),
            },
          ],
        }}
      >
        <Counter surface={id} />
      </SpatialItem>
    </SpatialWorkspace>
  );
}

function App({
  showA = true,
  aGeo = A_GEO,
}: {
  showA?: boolean;
  aGeo?: SurfaceGeometry;
}) {
  const coordinator = useWorkspaceCoordinator();
  const { surfaces } = useWorkspaceSurfaces(coordinator);
  useEffect(() => {
    coordinatorSeen = coordinator;
  });
  return (
    <>
      <output data-surfaces>
        {surfaces.map((s) => `${s.ref.surfaceId}:${s.ref.epoch}`).join(",")}
      </output>
      {showA && <Surface coordinator={coordinator} id="A" geo={aGeo} />}
      <Surface coordinator={coordinator} id="B" geo={B_GEO} />
    </>
  );
}

let root: Root;
let container: HTMLDivElement;
const render = (ui: ReactNode) =>
  act(() => root.render(<StrictMode>{ui}</StrictMode>));
const counter = (id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-counter="${id}"]`);
const click = (id: string) =>
  act(() =>
    counter(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );

beforeEach(() => {
  mounts.length = 0;
  actions.length = 0;
  for (const key of Object.keys(seen)) delete seen[key];
  coordinatorSeen = null;
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

describe("P1-08B1 React Multi-Surface bindings", () => {
  it("registers two Surfaces with their own registries and runtimes", () => {
    render(<App />);
    const a = seen.A!.surface!;
    const b = seen.B!.surface!;
    expect(a.registry).not.toBe(b.registry);
    expect(a.runtime).not.toBe(b.runtime);
    // StrictMode mounted, unmounted and remounted each Surface: only the
    // final incarnations are live.
    const live = coordinatorSeen!.getSnapshot().surfaces.map((s) => s.ref);
    expect(live).toEqual([a.ref, b.ref]);
    expect(container.querySelector("[data-surfaces]")!.textContent).toBe(
      `A:${a.ref.epoch},B:${b.ref.epoch}`,
    );
    // The same item id is registered in both, independently.
    expect(a.registry.registrationOf("chart")).toBeDefined();
    expect(b.registry.registrationOf("chart")).toBeDefined();
    expect(a.registry.registrationOf("chart")).not.toBe(
      b.registry.registrationOf("chart"),
    );
  });

  it("A's state never affects B; scoped actions reach only their Surface", () => {
    render(<App />);
    click("A");
    click("A");
    click("B");
    expect(counter("A")!.textContent).toBe("2");
    expect(counter("B")!.textContent).toBe("1");
    const c = coordinatorSeen!;
    let pa, pb;
    act(() => {
      pa = c.extract(seen.A!.surface!.ref, "chart", "adaptive", at);
      pb = c.extract(seen.B!.surface!.ref, "chart", "adaptive", at);
    });
    if (!pa!.ok || !pb!.ok) throw new Error("extract failed");
    expect(seen.A!.presentations).toHaveLength(1);
    expect(seen.B!.presentations).toHaveLength(1);
    act(() => {
      expect(c.invoke(pb!.ref, "act")).toBe(true);
    });
    expect(actions).toEqual(["B"]);
  });

  it("removing A keeps B's runtime, presentations, state and DOM node", () => {
    render(<App />);
    click("B");
    click("B");
    const bNode = counter("B");
    const c = coordinatorSeen!;
    const a1 = seen.A!.surface!;
    let pa, pb;
    act(() => {
      pa = c.extract(a1.ref, "chart", "adaptive", at);
      pb = c.extract(seen.B!.surface!.ref, "chart", "adaptive", at);
    });
    if (!pa!.ok || !pb!.ok) throw new Error("extract failed");
    const bMounts = mounts.filter((m) => m === "B").length;

    render(<App showA={false} />);
    expect(c.isLive(a1.ref)).toBe(false);
    expect(a1.runtime.getSnapshot().presentations).toEqual([]);
    expect(c.invoke(pa!.ref, "act")).toBe(false);
    // B: same node, same state, no remount, presentation still live.
    expect(counter("B")).toBe(bNode);
    expect(counter("B")!.textContent).toBe("2");
    expect(mounts.filter((m) => m === "B").length).toBe(bMounts);
    expect(c.isCurrent(pb!.ref)).toBe(true);
    act(() => {
      expect(c.invoke(pb!.ref, "act")).toBe(true);
    });
    expect(actions).toEqual(["B"]);

    // A again: a new incarnation (epoch) and a fresh React subtree.
    render(<App />);
    const a2 = seen.A!.surface!;
    expect(a2.ref.epoch).toBeGreaterThan(a1.ref.epoch);
    expect(counter("A")!.textContent).toBe("0");
    expect(c.invoke(pa!.ref, "act")).toBe(false);
    expect(actions).toEqual(["B"]);
  });

  it("a new geometry moves the live Surface without re-registering", () => {
    render(<App />);
    const a = seen.A!.surface!;
    const moved = geometry(-1);
    render(<App aGeo={moved} />);
    expect(seen.A!.surface!.ref).toBe(a.ref);
    expect(coordinatorSeen!.surface(a.ref)!.geometry).toBe(moved);
  });

  it("unmounting the owner removes every Surface and ends every runtime", () => {
    render(<App />);
    const c = coordinatorSeen!;
    const runtimes = [seen.A!.surface!.runtime, seen.B!.surface!.runtime];
    act(() => {
      c.extract(seen.A!.surface!.ref, "chart", "adaptive", at);
    });
    act(() => root.unmount());
    expect(c.getSnapshot().surfaces).toEqual([]);
    for (const r of runtimes) expect(r.getSnapshot().presentations).toEqual([]);
    root = createRoot(container);
  });

  it("server rendering registers nothing", () => {
    const html = renderToString(<App />);
    expect(html).toContain("data-surfaces");
    expect(html).toContain('data-counter="A"');
  });
});
