import type { HostPanelBody } from "../contracts/xrHost";
import { drawPanelFace } from "../hosts/shared/panelFace";

/**
 * P1-07D diagnostic ablations of the Three.js panel face pipeline
 * (`&ablate=face-…`, benchmark mode only). They DELIBERATELY change or
 * stale what is drawn, to attribute cost to one stage; results are labeled
 * as ablations and are never product measurements. Each patches
 * `CanvasFace.prototype.drawPanel` and restores it on uninstall.
 *
 * Every variant draws the first frame normally (so panels exist and the
 * benchmark's validity checks pass), then changes only later redraws:
 * - `face-no-redraw` (A1): later updates skip the 2D drawing but still mark
 *   the texture dirty (upload of unchanged pixels: upload cost only).
 * - `face-no-upload` (A2): later updates draw the canvas but never mark the
 *   texture dirty (drawing cost only; stale pixels on screen).
 * - `face-half-res` (A3): the face canvas is half the width and height
 *   (a quarter of the pixels); everything else is unchanged.
 * - `face-linear` (A5): the texture's color space is "none", so three.js
 *   allocates RGBA8 instead of SRGB8_ALPHA8 (colors are not decoded:
 *   lighter on screen). Isolates the sRGB texture format. It runs after
 *   React Three Fiber applied the material's map (which re-tags textures
 *   as sRGB), and re-allocates. Measured on the pre-P1-07D face; since the
 *   P1-07D fix the face stores RGBA8 itself, so this changes nothing there.
 * - `face-no-mipmap` (A6): no mipmap generation (linear minification).
 * - `face-realloc` (A7): nothing changes except that the texture is
 *   released once, at the first draw, so three.js allocates and uploads it
 *   again from the drawn canvas. (Every variant above that sets
 *   `reallocate` does this too: A7 isolates that side effect.)
 */
export const TEXTURE_ABLATIONS = [
  "face-no-redraw",
  "face-no-upload",
  "face-half-res",
  "face-linear",
  "face-no-mipmap",
  "face-realloc",
] as const;

type Face = {
  canvas: HTMLCanvasElement;
  texture: {
    needsUpdate: boolean;
    colorSpace: string;
    generateMipmaps: boolean;
    minFilter: number;
    dispose(): void;
  };
};

export async function applyTextureAblations(
  names: readonly string[],
): Promise<() => void> {
  const active = TEXTURE_ABLATIONS.filter((n) => names.includes(n));
  if (active.length === 0) return () => {};
  const [{ CanvasFace }, three] = await Promise.all([
    import("../hosts/three/panelTexture"),
    import("three"),
  ]);
  const proto = CanvasFace.prototype as unknown as Record<string, unknown>;
  const original = proto.drawPanel as (
    this: Face,
    title: string,
    body: HostPanelBody,
    selected: boolean,
  ) => void;
  const drawn = new WeakSet<object>();
  const has = (name: (typeof TEXTURE_ABLATIONS)[number]) =>
    active.includes(name);
  proto.drawPanel = function (
    this: Face,
    title: string,
    body: HostPanelBody,
    selected: boolean,
  ) {
    if (!drawn.has(this)) {
      drawn.add(this);
      let reallocate = has("face-realloc");
      if (has("face-half-res")) {
        this.canvas.width = Math.round(this.canvas.width / 2);
        this.canvas.height = Math.round(this.canvas.height / 2);
        reallocate = true;
      }
      if (has("face-linear")) {
        this.texture.colorSpace = three.NoColorSpace;
        reallocate = true;
      }
      if (has("face-no-mipmap")) {
        this.texture.generateMipmaps = false;
        this.texture.minFilter = three.LinearFilter;
        reallocate = true;
      }
      // The texture may already be allocated with the old size/format:
      // release it; three.js allocates it again on the next upload.
      if (reallocate) this.texture.dispose();
      if (has("face-half-res")) {
        const ctx = this.canvas.getContext("2d")!;
        ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
        drawPanelFace(
          ctx,
          this.canvas.width * 2,
          this.canvas.height * 2,
          title,
          body,
          selected,
        );
        this.texture.needsUpdate = true;
        return;
      }
      return original.call(this, title, body, selected);
    }
    if (has("face-no-redraw")) {
      this.texture.needsUpdate = true;
      return;
    }
    if (has("face-no-upload")) {
      drawPanelFace(
        this.canvas.getContext("2d")!,
        this.canvas.width,
        this.canvas.height,
        title,
        body,
        selected,
      );
      return;
    }
    if (has("face-half-res")) {
      drawPanelFace(
        this.canvas.getContext("2d")!,
        this.canvas.width * 2,
        this.canvas.height * 2,
        title,
        body,
        selected,
      );
      this.texture.needsUpdate = true;
      return;
    }
    return original.call(this, title, body, selected);
  };
  return () => {
    proto.drawPanel = original;
  };
}
