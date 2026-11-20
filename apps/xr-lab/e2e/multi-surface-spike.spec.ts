import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
// P1-08A primitives are package-internal: imported from source.
import {
  cssToWorld,
  intersectSurface,
  resolveOwner,
  type InputHit,
  type SurfaceGeometry,
} from "../../../packages/core/src/workspace/index.js";
import {
  nativePanelTransform,
  occlusionClipPath,
  quaternionFromEuler,
  surfaceTransform,
  transformedQuad,
  viewportRay,
  type CameraFrame,
  type SpatialWebSurfacePose,
  type Vec3,
} from "../../../packages/dom/src/projection.js";

/**
 * P1-08A two-Surface technical spike (feasibility evidence, NOT a
 * Multi-Surface feature). An isolated page (no XR Lab shell, no renderer
 * host) with two transformed webpage planes placed by the SDK's own
 * projection (`surfaceTransform`, `nativePanelTransform`,
 * `occlusionClipPath`), a real WebGL canvas drawing an "Adaptive" panel,
 * and a shared camera. For each probe point it records, in the real
 * browser: which layer is painted, which element `elementFromPoint`
 * returns and which listener a real mouse click reaches, against the
 * geometric owner the P1-08A input contract (`resolveOwner`) computes from
 * the world ray. Evidence: docs/evidence/p1-08a (P1_08A_EVIDENCE=1).
 */

const W = 1000;
const H = 700;
const RES = { width: 400, height: 300 };
const MPP = 0.0025; // 1.0 × 0.75 m pages

// --- Camera (column-major, WebGL clip space) ------------------------------
function camera(eye: Vec3, target: Vec3, fovY: number): CameraFrame {
  const f = 1 / Math.tan(fovY / 2);
  const near = 0.1;
  const far = 100;
  const aspect = W / H;
  const P = [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ];
  const sub = (a: Vec3, b: Vec3): Vec3 => [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
  ];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  const V = [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ];
  const vp = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        vp[c * 4 + r]! += P[k * 4 + r]! * V[c * 4 + k]!;
  return {
    viewProjection: vp,
    viewport: { left: 0, top: 0, width: W, height: H },
    eye,
  };
}

const FRAME = camera([0, 1.4, 2], [0, 1.4, -1], (50 * Math.PI) / 180);

// --- Scene description (renderer-neutral) ---------------------------------
interface Plane {
  readonly id: string;
  readonly position: Vec3;
  readonly yaw: number;
  readonly resolution: { width: number; height: number };
}
const pose = (p: Plane): SpatialWebSurfacePose => ({
  position: p.position,
  rotation: [0, p.yaw, 0],
  width: p.resolution.width * MPP,
  height: p.resolution.height * MPP,
});
const geometry = (p: Plane): SurfaceGeometry => ({
  resolution: p.resolution,
  metersPerPixel: MPP,
  pose: {
    position: p.position,
    rotation: quaternionFromEuler([0, p.yaw, 0]),
    scale: 1,
  },
});

const A: Plane = {
  id: "A",
  position: [-0.3, 1.4, -1.6],
  yaw: 0,
  resolution: RES,
};
const B: Plane = {
  id: "B",
  position: [0.3, 1.4, -0.9],
  yaw: 0,
  resolution: RES,
};
/** A crossing B: its left half is in front of B, its right half behind. */
const A_CROSS: Plane = {
  id: "A",
  position: [0, 1.4, -1.2],
  yaw: 0.8,
  resolution: RES,
};
const B_FLAT: Plane = {
  id: "B",
  position: [0, 1.4, -1.2],
  yaw: 0,
  resolution: RES,
};
/** An Adaptive panel between A (far) and B (near), over A only. */
const PANEL: Plane = {
  id: "panel",
  position: [-0.62, 1.25, -1.2],
  yaw: 0,
  resolution: { width: 120, height: 80 },
};
/** A Native element of A, placed in front of B. */
const NATIVE: Plane = {
  id: "A/native",
  position: [0.42, 1.2, -0.6],
  yaw: 0,
  resolution: { width: 120, height: 80 },
};

