import {
  CanvasTexture,
  MeshBasicMaterial,
  NoColorSpace,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { textureCreated, textureDisposed } from "../../contracts/hostProbe";
import type { HostPanelBody } from "../../contracts/xrHost";
import { drawButtonFace, drawPanelFace, pixelSize } from "../shared/panelFace";

/**
 * A canvas-backed Three.js face (texture and material) that is redrawn in
 * place.
 *
 * The canvas holds sRGB-encoded pixels. They are stored as they are, in an
 * RGBA8 texture (color space "none"), and the face's own material decodes
 * them to linear in the fragment shader ({@link decodeFaceColor}) — the
 * approach three.js itself uses for sRGB video textures. P1-07D measured
 * that re-uploading a 2D canvas into an SRGB8_ALPHA8 texture (three.js's
 * format for SRGBColorSpace) was the dominant per-update cost of dynamic
 * panels; see docs/p1-07d-three-adaptive-performance.md.
 *
 * The material is built here, not through a JSX `map` prop: React Three
 * Fiber re-tags any texture applied as a material's `map` prop as
 * SRGBColorSpace, which would silently restore SRGB8_ALPHA8 (and, with the
 * shader decode, decode twice). Owning both keeps the storage format and
 * its decode together.
 */
export class CanvasFace {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  readonly material: MeshBasicMaterial;

  constructor(widthM: number, heightM: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = pixelSize(widthM);
    this.canvas.height = pixelSize(heightM);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = NoColorSpace;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
    });
    this.material.onBeforeCompile = decodeFaceColor;
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
    this.material.dispose();
    this.texture.dispose();
    textureDisposed();
  }
}

/**
 * `onBeforeCompile` of every {@link CanvasFace} material: decodes
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
