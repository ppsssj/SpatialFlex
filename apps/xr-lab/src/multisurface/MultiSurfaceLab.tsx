/**
 * P1-08B1 Multi-Surface fixture (`multi-surface.html`). EXPERIMENTAL.
 *
 * Two independent React Surfaces, each with its own `<SpatialWorkspace>`
 * (registry and controller), registered in one `WorkspaceCoordinator` with
 * `useSpatialSurface`, which gives each Surface its own
 * `PresentationRuntime`. Both register an item with the SAME id (`chart`).
 *
 * Everything is driven by real UI: present the item as an Adaptive panel,
 * run its XR action through the coordinator's scoped reference, restore it,
 * move the Surface's pose, and remove / re-add Surface A. The last scoped
 * reference of each Surface is kept here, above the Surfaces, so it
 * survives A's removal and can be replayed against the new epoch.
 *
 * Not in scope (later P1-08B stages): a shared 3D scene, depth composition,
 * intersecting Surfaces, cross-Surface input routing.
 */
import { SpatialItem, SpatialWorkspace } from "@spatialflex/react";
import {
  useSpatialSurface,
  useWorkspaceCoordinator,
  useWorkspaceSurfaces,
  type WorkspaceCoordinator,
} from "@spatialflex/react/spatial";
import type {
  ScopedPresentationRef,
  SurfaceGeometry,
} from "@spatialflex/core/workspace";
import { useCallback, useEffect, useMemo, useState } from "react";
import { testHooksEnabled } from "../contracts/hostProbe";

type SurfaceId = "A" | "B";

const geometryAt = (x: number, yaw: number): SurfaceGeometry => ({
  resolution: { width: 400, height: 300 },
  metersPerPixel: 0.0025,
  pose: {
    position: [x, 1.4, -1.5],
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    scale: 1,
  },
});
const START: Record<SurfaceId, { x: number; yaw: number }> = {
  A: { x: -0.6, yaw: 0.2 },
  B: { x: 0.6, yaw: -0.2 },
};
const PANEL_AT = { position: [0, 1.4, -1] as const };

interface LabLog {
  readonly lines: string[];
  push(line: string): void;
}

function useLog(): LabLog {
  const [lines, setLines] = useState<string[]>([]);
  return useMemo(
    () => ({ lines, push: (line) => setLines((l) => [...l, line]) }),
    [lines],
  );
}

const refLabel = (ref: ScopedPresentationRef) =>
  `${ref.item.surface.surfaceId}@${ref.item.surface.epoch}/${ref.item.itemId}/${ref.instanceId}`;

/** One Surface: its own source scope and its own runtime. */
function Surface({
  id,
  coordinator,
  log,
  saved,
  onSaved,
}: {
  id: SurfaceId;
  coordinator: WorkspaceCoordinator;
  log: LabLog;
  saved: ScopedPresentationRef | null;
  onSaved: (ref: ScopedPresentationRef | null) => void;
}) {
  return (
    <SpatialWorkspace>
      <SurfaceBody
        id={id}
        coordinator={coordinator}
        log={log}
        saved={saved}
        onSaved={onSaved}
      />
    </SpatialWorkspace>
  );
}

