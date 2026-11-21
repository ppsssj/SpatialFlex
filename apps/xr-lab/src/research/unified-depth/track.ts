/**
 * P1-08A2 research: the contract every experimental compositing track
 * implements, and the statistics it reports. Counters are measured, never
 * estimated: uploads are counted where the upload call is made, clip writes
 * where `style.clipPath` is assigned, frame times from rAF timestamps.
 */
import type { DepthPlane } from "./depthResolver.js";
import type { ScenarioLayout } from "./scene.js";
import type { MountedSurface, SurfaceHosts, SurfaceId } from "./surfaces.js";

export interface TrackStats {
  frames: number;
  /** Paint events (HTML-in-Canvas) or compose passes (DOM). */
  paints: number;
  /** Texture uploads from DOM content (HTML-in-Canvas tracks). */
  uploads: number;
  uploadedPixels: number;
  /** Textures currently allocated / ever allocated / deleted. */
  texturesLive: number;
  texturesAllocated: number;
  texturesDeleted: number;
  /** Bytes of live texture storage allocated from DOM content (RGBA8, level 0). */
  textureBytes: number;
  /** `style.clipPath` assignments and the last total clip vertex count. */
  clipWrites: number;
  clipVertices: number;
  /** `updateElementGeometry` calls. */
  geometryCalls: number;
  /** CPU ms spent in the track's per-frame work (sum, and samples). */
  composeMs: number[];
  /** rAF frame intervals (ms). */
  intervals: number[];
  errors: string[];
}

export const emptyStats = (): TrackStats => ({
  frames: 0,
  paints: 0,
  uploads: 0,
  uploadedPixels: 0,
  texturesLive: 0,
  texturesAllocated: 0,
  texturesDeleted: 0,
  textureBytes: 0,
  clipWrites: 0,
  clipVertices: 0,
  geometryCalls: 0,
  composeMs: [],
  intervals: [],
  errors: [],
});

export interface TrackContext {
  readonly stage: HTMLElement;
  readonly hosts: SurfaceHosts;
  /** Current scenario layout (animated in S8). */
  layout(): ScenarioLayout;
  planes(): DepthPlane[];
  readonly params: URLSearchParams;
}

export interface Track {
  readonly name: string;
  /** Id of the element that receives events nothing else owns. */
  readonly canvasId: string;
  /** Whether A's Native element is still in its page slot. */
  readonly nativeInSlot: boolean;
  /** Feature detection actually performed by this track. */
  capability(): Record<string, unknown>;
  /** Places a newly mounted Surface host into the track's structure. */
  adopt(m: MountedSurface): void;
  /** Called after a Surface was removed (its host is already detached). */
  release(id: SurfaceId): void;
  /** One frame: apply the current layout. */
  frame(): void;
  readonly stats: TrackStats;
  dispose(): void;
}

const pct = (xs: readonly number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

export function summarize(xs: readonly number[]) {
  return {
    n: xs.length,
    median: pct(xs, 50),
    p95: pct(xs, 95),
    p99: pct(xs, 99),
    max: xs.length ? Math.max(...xs) : NaN,
  };
}
