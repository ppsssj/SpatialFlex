import {
  CanvasTexture,
  NoColorSpace,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { textureCreated, textureDisposed } from "../../contracts/hostProbe";
import type { HostPanelBody } from "../../contracts/xrHost";
import { drawButtonFace, drawPanelFace, pixelSize } from "../shared/panelFace";

/**
 * A canvas-backed Three.js texture that is redrawn in place.
 *
 * The canvas holds sRGB-encoded pixels. They are stored as they are, in an
 * RGBA8 texture (color space "none"), and decoded to linear in the fragment
 * shader ({@link decodeFaceColor}) — the approach three.js itself uses for
 * sRGB video textures. P1-07D measured that re-uploading a 2D canvas into
 * an SRGB8_ALPHA8 texture (three.js's default for SRGBColorSpace) was the
 * dominant per-update cost of dynamic panels; see
 * docs/p1-07d-three-adaptive-performance.md.
 */
export class CanvasFace {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;

  constructor(widthM: number, heightM: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = pixelSize(widthM);
    this.canvas.height = pixelSize(heightM);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = NoColorSpace;
    textureCreated();
  }

  drawPanel(title: string, body: HostPanelBody, selected: boolean) {
    const { width, height } = this.canvas;
    drawPanelFace(
      this.canvas.getContext("2d")!,
      width,
      height,
      title,
      body,
      selected,
    );
    this.texture.needsUpdate = true;
  }

  drawButton(label: string, hovered: boolean) {
    const { width, height } = this.canvas;
    drawButtonFace(
      this.canvas.getContext("2d")!,
      width,
      height,
      label,
      hovered,
    );
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    textureDisposed();
  }
}

/**
 * `onBeforeCompile` for materials that show a {@link CanvasFace}: decodes
 * the sampled sRGB face color to linear (what an SRGB8_ALPHA8 texture does
 * in hardware), so the rendered colors stay those of the canvas.
 */
export function decodeFaceColor(shader: WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    // three.js's map_fragment chunk with its video-texture sRGB decode
    // applied to every face (sRGBTransferEOTF keeps alpha).
    "#ifdef USE_MAP\n\tdiffuseColor *= sRGBTransferEOTF( texture2D( map, vMapUv ) );\n#endif",
  );
}
