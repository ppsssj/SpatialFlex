import { yawOf } from "@spatialflex/core";
import { useSyncExternalStore } from "react";
import type { LabIntegration, LabManipulation } from "../integrations/contract";

const MODE_LABEL = { translate: "Move", rotate: "Rotate", resize: "Resize" };
const fixed = (n: number) => (Math.round(n * 1000) / 1000).toFixed(2);

/**
 * Pose inspector for manipulable presentations: which panel is selected,
 * which handle is in use, each pose, and Reset / Restore. Subscribes on its
 * own, so pose changes re-render only this list.
 */
export function ManipulationInspector({
  manipulation,
  lab,
}: {
  manipulation: LabManipulation;
  lab: LabIntegration;
}) {
  const snapshot = useSyncExternalStore(
    manipulation.subscribe,
    manipulation.getSnapshot,
    manipulation.getSnapshot,
  );
  const labels = new Map(
    (lab.surfaceItems ?? []).map((item) => [item.id, item.label]),
  );
  const targets = manipulation.targets();
  const active = snapshot.active;
  return (
    <section
      className="manipulation-inspector"
      aria-labelledby="manipulation-heading"
      data-testid="manipulation-inspector"
      data-version={snapshot.version}
    >
      <h3 id="manipulation-heading">Spatial panels</h3>
      <p
        className="hint"
        role="status"
        data-testid="manipulation-mode"
        data-mode={active?.mode ?? "idle"}
        data-item={active?.itemId}
      >
        {active
          ? `${MODE_LABEL[active.mode]}: ${labels.get(active.itemId) ?? active.itemId} (${active.input}; Esc cancels)`
          : "Drag a panel's Move (title bar), Rotate (⟲) or Resize (corner) handle, or focus a handle and use the arrow keys (Shift: larger steps)."}
      </p>
      {targets.length === 0 ? (
        <p className="hint" data-testid="manipulation-empty">
          No panel in space yet.
        </p>
      ) : (
        <ul className="manipulation-targets">
          {targets.map((t) => {
            const label = labels.get(t.itemId) ?? t.itemId;
            const selected = snapshot.selected === t.itemId;
            const [x, y, z] = t.transform.position;
            return (
              <li
                key={t.presentationId}
                data-testid={`manipulation-${t.itemId}`}
                data-kind={t.kind}
                data-presentation-id={t.presentationId}
                data-selected={selected || undefined}
                data-pose={JSON.stringify(t.transform)}
                data-initial={JSON.stringify(t.initial)}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => manipulation.select(t.itemId)}
                >
                  {label}
                </button>{" "}
                {t.kind === "native" ? "Native DOM" : "XR Adaptive"} ·{" "}
                {t.presentationId}
                <br />({fixed(x)}, {fixed(y)}, {fixed(z)}) m · yaw{" "}
                {Math.round((yawOf(t.transform.rotation) * 180) / Math.PI)}° ·
                scale {t.transform.scale.toFixed(2)}×{" "}
                <button
                  type="button"
                  aria-label={`Reset transform of ${label}`}
                  onClick={() => manipulation.reset(t.itemId)}
                >
                  Reset transform
                </button>{" "}
                <button
                  type="button"
                  aria-label={`Restore ${label}`}
                  onClick={() => lab.restore?.(t.itemId)}
                >
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
