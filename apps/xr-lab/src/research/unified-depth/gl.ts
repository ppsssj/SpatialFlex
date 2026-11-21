/**
 * P1-08A2 research: a minimal WebGL2 quad renderer (depth-tested, textured
 * or solid), shared by the raw HTML-in-Canvas track and the DOM track's
 * Adaptive panel. Quads are drawn in element CSS space (u, v) through a
 * column-major MVP, so a quad covers exactly the element's border box.
 */
const VS = `#version 300 es
in vec2 uv;
uniform mat4 mvp;
uniform vec2 size;
out vec2 t;
void main() { t = uv; gl_Position = mvp * vec4(uv * size, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 t;
uniform sampler2D tex;
uniform vec4 color;
uniform bool textured;
out vec4 o;
void main() {
  vec4 c = textured ? texture(tex, t) : color;
  // Clipped-away (transparent) texels must not write depth or color.
  if (c.a < 0.01) discard;
  o = c;
}`;

export class QuadRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly #program: WebGLProgram;
  readonly #vao: WebGLVertexArrayObject;
  readonly #u: Record<string, WebGLUniformLocation | null>;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    this.#program = p;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.#vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.#vao);
    const loc = gl.getAttribLocation(p, "uv");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.#u = Object.fromEntries(
      ["mvp", "size", "tex", "color", "textured"].map((n) => [
        n,
        gl.getUniformLocation(p, n),
      ]),
    );
  }

  begin(clear: [number, number, number, number]) {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vao);
  }

  draw(
    mvp: readonly number[],
    size: { width: number; height: number },
    fill: WebGLTexture | [number, number, number, number],
  ) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.#u.mvp!, false, new Float32Array(mvp));
    gl.uniform2f(this.#u.size!, size.width, size.height);
    if (Array.isArray(fill)) {
      gl.uniform1i(this.#u.textured!, 0);
      gl.uniform4f(this.#u.color!, fill[0], fill[1], fill[2], fill[3]);
    } else {
      gl.uniform1i(this.#u.textured!, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fill);
      gl.uniform1i(this.#u.tex!, 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/** Adaptive panel color (renderer-drawn, never DOM). */
export const PANEL_COLOR: [number, number, number, number] = [
  40 / 255,
  180 / 255,
  80 / 255,
  1,
];
export const BACKGROUND: [number, number, number, number] = [
  200 / 255,
  200 / 255,
  200 / 255,
  1,
];
