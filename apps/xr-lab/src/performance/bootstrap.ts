import { PerfCollector, setActiveCollector } from "./collector";
import { installInstrumentation, instrumentRenderer } from "./instrument";

/**
 * Enables P1-07C benchmark mode before the lab renders: one collector,
 * the SDK and renderer instrumentation, the frame loop, and the read-only
 * `window.__spatialPerf` handle. Loaded only for `?fixture=benchmark` in
 * test-hook builds; ordinary pages never import it.
 */
export async function enableBenchmarkMode(engine: string) {
  const collector = new PerfCollector();
  setActiveCollector(collector);
  installInstrumentation(collector);
  await instrumentRenderer(collector, engine);
  collector.run();
  (window as unknown as { __spatialPerf?: PerfCollector }).__spatialPerf =
    collector;
  return collector;
}
