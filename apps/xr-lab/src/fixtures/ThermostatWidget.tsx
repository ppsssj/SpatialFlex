import { useLabDiagnostics, useLabState, useLabStore } from "./context";
import { useWidgetRenderer } from "./spatialView";

/** A fourth component. Its state, view and permitted action are declared together. */
export function ThermostatWidget() {
  const renderWidget = useWidgetRenderer();
  const temperature = useLabState((s) => s.temperature);
  const step = useLabState((s) => s.heatStep);
  const { actions } = useLabStore();
  const { actionCalls } = useLabDiagnostics();
  const heat = () => actions.heat(step);
  return renderWidget(
    "thermostat",
    <article className="widget" aria-label="Thermostat">
      <h3>Thermostat</h3>
      <output data-testid="temperature">{temperature}</output>
      <button type="button" data-testid="web-heat" onClick={heat}>
        Heat
      </button>
      <label>
        Heat step{" "}
        <select
          data-testid="heat-step"
          value={step}
          onChange={(e) => actions.setHeatStep(Number(e.target.value))}
        >
          <option value="1">1</option>
          <option value="5">5</option>
        </select>
      </label>
      <output data-testid="heat-calls">{actionCalls.heat}</output>
    </article>,
    {
      title: "Thermostat",
      body: { kind: "value", label: "Temperature", value: String(temperature) },
      actions: [{ id: "heat", label: "Heat", invoke: heat }],
    },
  );
}
