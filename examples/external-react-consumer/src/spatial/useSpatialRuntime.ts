import type { PresentationStrategy } from "@spatialflex/react";
import { useSpatialPresentations } from "@spatialflex/react/spatial";
import { useEffect } from "react";

/**
 * This application's spatial policy on top of the SDK runtime
 * (`useSpatialPresentations` of @spatialflex/react/spatial), which owns the
 * presentation lifecycle: instances, liveness, manipulation, Native DOM
 * placement, handles and cleanup. What stays here is the app's own
 * choice: where new panels appear and how large native panels are.
 */

/** World meters per CSS pixel of a native panel at scale 1. */
const METERS_PER_PIXEL = 0.0022;
const ADAPTIVE_EXTENT = { width: 0.6, height: 0.4 } as const;

/** Start positions in front of the default camera, one slot per panel. */
const slot = (index: number) =>
  [-0.4 + (index % 2) * 0.8, 1.6 - Math.floor(index / 2) * 0.55, -1] as const;

export type Extraction = PresentationStrategy;

/** Read-only probe for the end-to-end tests (poses and sessions). */
declare global {
  interface Window {
    __spatialConsumer?: {
      targets: () => unknown[];
      poseOf: (id: string) => unknown;
      getSnapshot: () => { active: unknown; selected: string | null };
    };
  }
}

export function useSpatialRuntime() {
  const { runtime, presentations, issues } = useSpatialPresentations();
  const items = runtime.manipulation;

  useEffect(() => {
    window.__spatialConsumer = {
      targets: items.targets,
      poseOf: items.poseOf,
      getSnapshot: items.getSnapshot,
    };
    return () => {
      delete window.__spatialConsumer;
    };
  }, [items]);

  const kindOf = (id: string) =>
    presentations.find((p) => p.itemId === id)?.kind ?? null;

  /** Ancestor styles (or capabilities) that prevent Native DOM ("" if none). */
  const nativeBlocker = (id: string) => {
    const support = runtime.nativeSupport(id);
    return support.supported ? "" : support.reason;
  };

  /** Extracts a component; returns why it was refused, or null. */
  const extract = (id: string, as: Extraction): string | null => {
    const result = runtime.extract(id, as, {
      position: slot(presentations.length),
      metersPerPixel: METERS_PER_PIXEL,
      extent: ADAPTIVE_EXTENT,
    });
    return result.ok ? null : result.reason;
  };

  return {
    runtime,
    issues,
    kindOf,
    nativeBlocker,
    extract,
    restore: (id: string) => runtime.restore(id),
  };
}

export type SpatialRuntime = ReturnType<typeof useSpatialRuntime>;
