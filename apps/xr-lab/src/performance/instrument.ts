import { ItemManipulator, SpatialManipulator } from "@spatialflex/core";
import {
  NativeCompositor,
  PresentationRuntime,
  type PresentationHost,
} from "@spatialflex/dom";
import type { PerfCollector } from "./collector";

/**
 * P1-07C instrumentation: wraps SDK methods on their prototypes so the
 * benchmark can time them without changing SDK code. Installed only in
 * benchmark mode (the SDK's own behavior and results are unchanged; each
 * wrapper calls the original with the same arguments and returns its
 * result). `uninstall` restores the exact original functions.
 *
 * Spans (synchronous JavaScript time, ms):
 * - `dom.composite`: NativeCompositor.composite (per host frame: geometry
 *   reads, containment checks, transform/clip math and style writes).
 * - `dom.setTargets`: NativeCompositor.setTargets (target reconciliation).
 * - `dom.hostFrame`: PresentationHost.frame (frame copy + composite).
 * - `dom.extract` / `dom.restore`: PresentationRuntime transactions.
 * - `core.itemSync`: ItemManipulator.sync (presentation synchronization).
 * - `core.manipulationUpdate`: SpatialManipulator.update (one pointer step).
 */
export function installInstrumentation(collector: PerfCollector) {
  const restores: (() => void)[] = [];
  const wrap = <T extends object, K extends keyof T & string>(
    target: T,
    key: K,
    name: string,
  ) => {
    const original = target[key] as unknown as (...args: unknown[]) => unknown;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      if (!collector.measuring) return original.apply(this, args);
      const t0 = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        collector.record(name, performance.now() - t0);
      }
    };
    (target as Record<string, unknown>)[key] = wrapped;
    restores.push(() => {
      (target as Record<string, unknown>)[key] = original;
    });
  };

  wrap(NativeCompositor.prototype, "composite", "dom.composite");
  wrap(NativeCompositor.prototype, "setTargets", "dom.setTargets");
  wrap(PresentationRuntime.prototype, "extract", "dom.extract");
  wrap(PresentationRuntime.prototype, "restore", "dom.restore");
  wrap(ItemManipulator.prototype, "sync", "core.itemSync");
  wrap(SpatialManipulator.prototype, "update", "core.manipulationUpdate");

  const connectHost = PresentationRuntime.prototype.connectHost;
  PresentationRuntime.prototype.connectHost = function (
    this: PresentationRuntime,
    ...args: Parameters<PresentationRuntime["connectHost"]>
  ): PresentationHost {
    const host = connectHost.apply(this, args);
    const frame = host.frame;
    return {
      ...host,
      frame(cameraFrame, options) {
        if (!collector.measuring) return frame(cameraFrame, options);
        const t0 = performance.now();
        try {
          return frame(cameraFrame, options);
        } finally {
          collector.record("dom.hostFrame", performance.now() - t0);
        }
      },
    };
  };
  restores.push(() => {
    PresentationRuntime.prototype.connectHost = connectHost;
  });

  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

/**
 * Renderer CPU submission time per frame (`render.three`: the
 * WebGLRenderer.render call; `render.babylon`: Scene.render). JavaScript
 * time to record and submit draw calls, not GPU execution time.
 */
export async function instrumentRenderer(
  collector: PerfCollector,
  engine: string,
): Promise<() => void> {
  if (engine === "three") {
    // three.js assigns `render` per instance in the WebGLRenderer
    // constructor: a setter on the prototype receives that assignment and
    // installs the timed wrapper as the instance's own property.
    const { WebGLRenderer } = await import("three");
    const proto = WebGLRenderer.prototype as unknown as Record<string, unknown>;
    const previous = Object.getOwnPropertyDescriptor(proto, "render");
    Object.defineProperty(proto, "render", {
      configurable: true,
      set(
        this: Record<string, unknown>,
        original: (...a: unknown[]) => unknown,
      ) {
        Object.defineProperty(this, "render", {
          configurable: true,
          writable: true,
          value(this: unknown, ...args: unknown[]) {
            if (!collector.measuring) return original.apply(this, args);
            const t0 = performance.now();
            try {
              return original.apply(this, args);
            } finally {
              collector.record("render.three", performance.now() - t0);
            }
          },
        });
      },
    });
    return () => {
      if (previous) Object.defineProperty(proto, "render", previous);
      else delete proto.render;
    };
  }
  const { Scene } = await import("@babylonjs/core/scene");
  const original = Scene.prototype.render;
  Scene.prototype.render = function (
    this: InstanceType<typeof Scene>,
    ...args: Parameters<typeof original>
  ) {
    if (!collector.measuring) return original.apply(this, args);
    const t0 = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      collector.record("render.babylon", performance.now() - t0);
    }
  };
  return () => {
    Scene.prototype.render = original;
  };
}
