// @vitest-environment jsdom
// P1-07D: panel faces are stored as RGBA8 and decoded from sRGB in the
// shader (the measured fix for SRGB8_ALPHA8 canvas uploads). The rendered
// result is verified with real browser pixels in e2e/textures.spec.ts.
import { MeshBasicMaterial, NoColorSpace, ShaderChunk } from "three";
import { describe, expect, it } from "vitest";
import { getProbe } from "../../contracts/hostProbe";
import { CanvasFace, decodeFaceColor } from "./panelTexture";

describe("P1-07D CanvasFace texture format", () => {
  it("stores the canvas without an sRGB texture format and keeps its size and probe counts", () => {
    const live = getProbe().liveTextures;
    const face = new CanvasFace(0.6, 0.4);
    expect(face.texture.colorSpace).toBe(NoColorSpace);
    expect(face.texture.image).toBe(face.canvas);
    // Full resolution (PIXELS_PER_METER), mipmapped as before.
    expect([face.canvas.width, face.canvas.height]).toEqual([600, 400]);
    expect(face.texture.generateMipmaps).toBe(true);
    // The face owns its material: the texture never passes through a JSX
    // \`map\` prop (React Three Fiber would re-tag it as SRGBColorSpace).
    expect(face.material.map).toBe(face.texture);
    expect(face.material.toneMapped).toBe(false);
    expect(face.material.onBeforeCompile).toBe(decodeFaceColor);
    expect(getProbe().liveTextures).toBe(live + 1);
    face.dispose();
    expect(getProbe().liveTextures).toBe(live);
  });

  it("decodes the sampled face color from sRGB in the material shader", () => {
    const shader = {
      fragmentShader: `void main() {\n#include <map_fragment>\n}`,
    } as Parameters<typeof decodeFaceColor>[0];
    decodeFaceColor(shader);
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
    expect(shader.fragmentShader).toContain(
      "diffuseColor *= sRGBTransferEOTF( texture2D( map, vMapUv ) );",
    );
    // The replaced chunk is three.js's own map chunk (same sampling).
    expect(ShaderChunk.map_fragment).toContain("texture2D( map, vMapUv )");
    // One shared function: one shader program for every face material.
    const a = new MeshBasicMaterial({ toneMapped: false });
    const b = new MeshBasicMaterial({ toneMapped: false });
    a.onBeforeCompile = decodeFaceColor;
    b.onBeforeCompile = decodeFaceColor;
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toBe(
      new MeshBasicMaterial().customProgramCacheKey(),
    );
  });
});
