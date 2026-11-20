// @vitest-environment jsdom
// P1-07D: texture-pipeline instrumentation isolation (D8) and metric
// definitions. jsdom has no WebGL: a stand-in context class with the same
// method names is installed for the duration of each test.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasFace } from "../hosts/three/panelTexture";
import { PerfCollector } from "./collector";
import { applyTextureAblations } from "./textureAblations";
import { installTextureInstrumentation } from "./textureInstrument";

class FakeGL {
  calls: string[] = [];
  texImage2D(...args: unknown[]) {
    this.calls.push(`texImage2D:${args.length}`);
  }
  texSubImage2D(...args: unknown[]) {
    this.calls.push(`texSubImage2D:${args.length}`);
  }
  texStorage2D(...args: unknown[]) {
    this.calls.push(`texStorage2D:${args.length}`);
  }
  generateMipmap() {
    this.calls.push("generateMipmap");
  }
  createTexture() {
    return { id: this.calls.push("createTexture") };
  }
  deleteTexture() {
    this.calls.push("deleteTexture");
  }
}

const g = globalThis as Record<string, unknown>;
let saved: unknown;
beforeEach(() => {
  saved = g.WebGL2RenderingContext;
  g.WebGL2RenderingContext = FakeGL;
});
afterEach(() => {
  g.WebGL2RenderingContext = saved;
});

const glMethods = () =>
  [
    "texImage2D",
    "texSubImage2D",
    "texStorage2D",
    "generateMipmap",
    "createTexture",
    "deleteTexture",
  ].map((k) => (FakeGL.prototype as unknown as Record<string, unknown>)[k]);
const faceMethods = () => [
  CanvasFace.prototype.drawPanel,
  CanvasFace.prototype.drawButton,
  CanvasFace.prototype.dispose,
];

describe("D8 texture instrumentation isolation", () => {
  it("wraps WebGL and CanvasFace methods, preserves results, and uninstalls to the exact originals", async () => {
    const gl0 = glMethods();
    const face0 = faceMethods();
    const collector = new PerfCollector();
    const uninstall = await installTextureInstrumentation(collector, "three");
    expect(glMethods()).not.toEqual(gl0);
    expect(faceMethods()).not.toEqual(face0);

    const gl = new FakeGL();
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    // Not measuring: calls pass through and nothing is recorded.
    gl.texSubImage2D(0, 0, 0, 0, 0, 0, canvas);
    collector.start();
    const texture = gl.createTexture();
    gl.texSubImage2D(0, 0, 0, 0, 0, 0, canvas);
    gl.texImage2D(0, 0, 0x8058, 0, 0, new Uint8Array(4)); // not a DOM source
    gl.texStorage2D(0, 10, 0x8c43, 600, 400);
    gl.generateMipmap();
    gl.deleteTexture();
    const result = collector.stop();
    expect(texture).toEqual({ id: 2 });
    expect(gl.calls).toEqual([
      "texSubImage2D:7",
      "createTexture",
      "texSubImage2D:7",
      "texImage2D:6",
      "texStorage2D:5",
      "generateMipmap",
      "deleteTexture",
    ]);
    expect(result.counters["gl.uploadCalls"]).toBe(1);
    expect(result.counters["gl.uploadPixels"]).toBe(600 * 400);
    expect(result.counters["gl.createTexture"]).toBe(1);
    expect(result.counters["gl.allocate.RGBA8"]).toBe(1);
    expect(result.counters["gl.allocate.SRGB8_ALPHA8"]).toBe(1);
    expect(result.counters["gl.deleteTexture"]).toBe(1);
    expect(result.spans["gl.texSubImage2D"]!.count).toBe(1);
    expect(result.spans["gl.texImage2D"]!.count).toBe(1);
    expect(result.spans["gl.generateMipmap"]!.unit).toBe("ms");

    uninstall();
    expect(glMethods()).toEqual(gl0);
    expect(faceMethods()).toEqual(face0);
  });

  it("face ablations patch only on request and restore drawPanel", async () => {
    const original = CanvasFace.prototype.drawPanel;
    const none = await applyTextureAblations([]);
    expect(CanvasFace.prototype.drawPanel).toBe(original);
    none();
    const undo = await applyTextureAblations(["face-no-upload", "page-clip"]);
    expect(CanvasFace.prototype.drawPanel).not.toBe(original);
    undo();
    expect(CanvasFace.prototype.drawPanel).toBe(original);
  });
});
