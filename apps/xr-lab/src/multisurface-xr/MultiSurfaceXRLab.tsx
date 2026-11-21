/**
 * P1-08B3 Multi-Surface XR fixture (`multi-surface-xr.html`). EXPERIMENTAL.
 *
 * Two (or, for measurements, up to five) independent React Surfaces, each
 * its own `<SpatialWorkspace>` (registry, controller) registered with
 * `useSpatialSurface` in ONE `WorkspaceCoordinator`, placed in ONE Three.js
 * scene (the XR Lab's `ThreeHost`: one camera, one render loop).
 *
 * Rendering paths, kept apart on purpose:
 * - Each Surface page is LIVE DOM, composited over the WebGL canvas with a
 *   CSS `matrix3d` (`surfaceTransform`) and clipped to its visible region.
 *   It is not a WebGL texture.
 * - Adaptive panels are drawn by Three.js (WebGL) in the same scene.
 * - In an immersive WebXR session only the WebGL content can be shown; the
 *   DOM pages are suspended (hidden, no input).
 *
 * Every camera frame goes through `WorkspaceScene` (FrameAuthority → one
 * depth snapshot → page clips + input routing → each Surface's own runtime
 * host). Real input only; `window.__multiSurfaceXR` is a read-only probe.
 */
import { SpatialItem, SpatialWorkspace } from "@spatialflex/react";
import {
  useSpatialSurface,
  useWorkspaceCoordinator,
  useWorkspaceSurfaces,
  type WorkspaceCoordinator,
} from "@spatialflex/react/spatial";
import { WorkspaceScene, type WorkspaceRenderer } from "@spatialflex/dom";
import {
  cssToWorld,
  type ScopedPresentationRef,
} from "@spatialflex/core/workspace";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getProbe, testHooksEnabled } from "../contracts/hostProbe";
import type { HostCameraFrame, HostPanel } from "../contracts/xrHost";
import { ThreeHost } from "../hosts/three/ThreeHost";
import {
  EXTRA,
  LAYOUTS,
  geometryOf,
  panelPlacement,
  type LayoutId,
  type Placement,
  type SurfaceId,
} from "./layouts";

const params = new URLSearchParams(window.location.search);
const SURFACE_COUNT = Math.min(
  5,
  Math.max(2, Number(params.get("surfaces") ?? 2) || 2),
);
const IDS = (["A", "B", "C", "D", "E"] as const).slice(0, SURFACE_COUNT);

interface LabLog {
  readonly lines: readonly string[];
  push(line: string): void;
}

function useLog(): LabLog {
  const [lines, setLines] = useState<readonly string[]>([]);
  return useMemo(
    () => ({ lines, push: (line) => setLines((l) => [...l.slice(-30), line]) }),
    [lines],
  );
}

const refLabel = (ref: ScopedPresentationRef) =>
  `${ref.item.surface.surfaceId}@${ref.item.surface.epoch}/${ref.item.itemId}/${ref.instanceId}`;

const placementsOf = (layout: LayoutId): Record<SurfaceId, Placement> => ({
  ...LAYOUTS[layout],
  ...EXTRA,
});

/** One Surface: its own source scope and its own runtime, in the scene. */
function SurfacePage(props: SurfaceProps) {
  return (
    <SpatialWorkspace>
      <SurfaceBody {...props} />
    </SpatialWorkspace>
  );
}

interface SurfaceProps {
  id: SurfaceId;
  coordinator: WorkspaceCoordinator;
  scene: WorkspaceScene;
  placement: Placement;
  interactive: boolean;
  log: LabLog;
}

