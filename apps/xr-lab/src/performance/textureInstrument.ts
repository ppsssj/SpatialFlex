import type { HostPanelBody } from "../contracts/xrHost";
import { describeBody } from "../hosts/shared/panelFace";
import type { PerfCollector } from "./collector";

/**
 * P1-07D texture-pipeline instrumentation (benchmark mode only, installed
 * by `enableBenchmarkMode`; ordinary pages never import this module). Each
 * wrapper calls the original with the same arguments and returns its
 * result; `uninstall` restores the exact original functions.
 *
 * Directly observed (synchronous JavaScript CPU time, ms, or counts):
 * - `gl.texImage2D`, `gl.texSubImage2D`, `gl.texStorage2D`,
 *   `gl.generateMipmap`: duration of the WebGL API call on the main thread.
 *   This is NOT GPU execution time: browsers queue the work (Chromium sends
 *   it to its GPU process; Firefox may upload synchronously). Counted for
 *   both engines on the same WebGL prototypes, so they are comparable.
 * - counters `gl.uploadCalls` (texImage2D/texSubImage2D with a DOM/canvas
 *   source), `gl.uploadPixels` (width × height of those sources),
 *   `gl.createTexture`, `gl.deleteTexture`.
 * - `three.panelFaceDraw` / `three.controlFaceDraw`: CanvasFace.drawPanel /
 *   drawButton (2D canvas drawing + marking the texture dirty). Each call
 *   sets `needsUpdate` once (counter `three.textureDirty`); a dirty texture
 *   is uploaded at most once, at the next render that draws it (inferred
 *   from three.js source; the GL counters show the actual uploads).
 *   Draw reasons: `three.faceDraw.initial`, `.content` (title/body text
 *   changed), `.selection`, `.unchanged` (same text, same selection).
 * - `three.faceDispose`: CanvasFace.dispose.
 * - `babylon.textureUpdate`: DynamicTexture.update (its upload happens
 *   here, outside `render.babylon`; three.js uploads inside `render.three`).
 */
export async function installTextureInstrumentation(
  collector: PerfCollector,
  engine: string,
): Promise<() => void> {
  const restores: (() => void)[] = [];
  const replace = <T extends object>(
    target: T,
    key: string,
    make: (original: (...a: unknown[]) => unknown) => unknown,
  ) => {
    const record = target as Record<string, unknown>;
    const original = record[key] as (...a: unknown[]) => unknown;
    record[key] = make(original);
    restores.push(() => {
      record[key] = original;
    });
  };
  const timed =
    (name: string, before?: (args: unknown[]) => void) =>
    (original: (...a: unknown[]) => unknown) =>
      function (this: unknown, ...args: unknown[]) {
        if (!collector.measuring) return original.apply(this, args);
        before?.(args);
        const t0 = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          collector.record(name, performance.now() - t0);
        }
      };

  const uploadSource = (args: unknown[]) => {
    const source = args[args.length - 1];
    if (
      typeof HTMLCanvasElement !== "undefined" &&
      (source instanceof HTMLCanvasElement ||
        (typeof OffscreenCanvas !== "undefined" &&
          source instanceof OffscreenCanvas) ||
        (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap))
    ) {
      collector.count("gl.uploadCalls");
      collector.count("gl.uploadPixels", source.width * source.height);
    }
  };
  const contexts = [
    globalThis.WebGL2RenderingContext?.prototype,
    globalThis.WebGLRenderingContext?.prototype,
  ].filter(Boolean) as object[];
  for (const proto of contexts) {
    replace(proto, "texImage2D", timed("gl.texImage2D", uploadSource));
    replace(proto, "texSubImage2D", timed("gl.texSubImage2D", uploadSource));
    if ("texStorage2D" in proto)
      replace(proto, "texStorage2D", timed("gl.texStorage2D"));
    replace(proto, "generateMipmap", timed("gl.generateMipmap"));
    for (const name of ["createTexture", "deleteTexture"])
      replace(
        proto,
        name,
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            collector.count(`gl.${name}`);
            return original.apply(this, args);
          },
      );
  }

  if (engine === "three") {
    const { CanvasFace } = await import("../hosts/three/panelTexture");
    const last = new WeakMap<object, { text: string; selected: boolean }>();
    replace(
      CanvasFace.prototype,
      "drawPanel",
      (original) =>
        function (this: object, ...args: unknown[]) {
          if (!collector.measuring) {
            remember(this, args);
            return original.apply(this, args);
          }
          const [title, body, selected] = args as [
            string,
            HostPanelBody,
            boolean,
          ];
          const text = `${title}\n${describeBody(body)}`;
          const previous = last.get(this);
          collector.count(
            !previous
              ? "three.faceDraw.initial"
              : previous.text !== text
                ? "three.faceDraw.content"
                : previous.selected !== selected
                  ? "three.faceDraw.selection"
                  : "three.faceDraw.unchanged",
          );
          last.set(this, { text, selected });
          collector.count("three.textureDirty");
          const t0 = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            collector.record("three.panelFaceDraw", performance.now() - t0);
          }
        },
    );
    function remember(face: object, args: unknown[]) {
      const [title, body, selected] = args as [string, HostPanelBody, boolean];
      last.set(face, {
        text: `${title}\n${describeBody(body)}`,
        selected,
      });
    }
    replace(
      CanvasFace.prototype,
      "drawButton",
      timed("three.controlFaceDraw", () =>
        collector.count("three.textureDirty"),
      ),
    );
    replace(
      CanvasFace.prototype,
      "dispose",
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          collector.count("three.faceDispose");
          return original.apply(this, args);
        },
    );
  } else {
    const { DynamicTexture } =
      await import("@babylonjs/core/Materials/Textures/dynamicTexture");
    replace(DynamicTexture.prototype, "update", timed("babylon.textureUpdate"));
  }

  return () => {
    for (const restore of restores.reverse()) restore();
  };
}