/** The P1-08A contract's owner of a client point (`null`: the canvas / nobody). */
function expectedOwner(planes: readonly Plane[], x: number, y: number) {
  const ray = viewportRay(FRAME, x, y)!;
  const hits: InputHit[] = planes.flatMap((p) => {
    const hit = intersectSurface(geometry(p), ray);
    return hit?.inside && hit.front
      ? [
          {
            owner: {
              kind: "surface" as const,
              surface: { surfaceId: p.id, epoch: 1 },
            },
            distance: hit.distance,
            interactive: true,
          },
        ]
      : [];
  });
  const owner = resolveOwner(hits);
  return owner?.kind === "surface" ? owner.surface.surfaceId : "canvas";
}

/** Searches the screen for a probe point whose contract owner is `want`. */
function probe(
  planes: readonly Plane[],
  want: string,
  inside: readonly Plane[],
  outside: readonly Plane[] = [],
  /** Same owner at least this far (px) in every direction. */
  ownerMargin = 30,
): { x: number; y: number } {
  const covers = (p: Plane, x: number, y: number) => {
    const hit = intersectSurface(geometry(p), viewportRay(FRAME, x, y)!);
    return !!hit?.inside && hit.front;
  };
  // Deterministic scan, centre-out; keep 12 px away from every edge.
  const margin = (x: number, y: number) =>
    [...planes].every((p) =>
      [-12, 12].every(
        (d) =>
          covers(p, x, y) === covers(p, x + d, y) &&
          covers(p, x, y) === covers(p, x, y + d),
      ),
    );
  // Full 6 px grid, nearest to the screen center first.
  const points: [number, number][] = [];
  for (let y = 24; y <= H - 24; y += 6)
    for (let x = 24; x <= W - 24; x += 6) points.push([x, y]);
  points.sort(
    (p, q) =>
      Math.hypot(p[0] - W / 2, p[1] - H / 2) -
        Math.hypot(q[0] - W / 2, q[1] - H / 2) ||
      p[1] - q[1] ||
      p[0] - q[0],
  );
  for (const [x, y] of points)
    if (
      inside.every((p) => covers(p, x, y)) &&
      outside.every((p) => !covers(p, x, y)) &&
      expectedOwner(planes, x, y) === want &&
      // Away from any change of owner (e.g. an intersection line).
      [-ownerMargin, ownerMargin].every(
        (d) =>
          expectedOwner(planes, x + d, y) === want &&
          expectedOwner(planes, x, y + d) === want,
      ) &&
      margin(x, y)
    )
      return { x, y };
  throw new Error(`no probe point for ${want}`);
}

// --- Page construction -----------------------------------------------------
const COLORS = {
  A: [220, 60, 60],
  B: [60, 90, 220],
  panel: [40, 180, 80],
  "A/native": [240, 200, 40],
  canvas: [200, 200, 200],
} as const;

interface Layout {
  /** Layer order in the DOM, first = bottom. */
  readonly order: readonly Plane[];
  /** z-index per layer (coordinator depth order); omitted = DOM order. */
  readonly zIndex?: Readonly<Record<string, number>>;
  /** One preserve-3d context with depth-encoded matrices, instead of layers. */
  readonly preserve3d?: boolean;
  readonly adaptive?: boolean;
  /** Clip hole in A for the Adaptive panel. */
  readonly holeA?: boolean;
  readonly native?: boolean;
  /** Clip hole in B for A's native element. */
  readonly holeB?: boolean;
}

