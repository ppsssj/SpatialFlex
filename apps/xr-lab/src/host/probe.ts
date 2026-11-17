/**
 * Read-only diagnostics for automated tests and measurements.
 *
 * Part of the host, so it is identical for every integration. It never
 * triggers interactions: it only reports where panel parts are on screen,
 * how many frames were rendered, and when each panel was last drawn.
 */
export interface HostProbe {
  /** Client (CSS pixel) coordinates of a panel part's center, if visible. */
  locate(panelId: string, part: string): { x: number; y: number } | null;
  /** World position (meters) of a panel part's center, if present. */
  worldPosition(panelId: string, part: string): [number, number, number] | null;
  /** Whether a panel part currently shows hover feedback. */
  hovered(panelId: string, part: string): boolean;
  /** Frames rendered so far. */
  frames: number;
  /** Recent frame times in milliseconds (last 600 frames). */
  frameTimes: number[];
  /** Last drawn body per panel, with a `performance.now()` timestamp. */
  drawn: Record<string, { text: string; at: number }>;
  /** Ids of panels currently in the scene. */
  panels: string[];
  /** Current XR session mode, or null outside XR. */
  sessionMode: string | null;
}

/** Records that a panel's body was drawn. */
export function recordDrawn(panelId: string, text: string) {
  getProbe().drawn[panelId] = { text, at: performance.now() };
}

export function getProbe(): HostProbe {
  const w = window as unknown as { __xrHostProbe?: HostProbe };
  w.__xrHostProbe ??= {
    locate: () => null,
    worldPosition: () => null,
    hovered: () => false,
    frames: 0,
    frameTimes: [],
    drawn: {},
    panels: [],
    sessionMode: null,
  };
  return w.__xrHostProbe;
}
