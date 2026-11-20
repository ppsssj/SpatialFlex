// @vitest-environment jsdom
// P1-07C: metrics validity (B2) and measurement isolation (B3).
import { ItemManipulator, SpatialManipulator } from "@spatialflex/core";
import { NativeCompositor, PresentationRuntime } from "@spatialflex/dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  PerfCollector,
  perfCount,
  perfSpan,
  setActiveCollector,
} from "./collector";
import { installInstrumentation } from "./instrument";
import {
  frameCadence,
  percentile,
  SampleBuffer,
  summarize,
  variation,
} from "./stats";

afterEach(() => setActiveCollector(null));

describe("B2 metrics validity", () => {
  it("percentiles interpolate between closest ranks; no data is null, not zero", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5.5);
    expect(percentile(sorted, 95)).toBeCloseTo(9.55, 10);
    expect(percentile(sorted, 99)).toBeCloseTo(9.91, 10);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 100)).toBe(10);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNull();
    expect(summarize([])).toMatchObject({ count: 0, median: null, p95: null });
    expect(summarize([3, 1, 2, Number.NaN])).toMatchObject({
      count: 3,
      median: 2,
      min: 1,
      max: 3,
      mean: 2,
    });
  });

  it("run-to-run variation is the coefficient of variation", () => {
    expect(variation([10, 10, 10])).toBe(0);
    expect(variation([8, 12])).toBeCloseTo((Math.SQRT2 * 2) / 10, 10);
    expect(variation([5])).toBeNull();
  });

  it("frame cadence comes from rAF timestamps without an assumed refresh rate", () => {
    // 60 intervals of 16.7 ms and two of 50 ms.
    const ts = [0];
    for (let i = 0; i < 60; i++) ts.push(ts.at(-1)! + 16.7);
    ts.push(ts.at(-1)! + 50, ts.at(-1)! + 100);
    const c = frameCadence(ts);
    expect(c.samples).toBe(62);
    expect(c.medianIntervalMs).toBeCloseTo(16.7, 10);
    expect(c.overBudgetRatio).toBeCloseTo(2 / 62, 10);
    expect(c.observedFps).toBeCloseTo(1000 / ((60 * 16.7 + 100) / 62), 1);
    expect(frameCadence([])).toMatchObject({
      samples: 0,
      medianIntervalMs: null,
      observedFps: null,
      overBudgetRatio: null,
    });
  });

  it("sample buffers keep memory bounded and report what they dropped", () => {
    const b = new SampleBuffer(3);
    for (const v of [1, 2, 3, 4, 5]) b.push(v);
    expect(b.values()).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
    expect(b.dropped).toBe(2);
    b.clear();
    expect(b.values()).toEqual([]);
    expect(() => new SampleBuffer(0)).toThrow(RangeError);
  });

  it("a collector result has units, raw samples and explicit unsupported data", () => {
    const collector = new PerfCollector();
    collector.record("ignored", 1);
    collector.start();
    collector.record("dom.composite", 0.25);
    collector.record("dom.composite", 0.75);
    collector.count("react.panel.render");
    collector.input(performance.now() - 5);
    collector.committed();
    collector.committed(); // no pending input: not a sample
    const result = collector.stop();
    expect(result.spans["ignored"]).toBeUndefined();
    expect(result.spans["dom.composite"]).toMatchObject({
      unit: "ms",
      count: 2,
      median: 0.5,
      samples: [0.25, 0.75],
      dropped: 0,
    });
    expect(result.counters).toEqual({ "react.panel.render": 1 });
    expect(result.latency.inputToCommit.count).toBe(1);
    expect(result.latency.inputToCommit.median).toBeGreaterThanOrEqual(5);
    expect(result.latency.definition).toMatch(/timeStamp/);
    // jsdom has no Long Tasks API: reported as unsupported, not as zero.
    expect(result.longTasks).toEqual({
      supported: false,
      count: null,
      totalMs: null,
      durations: null,
    });
    expect(result.frames.samples).toBe(0);
    expect(result.instrumentationCostMs).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("B3 measurement isolation", () => {
  it("without a collector, the lab's hooks are the original functions and record nothing", () => {
    const fn = (a: number) => a * 2;
    expect(perfSpan("x", fn)).toBe(fn);
    expect(() => perfCount("x")).not.toThrow();
  });

  it("instrumentation preserves results and uninstalls to the exact originals", () => {
    const originals = [
      NativeCompositor.prototype.composite,
      NativeCompositor.prototype.setTargets,
      PresentationRuntime.prototype.extract,
      PresentationRuntime.prototype.restore,
      PresentationRuntime.prototype.connectHost,
      ItemManipulator.prototype.sync,
      SpatialManipulator.prototype.update,
    ];
    const collector = new PerfCollector();
    const uninstall = installInstrumentation(collector);
    expect(NativeCompositor.prototype.composite).not.toBe(originals[0]);
    // Same behavior while instrumented, measured or not.
    const run = () => {
      const m = new SpatialManipulator();
      m.attach("p", {
        registrationId: "r",
        initial: { position: [0, 1, -1], rotation: [0, 0, 0, 1], scale: 1 },
        extent: { width: 0.6, height: 0.4 },
      });
      const ray = (x: number) => ({
        origin: [x, 1, 0] as const,
        direction: [0, 0, -1] as const,
      });
      const token = m.begin("p", "translate", { pointerId: 1, ray: ray(0) })!;
      const moved = m.update(token, ray(0.2));
      m.commit(token);
      return { moved, pose: m.transform("p") };
    };
    const idle = run();
    collector.start();
    const measured = run();
    const result = collector.stop();
    expect(measured).toEqual(idle);
    expect(result.spans["core.manipulationUpdate"]!.count).toBe(1);
    uninstall();
    expect([
      NativeCompositor.prototype.composite,
      NativeCompositor.prototype.setTargets,
      PresentationRuntime.prototype.extract,
      PresentationRuntime.prototype.restore,
      PresentationRuntime.prototype.connectHost,
      ItemManipulator.prototype.sync,
      SpatialManipulator.prototype.update,
    ]).toEqual(originals);
    expect(run()).toEqual(idle);
  });
});