function matrixOf(p: Plane, depthEncoded: boolean): string {
  const t = surfaceTransform(FRAME, pose(p), p.resolution);
  if (t.visibility !== "visible") throw new Error(`${p.id} not visible`);
  if (!depthEncoded) return t.matrix3d;
  // Spike variant: replace the CSS z row with -K × clip z, so that after the
  // browser's division by w, CSS z = -K × NDC depth (nearer = larger z) and
  // a preserve-3d context can sort and split the planes by real depth.
  const m = t.matrix3d.slice(9, -1).split(",").map(Number);
  const vp = FRAME.viewProjection;
  const geo = geometry(p);
  const at = (u: number, v: number): Vec3 => cssToWorld(geo, u, v);
  const o = at(0, 0);
  const du = at(1, 0).map((c, i) => c - o[i]!) as unknown as Vec3;
  const dv = at(0, 1).map((c, i) => c - o[i]!) as unknown as Vec3;
  const zrow = (v: Vec3, w: 0 | 1) =>
    vp[2]! * v[0] + vp[6]! * v[1] + vp[10]! * v[2] + vp[14]! * w;
  const K = 1000;
  m[2] = -K * zrow(du, 0);
  m[6] = -K * zrow(dv, 0);
  m[14] = -K * zrow(o, 1);
  return `matrix3d(${m.join(",")})`;
}

async function build(page: Page, layout: Layout) {
  const planes = layout.order;
  const pages = planes.map((p) => ({
    id: p.id,
    matrix: matrixOf(p, !!layout.preserve3d),
    z: layout.zIndex?.[p.id] ?? null,
    clip:
      p.id === "A" && layout.holeA
        ? occlusionClipPath(FRAME, pose(p), p.resolution, [
            transformedQuad(PANEL.position, [0, 0, 0, 1], 0.3, 0.2),
          ])
        : p.id === "B" && layout.holeB
          ? occlusionClipPath(FRAME, pose(p), p.resolution, [
              transformedQuad(NATIVE.position, [0, 0, 0, 1], 0.3, 0.2),
            ])
          : "none",
  }));
  const native = layout.native
    ? nativePanelTransform(
        FRAME,
        {
          pose: pose(planes.find((p) => p.id === "A")!),
          resolution: RES,
          border: 0,
        },
        { pose: pose(NATIVE), resolution: NATIVE.resolution },
      )
    : null;
  if (native && native.visibility !== "visible")
    throw new Error("native unmappable");
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;overflow:hidden"></body></html>`,
  );
  await page.evaluate(
    ({ pages, native, colors, frame, adaptive, res, preserve3d, panel }) => {
      const w = window as unknown as { __clicks: string[]; __down: string[] };
      w.__clicks = [];
      w.__down = [];
      const rgb = (c: readonly number[]) => `rgb(${c.join(",")})`;
      // The renderer's canvas: background and (optionally) the Adaptive panel.
      const canvas = document.createElement("canvas");
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      canvas.dataset.owner = "canvas";
      canvas.style.cssText = "position:fixed;left:0;top:0;z-index:0";
      document.body.append(canvas);
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
      const [r, g, b] = colors.canvas;
      gl.clearColor(r / 255, g / 255, b / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (adaptive) {
        const shader = (type: number, src: string) => {
          const s = gl.createShader(type)!;
          gl.shaderSource(s, src);
          gl.compileShader(s);
          return s;
        };
        const prog = gl.createProgram()!;
        gl.attachShader(
          prog,
          shader(
            gl.VERTEX_SHADER,
            `#version 300 es
          in vec3 p; uniform mat4 vp; void main(){ gl_Position = vp * vec4(p,1.0); }`,
          ),
        );
        gl.attachShader(
          prog,
          shader(
            gl.FRAGMENT_SHADER,
            `#version 300 es
          precision highp float; uniform vec3 c; out vec4 o; void main(){ o = vec4(c,1.0); }`,
          ),
        );
        gl.linkProgram(prog);
        gl.useProgram(prog);
        const [cx, cy, cz] = panel.position;
        const hw = 0.15,
          hh = 0.1;
        const quad = new Float32Array([
          cx - hw,
          cy - hh,
          cz,
          cx + hw,
          cy - hh,
          cz,
          cx + hw,
          cy + hh,
          cz,
          cx - hw,
          cy - hh,
          cz,
          cx + hw,
          cy + hh,
          cz,
          cx - hw,
          cy + hh,
          cz,
        ]);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "p");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(
          gl.getUniformLocation(prog, "vp"),
          false,
          new Float32Array(frame.viewProjection),
        );
        const pc = colors.panel;
        gl.uniform3f(
          gl.getUniformLocation(prog, "c"),
          pc[0] / 255,
          pc[1] / 255,
          pc[2] / 255,
        );
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      canvas.addEventListener("click", () => w.__clicks.push("canvas"));
      canvas.addEventListener("pointerdown", () => w.__down.push("canvas"));
      // One shared preserve-3d context, or one clipping layer per surface.
      const context3d = preserve3d ? document.createElement("div") : null;
      if (context3d) {
        context3d.style.cssText =
          "position:fixed;left:0;top:0;width:100%;height:100%;z-index:5;pointer-events:none;transform-style:preserve-3d";
        document.body.append(context3d);
      }
      for (const p of pages) {
        const pageEl = document.createElement("div");
        pageEl.dataset.owner = p.id;
        pageEl.style.cssText = `position:absolute;left:0;top:0;width:${res.width}px;height:${res.height}px;transform-origin:0 0;pointer-events:auto;background:${rgb(colors[p.id as "A" | "B"])};transform:${p.matrix};clip-path:${p.clip}`;
        pageEl.innerHTML = `<button data-owner="${p.id}" aria-label="${p.id} action" style="position:absolute;left:150px;top:120px;width:100px;height:60px;border:0;padding:0;background:${rgb(colors[p.id as "A" | "B"])}"></button>`;
        pageEl.addEventListener("click", () => w.__clicks.push(p.id));
        pageEl.addEventListener("pointerdown", () => w.__down.push(p.id));
        if (p.id === "A" && native) {
          // A natively extracted element of A: still A's DOM descendant.
          const el = document.createElement("div");
          el.dataset.owner = "A/native";
          el.style.cssText = `position:fixed;left:0;top:0;width:120px;height:80px;transform-origin:0 0;background:${rgb(colors["A/native"])};transform:${native.matrix3d}`;
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            w.__clicks.push("A/native");
          });
          pageEl.append(el);
        }
        if (context3d) context3d.append(pageEl);
        else {
          const layer = document.createElement("div");
          layer.dataset.layer = p.id;
          layer.style.cssText = `position:fixed;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:${p.z ?? 5}`;
          layer.append(pageEl);
          document.body.append(layer);
        }
      }
    },
    {
      pages,
      native:
        native && native.visibility === "visible"
          ? { matrix3d: native.matrix3d }
          : null,
      colors: COLORS,
      frame: { viewProjection: Array.from(FRAME.viewProjection) },
      adaptive: !!layout.adaptive,
      res: RES,
      preserve3d: !!layout.preserve3d,
      panel: { position: PANEL.position },
    },
  );
}

