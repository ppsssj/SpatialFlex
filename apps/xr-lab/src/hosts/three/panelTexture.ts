import { CanvasTexture, SRGBColorSpace } from "three";
import { textureCreated, textureDisposed } from "../../contracts/hostProbe";
import type { HostPanelBody } from "../../contracts/xrHost";
import { drawButtonFace, drawPanelFace, pixelSize } from "../shared/panelFace";

/** A canvas-backed Three.js texture that is redrawn in place. */
export class CanvasFace {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;

  constructor(widthM: number, heightM: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = pixelSize(widthM);
    this.canvas.height = pixelSize(heightM);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
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
