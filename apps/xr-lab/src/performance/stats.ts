/**
 * P1-07C benchmark statistics: bounded sample storage and summaries.
 * Pure functions, no DOM and no type-only syntax that Node's type
 * stripping rejects: the same file is used by the in-page collector and by
 * the Node aggregation script (`scripts/bench-spatialflex.mjs`).
 */

/**
 * Percentile with linear interpolation between closest ranks (the
 * "R-7" / NumPy default definition). `p` in [0, 100]. `null` for no data
 * (never 0: missing data is not a measured zero).
 */
export function percentile(
  sorted: readonly number[],
  p: number,
): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (rank - low);
}

export interface Summary {
  readonly count: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly min: number | null;
  readonly max: number | null;
}

export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const count = sorted.length;
  return {
    count,
    mean: count ? sorted.reduce((s, v) => s + v, 0) / count : null,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: count ? sorted[0]! : null,
    max: count ? sorted[count - 1]! : null,
  };
}

/** Coefficient of variation (stddev / mean) of per-run values. */
export function variation(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  if (mean === 0) return null;
  const variance =
    finite.reduce((s, v) => s + (v - mean) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance) / Math.abs(mean);
}

/**
 * Frame cadence from `requestAnimationFrame` timestamps (ms). The refresh
 * budget is the median interval of the run itself (the browser's observed
 * vsync cadence), never an assumed display rate: frames whose interval
 * exceeds 1.5 × that budget count as over budget.
 */
export function frameCadence(timestamps: readonly number[]) {
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++)
    intervals.push(timestamps[i]! - timestamps[i - 1]!);
  const s = summarize(intervals);
  const budget = s.median;
  const over =
    budget === null
      ? null
      : intervals.filter((v) => v > budget * 1.5).length / intervals.length;
  return {
    samples: intervals.length,
    medianIntervalMs: s.median,
    p95IntervalMs: s.p95,
    p99IntervalMs: s.p99,
    maxIntervalMs: s.max,
    /** 1000 / mean interval: frames actually delivered per second. */
    observedFps:
      s.mean === null || s.mean === 0
        ? null
        : Math.round((1000 / s.mean) * 100) / 100,
    /** Share of intervals above 1.5 × the run's own median interval. */
    overBudgetRatio: over,
    budgetDefinition:
      "1.5 × median observed interval (no assumed refresh rate)",
  };
}

/**
 * A fixed-capacity sample buffer: memory stays bounded however long a
 * scenario runs; the oldest samples are overwritten.
 */
export class SampleBuffer {
  readonly #values: Float64Array;
  #next = 0;
  #size = 0;
  #dropped = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new RangeError("capacity must be a positive integer");
    this.#values = new Float64Array(capacity);
  }

  push(value: number) {
    if (this.#size === this.#values.length) this.#dropped++;
    else this.#size++;
    this.#values[this.#next] = value;
    this.#next = (this.#next + 1) % this.#values.length;
  }

  /** Samples in insertion order. */
  values(): number[] {
    const out: number[] = [];
    const start = this.#size === this.#values.length ? this.#next : 0;
    for (let i = 0; i < this.#size; i++)
      out.push(this.#values[(start + i) % this.#values.length]!);
    return out;
  }

  get size() {
    return this.#size;
  }

  /** Samples overwritten because the buffer was full. */
  get dropped() {
    return this.#dropped;
  }

  clear() {
    this.#next = this.#size = this.#dropped = 0;
  }
}
