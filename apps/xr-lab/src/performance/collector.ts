import { frameCadence, SampleBuffer, summarize, type Summary } from "./stats";

/**
 * P1-07C in-page metrics collector. Exists only in benchmark mode (see
 * `benchmarkEnabled`); everything else in the lab calls the no-op
 * functions below, which return immediately while no collector is active.
 *
 * - Bounded memory: every series is a fixed-capacity `SampleBuffer`.
 * - Never touches React state: counters and spans are plain fields.
 * - Times are synchronous JavaScript CPU time (`performance.now()` around a
 *   call). They do not include style recalculation, layout, paint or GPU
 *   work, which the browser performs later.
 */

const CAPACITY = 20_000;

export interface SpanResult extends Summary {
  readonly unit: "ms";
  /** Raw samples (insertion order, bounded). */
  readonly samples: readonly number[];
  readonly dropped: number;
}

export interface CollectorResult {
  readonly durationMs: number;
  readonly frames: ReturnType<typeof frameCadence> & {
    readonly timestamps: readonly number[];
  };
  readonly spans: Readonly<Record<string, SpanResult>>;
  readonly counters: Readonly<Record<string, number>>;
  readonly longTasks: {
    readonly supported: boolean;
    readonly count: number | null;
    readonly totalMs: number | null;
    readonly durations: readonly number[] | null;
  };
  readonly latency: {
    /** Input event timestamp → manipulation state committed (ms). */
    readonly inputToCommit: SpanResult;
    /** Input event timestamp → first animation frame callback after it. */
    readonly inputToNextFrame: SpanResult;
    readonly definition: string;
  };
  /** Median cost of one empty instrumented span (timer pair), ms. */
  readonly instrumentationCostMs: number | null;
}

type FrameHook = (timestamp: number, index: number) => void;

export class PerfCollector {
  readonly #frames = new SampleBuffer(CAPACITY);
  readonly #spans = new Map<string, SampleBuffer>();
  readonly #counters = new Map<string, number>();
  readonly #longTasks = new SampleBuffer(CAPACITY);
  readonly #commit = new SampleBuffer(CAPACITY);
  readonly #nextFrame = new SampleBuffer(CAPACITY);
  readonly #frameHooks = new Set<FrameHook>();
  #measuring = false;
  #started = 0;
  #raf = 0;
  #frameIndex = 0;
  #observer: PerformanceObserver | null = null;
  #pendingInput: number | null = null;
  #awaitingFrame: number[] = [];
  readonly longTasksSupported =
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes("longtask");

  get measuring() {
    return this.#measuring;
  }

  /** Starts a measured window: clears every series. */
  start() {
    this.#reset();
    this.#measuring = true;
    this.#started = performance.now();
    if (this.longTasksSupported) {
      this.#observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (this.#measuring) this.#longTasks.push(entry.duration);
      });
      this.#observer.observe({ type: "longtask" });
    }
  }

  stop(): CollectorResult {
    this.#measuring = false;
    const durationMs = performance.now() - this.#started;
    this.#observer?.disconnect();
    this.#observer = null;
    const spans: Record<string, SpanResult> = {};
    for (const [name, buffer] of this.#spans) spans[name] = span(buffer);
    const timestamps = this.#frames.values();
    const longTasks = this.#longTasks.values();
    return {
      durationMs,
      frames: { ...frameCadence(timestamps), timestamps },
      spans,
      counters: Object.fromEntries(this.#counters),
      longTasks: this.longTasksSupported
        ? {
            supported: true,
            count: longTasks.length,
            totalMs: longTasks.reduce((s, v) => s + v, 0),
            durations: longTasks,
          }
        : { supported: false, count: null, totalMs: null, durations: null },
      latency: {
        inputToCommit: span(this.#commit),
        inputToNextFrame: span(this.#nextFrame),
        definition:
          "inputToCommit: performance.now() when the manipulation store notifies, minus the triggering pointer/key event's timeStamp. inputToNextFrame: performance.now() in the first requestAnimationFrame callback after that commit, minus the same event timeStamp (the frame in which renderers and the compositor draw the new pose).",
      },
      instrumentationCostMs: calibrate(),
    };
  }

  /** The rAF loop runs while the page is in benchmark mode. */
  run() {
    const loop = (timestamp: number) => {
      this.#raf = requestAnimationFrame(loop);
      const index = this.#frameIndex++;
      for (const hook of this.#frameHooks) hook(timestamp, index);
      if (!this.#measuring) return;
      this.#frames.push(timestamp);
      if (this.#awaitingFrame.length) {
        const now = performance.now();
        for (const t of this.#awaitingFrame) this.#nextFrame.push(now - t);
        this.#awaitingFrame = [];
      }
    };
    this.#raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(this.#raf);
  }

  onFrame(hook: FrameHook) {
    this.#frameHooks.add(hook);
    return () => {
      this.#frameHooks.delete(hook);
    };
  }

  record(name: string, ms: number) {
    if (!this.#measuring) return;
    let buffer = this.#spans.get(name);
    if (!buffer) this.#spans.set(name, (buffer = new SampleBuffer(CAPACITY)));
    buffer.push(ms);
  }

  count(name: string, by = 1) {
    if (!this.#measuring) return;
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + by);
  }

  /** A pointer/key event that can change a manipulated pose. */
  input(timeStamp: number) {
    if (this.#measuring) this.#pendingInput = timeStamp;
  }

  /** The manipulation store committed a change. */
  committed() {
    if (!this.#measuring || this.#pendingInput === null) return;
    const t = this.#pendingInput;
    this.#pendingInput = null;
    this.#commit.push(performance.now() - t);
    this.#awaitingFrame.push(t);
  }

  #reset() {
    this.#frames.clear();
    this.#spans.clear();
    this.#counters.clear();
    this.#longTasks.clear();
    this.#commit.clear();
    this.#nextFrame.clear();
    this.#pendingInput = null;
    this.#awaitingFrame = [];
  }
}

function span(buffer: SampleBuffer): SpanResult {
  const samples = buffer.values();
  return {
    ...summarize(samples),
    unit: "ms",
    samples,
    dropped: buffer.dropped,
  };
}

/** Median cost of one `performance.now()` pair around an empty call. */
function calibrate(): number | null {
  const costs: number[] = [];
  const noop = () => {};
  for (let i = 0; i < 2000; i++) {
    const t0 = performance.now();
    noop();
    costs.push(performance.now() - t0);
  }
  return summarize(costs).median;
}

// --- The lab's entry points (no-ops unless a collector is active) --------

let active: PerfCollector | null = null;

export function activeCollector(): PerfCollector | null {
  return active;
}

export function setActiveCollector(collector: PerfCollector | null) {
  active = collector;
}

/** Counts an event (React renders, commits, mounts) while measuring. */
export function perfCount(name: string) {
  active?.count(name);
}

/**
 * Wraps a function so that each call's synchronous duration is recorded
 * while a collector is measuring. Without a collector it returns `fn`
 * itself (no wrapper, no cost).
 */
export function perfSpan<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => R,
): (...args: A) => R {
  const collector = active;
  if (!collector) return fn;
  return function (this: unknown, ...args: A) {
    if (!collector.measuring) return fn.apply(this, args);
    const t0 = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      collector.record(name, performance.now() - t0);
    }
  };
}