function SurfaceBody({
  id,
  coordinator,
  log,
  saved,
  onSaved,
}: {
  id: SurfaceId;
  coordinator: WorkspaceCoordinator;
  log: LabLog;
  saved: ScopedPresentationRef | null;
  onSaved: (ref: ScopedPresentationRef | null) => void;
}) {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");
  const [pose, setPose] = useState(START[id]);
  const geometry = useMemo(() => geometryAt(pose.x, pose.yaw), [pose]);
  const { surface, presentations } = useSpatialSurface(coordinator, id, {
    geometry,
  });
  // Parent-owned semantic action of the item's XR view.
  const xr = useMemo(
    () => ({
      body: { kind: "value" as const, label: "count", value: String(count) },
      actions: [
        {
          id: "increment",
          label: "Increment",
          invoke: () => setCount((n) => n + 1),
        },
      ],
    }),
    [count],
  );

  const present = () => {
    if (!surface) return;
    const r = coordinator.extract(surface.ref, "chart", "adaptive", PANEL_AT);
    log.push(
      r.ok ? `present ${refLabel(r.ref)}` : `present ${id} failed: ${r.reason}`,
    );
    if (r.ok) onSaved(r.ref);
  };
  const run = () => {
    if (!saved) return;
    const ok = coordinator.invoke(saved, "increment");
    log.push(`invoke ${refLabel(saved)} → ${ok ? "accepted" : "refused"}`);
  };
  const restore = () => {
    if (!saved) return;
    const ok = coordinator.restore(saved);
    log.push(`restore ${refLabel(saved)} → ${ok ? "accepted" : "refused"}`);
  };

  return (
    <section
      className="multi-surface"
      data-surface={id}
      data-epoch={surface?.ref.epoch ?? ""}
      style={{
        border: "2px solid #888",
        padding: 12,
        width: 380,
        background: id === "A" ? "#fde8e8" : "#e8ecfd",
      }}
    >
      <h2 data-testid={`surface-${id}-title`}>
        Surface {id} · epoch {surface?.ref.epoch ?? "–"}
      </h2>
      <SpatialItem id="chart" label={`Chart ${id}`} detachable xr={xr}>
        <div style={{ display: "grid", gap: 6 }}>
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
      <p data-testid={`${id}-pose`}>
        pose x={pose.x.toFixed(2)} yaw={pose.yaw.toFixed(2)} · geometry x=
        {surface
          ? (
              coordinator.surface(surface.ref)?.geometry.pose.position[0] ?? NaN
            ).toFixed(2)
          : "–"}
      </p>
      <p data-testid={`${id}-presentations`}>
        presentations:{" "}
        {presentations.map((p) => `${p.kind}:${p.instanceId}`).join(",") ||
          "none"}
      </p>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button type="button" data-testid={`${id}-present`} onClick={present}>
          Present (Adaptive)
        </button>
        <button type="button" data-testid={`${id}-run`} onClick={run}>
          Run XR action
        </button>
        <button type="button" data-testid={`${id}-restore`} onClick={restore}>
          Restore
        </button>
        <button
          type="button"
          data-testid={`${id}-move`}
          onClick={() => setPose((p) => ({ x: p.x + 0.1, yaw: p.yaw }))}
        >
          Move
        </button>
      </div>
    </section>
  );
}

export function MultiSurfaceLab() {
  const coordinator = useWorkspaceCoordinator();
  const { surfaces } = useWorkspaceSurfaces(coordinator);
  const [showA, setShowA] = useState(true);
  const [saved, setSaved] = useState<
    Record<SurfaceId, ScopedPresentationRef | null>
  >({ A: null, B: null });
  const log = useLog();
  const save = useCallback(
    (id: SurfaceId) => (ref: ScopedPresentationRef | null) =>
      setSaved((s) => ({ ...s, [id]: ref })),
    [],
  );

  // Read-only test probe (test-hook builds only). It never acts.
  useEffect(() => {
    if (!testHooksEnabled) return;
    (window as unknown as { __multiSurfaceLab?: unknown }).__multiSurfaceLab = {
      surfaces: () =>
        coordinator.getSnapshot().surfaces.map((s) => ({
          id: s.ref.surfaceId,
          epoch: s.ref.epoch,
          registration: s.registry.registrationOf("chart") ?? null,
          presentations: s.runtime.getSnapshot().presentations.length,
          x: s.geometry.pose.position[0],
        })),
      presentations: () =>
        coordinator.presentations().map((p) => refLabel(p.ref)),
    };
  }, [coordinator]);

  return (
    <main style={{ padding: 16, font: "14px sans-serif" }}>
      <h1>SpatialFlex XR Lab · Multi-Surface (P1-08B1, experimental)</h1>
      <p data-testid="live-surfaces">
        live:{" "}
        {surfaces.map((s) => `${s.ref.surfaceId}@${s.ref.epoch}`).join(", ")}
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button
          type="button"
          data-testid="toggle-A"
          onClick={() => setShowA((v) => !v)}
        >
          {showA ? "Remove Surface A" : "Add Surface A"}
        </button>
        <button
          type="button"
          data-testid="replay-A"
          disabled={!saved.A}
          onClick={() => {
            const ref = saved.A!;
            const ok = coordinator.invoke(ref, "increment");
            log.push(
              `replay ${refLabel(ref)} → ${ok ? "accepted" : "refused"}`,
            );
          }}
        >
          Replay last A action ref
        </button>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {showA && (
          <Surface
            id="A"
            coordinator={coordinator}
            log={log}
            saved={saved.A}
            onSaved={save("A")}
          />
        )}
        <Surface
          id="B"
          coordinator={coordinator}
          log={log}
          saved={saved.B}
          onSaved={save("B")}
        />
      </div>
      <ol data-testid="log">
        {log.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </main>
  );
}
