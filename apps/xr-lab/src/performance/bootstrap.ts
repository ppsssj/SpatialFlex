import { PerfCollector, setActiveCollector } from "./collector";
import { installInstrumentation, instrumentRenderer } from "./instrument";

/**
 * Enables P1-07C benchmark mode before the lab renders: one collector,
 * the SDK and renderer instrumentation, the frame loop, and the read-only
 * `window.__spatialPerf` handle. Loaded only for `?fixture=benchmark` in
 * test-hook builds; ordinary pages never import it.
 */
export async function enableBenchmarkMode(engine: string) {
  applyAblations(new URLSearchParams(window.location.search).get("ablate"));
  const collector = new PerfCollector();
  setActiveCollector(collector);
  installInstrumentation(collector);
  await instrumentRenderer(collector, engine);
  collector.run();
  (window as unknown as { __spatialPerf?: PerfCollector }).__spatialPerf =
    collector;
  return collector;
}

/**
 * Diagnostic ablations (`&ablate=page-clip`), benchmark mode only: they
 * deliberately change what is drawn, to attribute browser-side cost to one
 * CSS feature. Results with an ablation are labeled as such and are never
 * product measurements.
 * - `page-clip`: the page surface's clip-path is overridden with `none`
 *   (a stylesheet `!important` rule beats the inline value).
 */
export const ABLATIONS = {
  "page-clip": '[data-testid="web-surface"]{clip-path:none!important}',
};

function applyAblations(value: string | null) {
  const rules = (value ?? "")
    .split(",")
    .filter((name): name is keyof typeof ABLATIONS => name in ABLATIONS)
    .map((name) => ABLATIONS[name]);
  if (rules.length === 0) return;
  const style = document.createElement("style");
  style.dataset.benchAblation = value!;
  style.textContent = rules.join(" ");
  document.head.append(style);
}
