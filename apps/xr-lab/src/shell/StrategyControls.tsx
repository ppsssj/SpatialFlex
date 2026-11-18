import { useState } from "react";
import type { LabIntegration, LabStrategy } from "../integrations/contract";

/** One control surface for the same registered DOM item and its declared XR view. */
export function StrategyControls({ lab }: { lab: LabIntegration }) {
  const [selected, setSelected] = useState("shared-counter");
  const [strategy, setStrategy] = useState<LabStrategy>({
    mode: "move",
    source: "placeholder",
    target: "web",
  });
  const [result, setResult] = useState("");
  const validation = lab.validateStrategy!(strategy);
  const item = lab.items.find((item) => item.id === selected);
  const run = () => {
    if (!validation.supported || !item) return;
    if (strategy.mode === "move") lab.detach?.(selected, strategy);
    else lab.show(selected, strategy);
    setResult(
      strategy.mode === "move"
        ? `Original React component floats; source space ${strategy.source === "collapse" ? "collapses and siblings reflow" : "is reserved"}. Drag its title bar or resize its lower-right corner.`
        : "Live XR mirror shown. Original React component remains in the dashboard; click its 3D action button.",
    );
  };
  return (
    <section className="strategy-controls" aria-labelledby="strategy-heading">
      <h2 id="strategy-heading">Interactive detachment</h2>
      <label>
        Selected component{" "}
        <select
          data-testid="strategy-item"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {lab.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Strategy{" "}
        <select
          data-testid="strategy-mode"
          value={strategy.mode}
          onChange={(e) => {
            const mode = e.target.value as LabStrategy["mode"];
            setStrategy(
              mode === "move"
                ? { mode, source: "placeholder", target: "web" }
                : { mode, source: "visible", target: "xr" },
            );
          }}
        >
          <option value="move">Move original React component</option>
          <option value="mirror">Live XR mirror</option>
          <option value="snapshot">Snapshot (unsupported)</option>
        </select>
      </label>
      <label>
        Original space{" "}
        <select
          data-testid="strategy-source"
          value={strategy.source}
          onChange={(e) =>
            setStrategy({
              ...strategy,
              source: e.target.value as LabStrategy["source"],
            })
          }
        >
          <option value="placeholder">Placeholder — reserve space</option>
          <option value="collapse">Collapse — reflow page</option>
          <option value="visible">Visible — keep original</option>
        </select>
      </label>
      <label>
        Destination{" "}
        <select
          data-testid="strategy-target"
          value={strategy.target}
          onChange={(e) =>
            setStrategy({
              ...strategy,
              target: e.target.value as LabStrategy["target"],
            })
          }
        >
          <option value="web">Web — same document</option>
          <option value="xr">XR — independent 3D representation</option>
        </select>
      </label>
      <p data-testid="strategy-support" role="status">
        {validation.supported ? "Supported" : validation.reason}
      </p>
      <button
        type="button"
        data-testid="strategy-apply"
        disabled={!validation.supported || !item}
        onMouseDown={(e) => e.preventDefault()}
        onClick={run}
      >
        {strategy.mode === "move" ? "Detach" : "Show"}
      </button>{" "}
      <button
        type="button"
        data-testid="strategy-restore"
        disabled={!item?.shown && !item?.detached}
        onClick={() => {
          if (item?.detached) lab.attach?.(selected);
          lab.hide(selected);
          setResult("Presentation restored; original component is attached.");
        }}
      >
        Attach / Hide
      </button>
      <p data-testid="strategy-presentation" role="status">
        {!item
          ? "Component unavailable"
          : item.detached
            ? "Original mounted DOM: floating in this document"
            : item.shown
              ? `Live XR mirror (${item.presentationId}) — original stays visible`
              : "Original mounted DOM: attached"}
      </p>
      <p className="hint" data-testid="strategy-result">
        {result}
      </p>
    </section>
  );
}