/** Painted color class, DOM hit target and click receiver at a point. */
async function observe(page: Page, x: number, y: number) {
  const png = (await page.screenshot()).toString("base64");
  const hitTarget = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px!, py!) as HTMLElement | null;
      return el?.closest<HTMLElement>("[data-owner]")?.dataset.owner ?? null;
    },
    [x, y],
  );
  const painted = await page.evaluate(
    async ({ data, px, py, colors }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${data}`)).blob(),
      );
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
      let best = "?";
      let bestD = Infinity;
      for (const [name, rgb] of Object.entries(colors)) {
        const d = Math.hypot(r! - rgb[0]!, g! - rgb[1]!, b! - rgb[2]!);
        if (d < bestD) [best, bestD] = [name, d];
      }
      return bestD < 40 ? best : `unknown(${r},${g},${b})`;
    },
    { data: png, px: x, py: y, colors: COLORS },
  );
  await page.evaluate(() => {
    (window as unknown as { __clicks: string[] }).__clicks.length = 0;
  });
  await page.mouse.click(x, y);
  const clicked = await page.evaluate(
    () => (window as unknown as { __clicks: string[] }).__clicks[0] ?? null,
  );
  return { painted, hitTarget, clicked };
}

const records: Record<string, unknown>[] = [];
const shots = new Set<string>();
const EVIDENCE = process.env.P1_08A_EVIDENCE
  ? "../../docs/evidence/p1-08a"
  : null;
async function check(
  page: Page,
  scenario: string,
  probeName: string,
  point: { x: number; y: number },
  expected: string,
) {
  // One screenshot per scenario (before the probe click), evidence runs only.
  if (EVIDENCE && !shots.has(scenario)) {
    shots.add(scenario);
    const name = `${scenario.split(" ")[0]!.toLowerCase()}${scenario.includes("hole in") ? "-hole" : ""}`;
    await mkdir(EVIDENCE, { recursive: true });
    await page.screenshot({
      path: `${EVIDENCE}/${name}-${test.info().project.name}.png`,
    });
  }
  const seen = await observe(page, point.x, point.y);
  const record = {
    scenario,
    probe: probeName,
    point,
    contractOwner: expected,
    ...seen,
    // Hit-testing follows painting: what is seen is what is clicked.
    // The canvas paints its background or the Adaptive panel.
    paintedEqualsHit:
      (seen.painted === "panel" ? "canvas" : seen.painted) === seen.hitTarget,
    hitEqualsClick: seen.hitTarget === seen.clicked,
    agreesWithContract: seen.hitTarget === expected,
  };
  records.push(record);
  return record;
}

test("P1-08A spike: two transformed Surfaces, a WebGL panel and a cross-Surface Native element", async ({
  page,
  browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  records.length = 0;
  shots.clear();
  const both = [A, B];
  const P = probe(both, "B", [A, B]); // overlap: B is nearer

  // S1: layers in depth order (far first) — browser and contract agree.
  await build(page, { order: [A, B] });
  const s1 = await check(page, "S1 depth-sorted DOM order", "overlap", P, "B");
  expect(s1.agreesWithContract).toBe(true);

  // S2: reversed DOM order, no z-index — CSS does not depth-test planes:
  // the later layer wins, although it is farther.
  await build(page, { order: [B, A] });
  const s2 = await check(page, "S2 reversed DOM order", "overlap", P, "B");
  expect(s2.hitTarget).toBe("A");
  expect(s2.agreesWithContract).toBe(false);

  // S3: coordinator z-index by depth (painter's order) restores agreement.
  await build(page, { order: [B, A], zIndex: { A: 5, B: 6 } });
  const s3 = await check(
    page,
    "S3 coordinator z-index by depth",
    "overlap",
    P,
    "B",
  );
  expect(s3.agreesWithContract).toBe(true);

  // S4: interpenetrating planes — one painter's order cannot be right on
  // both sides of the intersection line.
  const crossing = [A_CROSS, B_FLAT];
  const PL = probe(crossing, "A", crossing);
  const PR = probe(crossing, "B", crossing);
  await build(page, { order: [B_FLAT, A_CROSS], zIndex: { B: 5, A: 6 } });
  const s4l = await check(
    page,
    "S4 interpenetrating, z-index",
    "A in front",
    PL,
    "A",
  );
  const s4r = await check(
    page,
    "S4 interpenetrating, z-index",
    "B in front",
    PR,
    "B",
  );
  expect(
    [s4l.agreesWithContract, s4r.agreesWithContract].filter(Boolean),
  ).toHaveLength(1);
  // S4b: the same planes in one preserve-3d context with depth-encoded
  // matrices (recorded; browser-dependent).
  await build(page, { order: [B_FLAT, A_CROSS], preserve3d: true });
  await check(
    page,
    "S4b interpenetrating, preserve-3d depth",
    "A in front",
    PL,
    "A",
  );
  await check(
    page,
    "S4b interpenetrating, preserve-3d depth",
    "B in front",
    PR,
    "B",
  );

  // S5: an Adaptive (WebGL) panel between A (far) and B (near). DOM layers
  // always paint over the canvas, so without a hole A hides the nearer
  // panel and takes its clicks.
  const withPanel = [A, B, PANEL];
  const Q = probe(withPanel, "panel", [A, PANEL], [B], 8);
  await build(page, { order: [A, B], zIndex: { A: 5, B: 6 }, adaptive: true });
  const s5 = await check(
    page,
    "S5 Adaptive panel, no hole",
    "panel over A",
    Q,
    "canvas",
  );
  expect(s5.hitTarget).toBe("A");
  await build(page, {
    order: [A, B],
    zIndex: { A: 5, B: 6 },
    adaptive: true,
    holeA: true,
  });
  const s5h = await check(
    page,
    "S5 Adaptive panel, hole in A",
    "panel over A",
    Q,
    "canvas",
  );
  expect(s5h.hitTarget).toBe("canvas");
  expect(s5h.painted).toBe("panel");

  // S6: a Native element of A placed in front of B. It is A's descendant,
  // so it paints inside A's layer: under B when B is ordered above A.
  const withNative = [A, B, NATIVE];
  const N = probe(withNative, "A/native", [B, NATIVE], [], 8);
  await build(page, { order: [A, B], zIndex: { A: 5, B: 6 }, native: true });
  const s6 = await check(
    page,
    "S6 Native of A in front of B, z-index",
    "native over B",
    N,
    "A/native",
  );
  expect(s6.hitTarget).toBe("B");
  // Cross-surface occluder: B gets a hole for A's native element.
  await build(page, {
    order: [A, B],
    zIndex: { A: 5, B: 6 },
    native: true,
    holeB: true,
  });
  const s6h = await check(
    page,
    "S6 Native of A in front of B, hole in B",
    "native over B",
    N,
    "A/native",
  );
  expect(s6h.hitTarget).toBe("A/native");
  expect(s6h.painted).toBe("A/native");

  // S7: removing Surface B mid-gesture: its DOM and listeners go, A stays
  // valid, and the browser routes the released pointer to nobody in B.
  await build(page, { order: [A, B], zIndex: { A: 5, B: 6 } });
  await page.mouse.move(P.x, P.y);
  await page.mouse.down();
  await page.evaluate(() =>
    document.querySelector('[data-layer="B"]')!.remove(),
  );
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    bElements: document.querySelectorAll('[data-owner="B"]').length,
    clicks: (window as unknown as { __clicks: string[] }).__clicks,
    down: (window as unknown as { __down: string[] }).__down,
  }));
  expect(after.bElements).toBe(0);
  expect(after.down).toEqual(["B"]);
  // No click reaches A for a gesture that B started (pointerdown/up targets differ).
  expect(after.clicks).toEqual([]);
  const s7 = await check(
    page,
    "S7 after removing B",
    "overlap",
    P,
    expectedOwner([A], P.x, P.y),
  );
  expect(s7.hitTarget).toBe("A");

  // Every asserted observation: hit-testing follows painting, and clicks
  // follow hits. S4b (preserve-3d) is recorded only: browser-dependent.
  for (const r of records.filter(
    (r) => !String(r.scenario).startsWith("S4b"),
  )) {
    expect(r.paintedEqualsHit, JSON.stringify(r)).toBe(true);
    expect(r.hitEqualsClick, JSON.stringify(r)).toBe(true);
  }
  expect(errors).toEqual([]);

  const evidence = {
    browser: browserName,
    browserVersion: page.context().browser()?.version(),
    viewport: { width: W, height: H },
    camera: { eye: FRAME.eye, target: [0, 1.4, -1], fovYDeg: 50 },
    planes: { A, B, A_CROSS, B_FLAT, PANEL, NATIVE },
    records,
  };
  const out = EVIDENCE ?? testInfo.outputPath();
  await mkdir(out, { recursive: true });
  await writeFile(
    `${out}/spike-${browserName}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await testInfo.attach("spike", {
    body: JSON.stringify(evidence, null, 2),
    contentType: "application/json",
  });
});
