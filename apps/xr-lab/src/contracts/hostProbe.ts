/**
 * Read-only diagnostics that every XR host reports, for automated tests and
 * measurements. Identical for every engine and integration. It never
 * triggers interactions.
 *
 * Exposed as `window.__xrHostProbe` only in development and in builds made
 * with `VITE_XR_LAB_TEST_HOOKS=1` (the E2E builds).
 */
export interface HostProbe {
  /** Engine that currently renders, or null when no host is mounted. */
  engine: string | null;
  /** Client (CSS pixel) coordinates of a panel part's center, if visible. */
  locate(panelId: string, part: string): { x: number; y: number } | null;
  /** World position (meters) of a panel part's center, if present. */
  worldPosition(panelId: string, part: string): [number, number, number] | null;
  /** Whether a panel part currently shows hover feedback. */
  hovered(panelId: string, part: string): boolean;
  /** Frames rendered so far. */
  frames: number;
  /**
   * Intervals between frame callbacks, in milliseconds (last 600). A proxy
   * for frame time: JavaScript callback timing, not GPU presentation.
   */
  frameTimes: number[];
  /**
   * Last drawn body per panel, with a `performance.now()` timestamp taken
   * when the CPU-side texture update finished (not GPU presentation).
   */
  drawn: Record<string, { text: string; at: number }>;
  /** Ids of panels currently in the scene. */
  panels: string[];
  /** Current XR session mode, or null outside XR. */
  sessionMode: string | null;
  /** Panel textures currently alive (created and not yet disposed). */
  liveTextures: number;
  /** Hosts currently mounted with a live engine and render loop. */
  activeHosts: number;
}

export const testHooksEnabled =
  import.meta.env.DEV || import.meta.env.VITE_XR_LAB_TEST_HOOKS === "1";

const probe: HostProbe = {
  engine: null,
  locate: () => null,
  worldPosition: () => null,
  hovered: () => false,
  frames: 0,
  frameTimes: [],
  drawn: {},
  panels: [],
  sessionMode: null,
  liveTextures: 0,
  activeHosts: 0,
};

if (testHooksEnabled && typeof window !== "undefined") {
  (window as unknown as { __xrHostProbe: HostProbe }).__xrHostProbe = probe;
}

export function getProbe(): HostProbe {
  return probe;
}

/** Records that a panel's body was drawn (CPU-side texture update). */
export function recordDrawn(panelId: string, text: string) {
  probe.drawn[panelId] = { text, at: performance.now() };
}

/** Records one rendered frame. */
export function recordFrame(intervalMs: number | null) {
  probe.frames++;
  if (intervalMs !== null) probe.frameTimes.push(intervalMs);
  if (probe.frameTimes.length > 600) probe.frameTimes.shift();
}

export function textureCreated() {
  probe.liveTextures++;
}

export function textureDisposed() {
  probe.liveTextures--;
}

/** Registers a mounted host. Returns the matching unregister function. */
export function hostMounted(engine: string) {
  probe.activeHosts++;
  probe.engine = engine;
  return () => {
    probe.activeHosts--;
    if (probe.activeHosts === 0) {
      probe.engine = null;
      probe.panels = [];
      probe.sessionMode = null;
      probe.locate = () => null;
      probe.worldPosition = () => null;
      probe.hovered = () => false;
    }
  };
}
