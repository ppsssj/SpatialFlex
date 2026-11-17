import type { ReactNode } from "react";
import { useLabDiagnostics, useLabState, useLabStore } from "./context";
import type { ImageVariant } from "./labStore";

/** Ids of the dashboard's widgets: the app's own component identities. */
export const WIDGETS = {
  counter: "shared-counter",
  chart: "live-chart",
  image: "image-panel",
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
export type RenderWidget = (id: WidgetId, widget: ReactNode) => ReactNode;
const renderPlain: RenderWidget = (_, widget) => widget;

/** The original web dashboard. Works the same in every integration mode. */
export function Dashboard({
  renderWidget = renderPlain,
}: {
  renderWidget?: RenderWidget;
}) {
  const imageMounted = useLabState((state) => state.imageMounted);
  const { actions } = useLabStore();

  return (
    <section className="dashboard" aria-labelledby="dashboard-heading">
      <h2 id="dashboard-heading">Original web dashboard</h2>
      <div className="widgets">
        {renderWidget(WIDGETS.counter, <CounterWidget />)}
        {renderWidget(WIDGETS.chart, <ChartWidget />)}
        {imageMounted && renderWidget(WIDGETS.image, <ImageWidget />)}
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
    </section>
  );
}

function CounterWidget() {
  const count = useLabState((state) => state.sharedCount);
  const { actions } = useLabStore();
  return (
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
    </article>
  );
}

function ChartWidget() {
  const history = useLabState((state) => state.history);
  const max = Math.max(1, ...history);
  return (
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
    </article>
  );
}

function ImageWidget() {
  const variant = useLabState((state) => state.imageVariant);
  const { actions } = useLabStore();
  return (
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
    </article>
  );
}

function DomainDiagnostics() {
  const actionCount = useLabState((state) => state.actionCount);
  const { actionCalls, activeSubscriptions } = useLabDiagnostics();
  return (
    <dl className="diagnostics" aria-label="Domain diagnostics">
      <dt>Domain actions processed</dt>
      <dd data-testid="action-count">{actionCount}</dd>
      <dt>increment() calls</dt>
      <dd data-testid="increment-calls">{actionCalls.increment}</dd>
      <dt>Active state subscriptions</dt>
      <dd data-testid="active-subscriptions">{activeSubscriptions}</dd>
    </dl>
  );
}
