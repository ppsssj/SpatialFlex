import {
  WidgetRendererContext,
  useWidgetRenderer,
  type RenderWidget,
} from "./spatialView";
export type { RenderWidget } from "./spatialView";
import { useLabDiagnostics, useLabState, useLabStore } from "./context";
import type { ImageVariant } from "./labStore";
import { ThermostatWidget } from "./ThermostatWidget";
import { useEffect, useState } from "react";

function useWidgetMount(id: string) {
  const store = useLabStore();
  useEffect(() => store.componentMounted(id), [store, id]);
}

/** Ids of the dashboard's widgets: the app's own component identities. */
export const WIDGETS = {
  counter: "shared-counter",
  chart: "live-chart",
  image: "image-panel",
  thermostat: "thermostat",
} as const;
export type WidgetId = (typeof WIDGETS)[keyof typeof WIDGETS];

export const IMAGE_COLORS: Record<ImageVariant, string> = {
  sunrise: "#c2410c",
  night: "#1e3a8a",
  mono: "#57606a",
};

/**
 * Wraps a widget. The default renders it as is; an integration can supply
 * its own (for example to register the widget with an SDK).
 */
const renderPlain: RenderWidget = (_, widget) => widget;

/** The original web dashboard. Works the same in every integration mode. */
export function Dashboard({
  renderWidget = renderPlain,
}: {
  renderWidget?: RenderWidget;
}) {
  const imageMounted = useLabState((state) => state.imageMounted);
  const thermostatMounted = useLabState((state) => state.thermostatMounted);
  const { actions } = useLabStore();

  return (
    <WidgetRendererContext value={renderWidget}>
      <section className="dashboard" aria-labelledby="dashboard-heading">
        <h2 id="dashboard-heading">Original web dashboard</h2>
        <div className="widgets">
          <CounterWidget />
          <ChartWidget />
          {imageMounted && <ImageWidget />}
          {thermostatMounted && <ThermostatWidget />}
        </div>
        <label>
          <input
            type="checkbox"
            data-testid="image-mounted"
            checked={imageMounted}
            onChange={(event) => actions.setImageMounted(event.target.checked)}
          />{" "}
          Mount image widget
        </label>
        <DomainDiagnostics />
        <label>
          <input
            type="checkbox"
            data-testid="thermostat-mounted"
            checked={thermostatMounted}
            onChange={(e) => actions.setThermostatMounted(e.target.checked)}
          />{" "}
          Mount thermostat widget (P1-04)
        </label>
      </section>
    </WidgetRendererContext>
  );
}

function CounterWidget() {
  useWidgetMount(WIDGETS.counter);
  const [localCount, setLocalCount] = useState(0);
  const renderWidget = useWidgetRenderer();
  const count = useLabState((state) => state.sharedCount);
  const { actions } = useLabStore();
  return renderWidget(
    WIDGETS.counter,
    <article className="widget" aria-label="Shared counter">
      <h3>Shared counter</h3>
      <output data-testid="web-count">{count}</output>{" "}
      <button
        type="button"
        data-testid="web-increment"
        onClick={actions.increment}
      >
        +1
      </button>
      <div>
        <button
          type="button"
          data-testid="counter-local"
          onClick={() => setLocalCount((n) => n + 1)}
        >
          Local clicks: {localCount}
        </button>
      </div>
      <label>
        Local note{" "}
        <input
          data-testid="counter-note"
          defaultValue="keeps focus and state"
        />
      </label>
    </article>,
    {
      title: "Shared counter",
      body: { kind: "value", label: "Shared count", value: String(count) },
      actions: [{ id: "increment", label: "+1", invoke: actions.increment }],
    },
  );
}

function ChartWidget() {
  useWidgetMount(WIDGETS.chart);
  const renderWidget = useWidgetRenderer();
  const history = useLabState((state) => state.history);
  const max = Math.max(1, ...history);
  return renderWidget(
    WIDGETS.chart,
    <article className="widget" aria-label="Live chart">
      <h3>Live chart</h3>
      <svg
        data-testid="web-chart"
        data-values={history.join(",")}
        viewBox="0 0 160 60"
        width="160"
        height="60"
        role="img"
        aria-label={`Recent counts: ${history.join(", ")}`}
      >
        {history.map((value, i) => {
          const h = (56 * value) / max;
          return (
            <rect
              key={i}
              x={i * 20 + 2}
              y={58 - h}
              width={16}
              height={h}
              fill="#2f6fdf"
            />
          );
        })}
      </svg>
    </article>,
    {
      title: "Live chart",
      body: { kind: "bars", label: "Recent counts", values: history },
    },
  );
}

function ImageWidget() {
  useWidgetMount(WIDGETS.image);
  const renderWidget = useWidgetRenderer();
  const variant = useLabState((state) => state.imageVariant);
  const { actions } = useLabStore();
  return renderWidget(
    WIDGETS.image,
    <article className="widget" aria-label="Image">
      <h3>Image</h3>
      <svg width="160" height="60" role="img" aria-label={`Image (${variant})`}>
        <rect width="160" height="60" fill={IMAGE_COLORS[variant]} />
      </svg>
      <select
        data-testid="image-variant"
        value={variant}
        onChange={(event) =>
          actions.setImageVariant(event.target.value as ImageVariant)
        }
      >
        {Object.keys(IMAGE_COLORS).map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
    </article>,
    {
      title: "Image",
      body: { kind: "swatch", color: IMAGE_COLORS[variant], caption: variant },
      actions: [
        {
          id: "next-variant",
          label: "Next",
          invoke: () => {
            const variants = Object.keys(IMAGE_COLORS) as ImageVariant[];
            actions.setImageVariant(
              variants[(variants.indexOf(variant) + 1) % variants.length]!,
            );
          },
        },
      ],
    },
  );
}

function DomainDiagnostics() {
  const actionCount = useLabState((state) => state.actionCount);
  const {
    actionCalls,
    activeSubscriptions,
    componentMounts,
    activeComponents,
  } = useLabDiagnostics();
  return (
    <dl className="diagnostics" aria-label="Domain diagnostics">
      <dt>Domain actions processed</dt>
      <dd data-testid="action-count">{actionCount}</dd>
      <dt>increment() calls</dt>
      <dd data-testid="increment-calls">{actionCalls.increment}</dd>
      <dt>Active state subscriptions</dt>
      <dd data-testid="active-subscriptions">{activeSubscriptions}</dd>
      <dt>Counter React effect mounts</dt>
      <dd data-testid="counter-mounts">
        {componentMounts[WIDGETS.counter] ?? 0}
      </dd>
      <dt>Active counter instances</dt>
      <dd data-testid="counter-instances">
        {activeComponents[WIDGETS.counter] ?? 0}
      </dd>
    </dl>
  );
}