function SurfaceBody({
  id,
  coordinator,
  scene,
  placement,
  interactive,
  log,
}: SurfaceProps) {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");
  const [hits, setHits] = useState(0);
  const [pad, setPad] = useState<readonly string[]>([]);
  const geometry = useMemo(() => geometryOf(placement), [placement]);
  const { surface, presentations } = useSpatialSurface(coordinator, id, {
    geometry,
  });
  const pageRef = useRef<HTMLElement>(null);
  const ref = surface?.ref ?? null;
  useLayoutEffect(
    () =>
      ref && pageRef.current
        ? scene.attachPage(ref, pageRef.current)
        : undefined,
    [scene, ref],
  );
  useLayoutEffect(() => {
    if (ref) scene.setInteractive(ref, interactive);
  }, [scene, ref, interactive]);
  const xr = useMemo(
    () => ({
      title: `Chart ${id}`,
      body: {
        kind: "value" as const,
        label: `${id} count`,
        value: String(count),
      },
      actions: [
        {
          id: "increment",
          label: "+1",
          invoke: () => setCount((n) => n + 1),
        },
      ],
    }),
    [id, count],
  );
  const present = () => {
    if (!ref) return;
    const r = coordinator.extract(
      ref,
      "chart",
      "adaptive",
      panelPlacement(placement),
    );
    log.push(
      r.ok ? `present ${refLabel(r.ref)}` : `present ${id} failed: ${r.reason}`,
    );
  };
  const restore = () => {
    if (!ref) return;
    const p = coordinator.presentationRef(
      ref,
      presentations[0]?.instanceId ?? "",
    );
    log.push(
      p && coordinator.restore(p)
        ? `restore ${refLabel(p)}`
        : `restore ${id}: nothing`,
    );
  };
  const padEvent = (e: React.PointerEvent) =>
    setPad((l) => [...l.slice(-12), e.type.replace("pointer", "")]);

  return (
    <section
      ref={pageRef}
      className="msx-page"
      data-surface={id}
      data-epoch={ref?.epoch ?? ""}
      data-interactive={interactive}
      onPointerDown={() => setHits((n) => n + 1)}
    >
      <header>
        <strong data-testid={`${id}-title`}>
          Surface {id} · epoch {ref?.epoch ?? "–"}
        </strong>
        <span data-testid={`${id}-hits`}>hits {hits}</span>
      </header>
      <SpatialItem id="chart" label={`Chart ${id}`} detachable xr={xr}>
        <div className="msx-row">
          <button
            type="button"
            data-testid={`${id}-counter`}
            onClick={() => setCount((n) => n + 1)}
          >
            {id} count {count}
          </button>
          <input
            data-testid={`${id}-input`}
            aria-label={`Surface ${id} note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </SpatialItem>
      <div className="msx-row">
        <button type="button" data-testid={`${id}-present`} onClick={present}>
          Present
        </button>
        <button type="button" data-testid={`${id}-restore`} onClick={restore}>
          Restore
        </button>
        <span data-testid={`${id}-presentations`}>
          {presentations.map((p) => `${p.kind}:${p.instanceId}`).join(",") ||
            "none"}
        </span>
      </div>
      <div
        className="msx-pad"
        data-testid={`${id}-pad`}
        onPointerDown={padEvent}
        onPointerMove={(e) => e.buttons && padEvent(e)}
        onPointerUp={padEvent}
      >
        pad:{" "}
        <span data-testid={`${id}-pad-log`}>{[...new Set(pad)].join(",")}</span>
      </div>
    </section>
  );
}

/** Adaptive panels of every Surface, with their scoped references. */
function usePanels(coordinator: WorkspaceCoordinator) {
  const { surfaces } = useWorkspaceSurfaces(coordinator);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const stops = surfaces.flatMap((s) => [
      s.runtime.subscribe(bump),
      s.registry.subscribeViews(bump),
    ]);
    bump();
    return () => stops.forEach((stop) => stop());
  }, [surfaces]);
  return useMemo(() => {
    void version;
    const refs = new Map<string, ScopedPresentationRef>();
    const panels: HostPanel[] = [];
    for (const s of surfaces)
      for (const { presentation, view } of s.runtime.adaptivePanels()) {
        const ref = coordinator.presentationRef(s.ref, presentation.instanceId);
        const pose = s.runtime.manipulation.poseOf(presentation.itemId);
        if (!ref || !pose) continue;
        const id = refLabel(ref);
        refs.set(id, ref);
        panels.push({
          id,
          title: view.title,
          position: pose.position,
          rotation: pose.rotation,
          scale: pose.scale,
          body: view.body,
          buttons: view.actions.map((a) => ({ id: a.id, label: a.label })),
          selected: false,
        });
      }
    return { panels, refs };
  }, [coordinator, surfaces, version]);
}

export function MultiSurfaceXRLab() {
  const coordinator = useWorkspaceCoordinator();
  // Not disposed on unmount, like the coordinator (StrictMode remounts);
  // every Surface removes itself and the renderer disconnects itself.
  const [scene] = useState(() => new WorkspaceScene(coordinator));
  const status = useSyncExternalStore(scene.subscribe, scene.getSnapshot);
  const { surfaces } = useWorkspaceSurfaces(coordinator);
  const [layout, setLayout] = useState<LayoutId>("side");
  const [placements, setPlacements] = useState(() => placementsOf("side"));
  const [showA, setShowA] = useState(true);
  const [interactive, setInteractive] = useState<Record<SurfaceId, boolean>>({
    A: true,
    B: true,
    C: true,
    D: true,
    E: true,
  });
  const [rendererKey, setRendererKey] = useState(0);
  const log = useLog();
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const { panels, refs } = usePanels(coordinator);

  // One renderer connection per ThreeHost mount (a restart is a new lease).
  // A ref, not state: the frame callback reads it, nothing renders it.
  const renderer = useRef<WorkspaceRenderer | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const r = scene.connectRenderer("three");
    renderer.current = r;
    return () => {
      r.disconnect();
      if (renderer.current === r) renderer.current = null;
    };
  }, [scene, rendererKey]);
  const onCameraFrame = useCallback((frame: HostCameraFrame) => {
    renderer.current?.frame(++sequence.current, frame);
  }, []);
  const onSessionChange = useCallback(
    (mode: string | null) => renderer.current?.setImmersive(mode !== null),
    [],
  );

  useLayoutEffect(() => scene.attachLayer(layerRef.current!), [scene]);
  useEffect(
    () => scene.bindInput(rootRef.current!, (el) => el.tagName === "CANVAS"),
    [scene],
  );

  const chooseLayout = (next: LayoutId) => {
    setLayout(next);
    setPlacements(placementsOf(next));
  };
  const moveA = (dx: number, dyaw: number) =>
    setPlacements((p) => ({
      ...p,
      A: {
        position: [p.A.position[0] + dx, p.A.position[1], p.A.position[2]],
        yaw: p.A.yaw + dyaw,
      },
    }));

  // Shortcuts usable while a pointer button is held (lifecycle tests):
  // Alt+Shift+1 removes / re-adds A, Alt+Shift+2 restarts the renderer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey) return;
      if (e.code === "Digit1") setShowA((v) => !v);
      else if (e.code === "Digit2") setRendererKey((k) => k + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  const onPanelButton = (panelId: string, buttonId: string) => {
    const ref = refs.get(panelId);
    if (!ref) return;
    const routed = scene.adaptiveAction(ref);
    const ok = routed && coordinator.invoke(ref, buttonId);
    log.push(`action ${panelId} ${buttonId} → ${ok ? "accepted" : "refused"}`);
  };

  // Read-only test probe (test-hook builds only). It never acts.
  useEffect(() => {
    if (!testHooksEnabled) return;
    (window as unknown as { __multiSurfaceXR?: unknown }).__multiSurfaceXR = {
      status: () => scene.getSnapshot(),
      inspect: () => scene.inspect(),
      surfaces: () =>
        coordinator.getSnapshot().surfaces.map((s) => ({
          id: s.ref.surfaceId,
          epoch: s.ref.epoch,
          position: [...s.geometry.pose.position],
          rotation: [...s.geometry.pose.rotation],
          presentations: s.runtime.getSnapshot().presentations.length,
        })),
      /** Client point of a page CSS point, projected by the Three.js camera. */
      point: (id: string, u: number, v: number) => {
        const s = coordinator
          .getSnapshot()
          .surfaces.find((x) => x.ref.surfaceId === id);
        return s ? getProbe().project(cssToWorld(s.geometry, u, v)) : null;
      },
      metrics: () => ({
        resolve: [...scene.timings.resolve.values],
        compose: [...scene.timings.compose.values],
        frame: [...scene.timings.frame.values],
        pointer: [...scene.timings.pointer.values],
        counters: { ...scene.counters },
      }),
    };
  }, [coordinator, scene]);

  const ids = IDS.filter((id) => id !== "A" || showA);
  return (
    <div ref={rootRef} className="msx-root">
      <aside className="msx-controls" aria-label="Workspace controls">
        <h1>Multi-Surface XR (P1-08B3, experimental)</h1>
        <p data-testid="scene-status" data-value={status.status}>
          depth: {status.status}
          {status.error
            ? ` — ${status.error.phase}: ${status.error.message}`
            : ""}
        </p>
        <p data-testid="live-surfaces">
          live:{" "}
          {surfaces.map((s) => `${s.ref.surfaceId}@${s.ref.epoch}`).join(", ")}
        </p>
        <p data-testid="authority">
          renderer:{" "}
          {status.authority
            ? `${status.authority.hostId}#${status.authority.epoch}`
            : "none"}
        </p>
        <fieldset>
          <legend>Layout</legend>
          {(["side", "cross", "ambiguous"] as const).map((l) => (
            <label key={l}>
              <input
                type="radio"
                name="layout"
                data-testid={`layout-${l}`}
                checked={layout === l}
                onChange={() => chooseLayout(l)}
              />{" "}
              {l}
            </label>
          ))}
        </fieldset>
        <div className="msx-row">
          <button
            type="button"
            data-testid="A-move"
            onClick={() => moveA(0.1, 0)}
          >
            Move A +x
          </button>
          <button
            type="button"
            data-testid="A-rotate"
            onClick={() => moveA(0, 0.15)}
          >
            Rotate A
          </button>
        </div>
        <div className="msx-row">
          <button
            type="button"
            data-testid="toggle-A"
            onClick={() => setShowA((v) => !v)}
          >
            {showA ? "Remove Surface A" : "Add Surface A"}
          </button>
          <button
            type="button"
            data-testid="restart-renderer"
            onClick={() => setRendererKey((k) => k + 1)}
          >
            Restart renderer
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            data-testid="B-interactive"
            checked={interactive.B}
            onChange={(e) => {
              const on = e.target.checked;
              setInteractive((s) => ({ ...s, B: on }));
            }}
          />{" "}
          Surface B interactive
        </label>
        <ol data-testid="log" className="msx-log">
          {log.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </aside>
      <div className="msx-stage">
        <ThreeHost
          key={rendererKey}
          panels={panels}
          onCameraFrame={onCameraFrame}
          onSessionChange={onSessionChange}
          onPanelButton={onPanelButton}
          onPanelSelect={() => {}}
          onPanelClose={(panelId) => {
            const ref = refs.get(panelId);
            const ok =
              !!ref && scene.adaptiveAction(ref) && coordinator.restore(ref);
            log.push(`close ${panelId} → ${ok ? "accepted" : "refused"}`);
          }}
        />
      </div>
      <div ref={layerRef} className="msx-layer" data-status={status.status}>
        {ids.map((id) => (
          <SurfacePage
            key={id}
            id={id}
            coordinator={coordinator}
            scene={scene}
            placement={placements[id]}
            interactive={interactive[id]}
            log={log}
          />
        ))}
      </div>
    </div>
  );
}
