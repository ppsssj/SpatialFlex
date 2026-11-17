import type { Vec3 } from "../contracts/xrHost";
import type { LabIntegration } from "../integrations/contract";

const STEP = 0.1; // meters

const MOVES: { label: string; delta: Vec3 }[] = [
  { label: "Left", delta: [-STEP, 0, 0] },
  { label: "Right", delta: [STEP, 0, 0] },
  { label: "Up", delta: [0, STEP, 0] },
  { label: "Down", delta: [0, -STEP, 0] },
];

/** Show in XR / Remove from XR and panel movement, the same in every mode. */
export function XRControls({ lab }: { lab: LabIntegration }) {
  return (
    <section className="xr-controls" aria-labelledby="xr-controls-heading">
      <h2 id="xr-controls-heading">XR items</h2>
      <p className="hint" data-testid="xr-source">
        Source: {lab.source}
      </p>
      <ul>
        {lab.items.map((item) => (
          <li
            key={item.id}
            data-testid={`xr-item-${item.id}`}
            data-shown={item.shown}
          >
            <code>{item.id}</code>{" "}
            {item.shown ? (
              <>
                <button type="button" onClick={() => lab.hide(item.id)}>
                  Remove from XR
                </button>
                {MOVES.map(({ label, delta }) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={`Move ${item.label} ${label.toLowerCase()}`}
                    onClick={() => lab.move(item.id, delta)}
                  >
                    {label}
                  </button>
                ))}
                {item.selected && <span className="badge">selected</span>}
              </>
            ) : (
              <button type="button" onClick={() => lab.show(item.id)}>
                Show in XR
              </button>
            )}
          </li>
        ))}
      </ul>
      {lab.items.length === 0 && <p className="hint">No items available.</p>}
    </section>
  );
}
