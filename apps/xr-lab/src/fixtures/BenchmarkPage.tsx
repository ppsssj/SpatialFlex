import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { perfCount } from "../performance/collector";
import { WidgetRendererContext, type RenderWidget } from "./spatialView";

/**
 * P1-07C benchmark fixture (`?fixture=benchmark&panels=N`, test-hook builds
 * only): N identical, real React components, each a registered SpatialFlex
 * item with local state, an interactive control, fixed dimensions, a
 * deterministic data feed and a declared XR Adaptive view (semantic data,
 * never cloned HTML). Used by the benchmark and its correctness tests; the
 * Dashboard and Hardening fixtures are unchanged.
 */

/** Supported panel counts (0 is the control). */
export const BENCH_PANEL_COUNTS = [0, 1, 5, 10, 20] as const;
/** CSS layout size of each component (stable: the text never reflows it). */
export const BENCH_PANEL_SIZE = { width: 160, height: 100 } as const;

export const benchItemId = (index: number) => `bench-${index + 1}`;

/**
 * Deterministic application data: one tick counter (advanced at a fixed
 * cadence by the benchmark, or one step at a time) and per-panel action
 * counts. Values are pure functions of the tick and the panel index.
 */
function createBenchData() {
  let tick = 0;
  let bumps: number[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getTick: () => tick,
    getBumps: () => bumps,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get subscriptions() {
      return listeners.size;
    },
    step() {
      tick++;
      emit();
    },
    bump(index: number) {
      bumps = [...bumps];
      bumps[index] = (bumps[index] ?? 0) + 1;
      emit();
    },
    /** Updates every `intervalMs` until `stop` (W1 dynamic data). */
    start(intervalMs: number) {
      if (timer !== null) clearInterval(timer);
      timer = setInterval(() => {
        tick++;
        emit();
      }, intervalMs);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    reset() {
      this.stop();
      tick = 0;
      bumps = [];
      emit();
    },
  };
}
export const benchData = createBenchData();

export const valueOf = (tick: number, index: number) =>
  (tick * (index + 3) + index * 17) % 1000;

/** Live component instances and mounts (correctness checks). */
export const benchComponents = { live: 0, mounts: 0 };

function BenchPanel({ index }: { index: number }) {
  perfCount("react.panel.render");
  const tick = useSyncExternalStore(benchData.subscribe, benchData.getTick);
  const bumps = useSyncExternalStore(benchData.subscribe, benchData.getBumps);
  const [clicks, setClicks] = useState(0);
  useLayoutEffect(() => {
    perfCount("react.panel.commit");
  });
  useEffect(() => {
    benchComponents.live++;
    benchComponents.mounts++;
    return () => {
      benchComponents.live--;
    };
  }, []);
  const value = valueOf(tick, index);
  return (
    <article
      className="bench-panel"
      aria-label={`Benchmark panel ${index + 1}`}
      data-bench-index={index}
      style={{
        boxSizing: "border-box",
        width: BENCH_PANEL_SIZE.width,
        height: BENCH_PANEL_SIZE.height,
        overflow: "hidden",
        padding: 6,
        border: "1px solid #8c959f",
        borderRadius: 6,
        background: "#ffffff",
        font: "12px/1.3 sans-serif",
      }}
    >
      <strong>Panel {index + 1}</strong>
      <div>
        Value: <output data-testid={`bench-value-${index}`}>{value}</output>
      </div>
      <div>
        Actions:{" "}
        <span data-testid={`bench-bumps-${index}`}>{bumps[index] ?? 0}</span>
      </div>
      <button
        type="button"
        data-testid={`bench-local-${index}`}
        onClick={() => setClicks((n) => n + 1)}
      >
        Local {clicks}
      </button>
    </article>
  );
}

function BenchItem({ index }: { index: number }) {
  const tick = useSyncExternalStore(benchData.subscribe, benchData.getTick);
  return (
    <WidgetRendererContext.Consumer>
      {(renderWidget) =>
        renderWidget(benchItemId(index), <BenchPanel index={index} />, {
          title: `Panel ${index + 1}`,
          body: {
            kind: "value",
            label: "Value",
            value: String(valueOf(tick, index)),
          },
          actions: [
            { id: "bump", label: "+1", invoke: () => benchData.bump(index) },
          ],
        })
      }
    </WidgetRendererContext.Consumer>
  );
}

export function BenchmarkPage({
  renderWidget = (_, widget) => widget,
  panels,
}: {
  renderWidget?: RenderWidget;
  panels: number;
}) {
  perfCount("react.page.render");
  return (
    <WidgetRendererContext value={renderWidget}>
      <section
        className="benchmark"
        aria-labelledby="benchmark-heading"
        data-testid="benchmark-page"
        data-panels={panels}
      >
        <h2 id="benchmark-heading">Benchmark fixture ({panels} panels)</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(4, ${BENCH_PANEL_SIZE.width}px)`,
            gap: 8,
          }}
        >
          {Array.from({ length: panels }, (_, index) => (
            <BenchItem key={index} index={index} />
          ))}
        </div>
      </section>
    </WidgetRendererContext>
  );
}
