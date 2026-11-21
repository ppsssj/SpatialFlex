import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * P1-08A2 unified depth compositing feasibility (research, NOT a feature).
 *
 * Page: research-depth.html (src/research/unified-depth). Two independently
 * mounted React roots (Surfaces A and B), A's extracted Native element and a
 * WebGL Adaptive panel, rendered by one of four tracks:
 *   hic      raw WebGL2 + native HTML-in-Canvas (Chromium 157+)
 *   dom      depth-aware DOM composition (every browser)
 *   three    Three.js r187 stock HTMLTexture / isolated ExternalTexture adapter
 *   babylon  Babylon.js 9.36 HtmlTexture + HtmlInteractionManager
 *
 * For every probe point we record four independent observations and
 * compare them: the geometric depth owner (P1-08A contract), the painted
 * pixels (screenshot), `document.elementFromPoint`, and the real target of
 * a real mouse press (pointerdown and click). Nothing is simulated: inputs
 * are Playwright mouse/keyboard actions; targets are read from capture
 * listeners on window.
 *
 * Capability: the HTML-in-Canvas track runs where the API is detected and
 * must then pass; where it is absent (Firefox 159) the test asserts and
 * records UNSUPPORTED instead of skipping silently.
 *
 * Evidence: docs/evidence/p1-08a2 when P1_08A2_EVIDENCE=1 (denser grid).
 */

const EVIDENCE = process.env.P1_08A2_EVIDENCE === "1";
// Several probe runs per test (each ~10-20 s in software WebGL).
test.describe.configure({ timeout: EVIDENCE ? 600_000 : 180_000 });
// CI: a coarse grid and only the discriminating scenarios (the crossing,
// a Native element crossing a page, an Adaptive panel crossing a page).
// Evidence runs (and P1_08A2_FULL=1) probe every scenario on a 40 px grid.
const FULL = EVIDENCE || process.env.P1_08A2_FULL === "1";
const STEP = EVIDENCE ? 40 : 100;
const SCENARIOS = FULL
  ? ["S1", "S2", "S4", "S5-front", "S5-behind", "S5-cross", "S6"]
  : ["S5-cross", "S6"];
const SAFE_RADIUS = 6;

interface Lab {
  track: string | null;
  unsupported: Record<string, unknown> | null;
  canvasId: string | null;
  capability(): Record<string, unknown>;
  expected(x: number, y: number): { owner: string; target: string };
  safe(x: number, y: number, r: number): boolean;
  clearLog(): void;
  log: {
    dispatch: { type: string; target: string; trusted: boolean; t: number }[];
    handler: { surface: string; epoch: number; control: string; t: number }[];
    lifecycle: { surface: string; epoch: number; kind: string }[];
  };
  stats(): Record<string, unknown> & {
    uploads: number;
    clipWrites: number;
    texturesLive: number;
    texturesDeleted: number;
    textureBytes: number;
    errors: string[];
  };
  inspect(): unknown;
  surfaces(): { id: string; epoch: number; parent: string | null }[];
  isCurrent(ref: { surfaceId: string; epoch: number }, itemId: string): boolean;
  removeSurface(id: string): boolean;
  addSurface(id: string): { surfaceId: string; epoch: number };
  adoptStaged(): (string | null)[];
}
declare global {
  interface Window {
    __lab: Lab;
  }
}

async function open(page: Page, query: string) {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(`/research-depth.html?${query}`);
  await page.waitForFunction(
    () => document.documentElement.dataset.ready === "1",
  );
  await page.evaluate(() => {
    window.__lab = (window as unknown as { __depthLab: Lab }).__depthLab;
  });
  // Let the first paints and uploads land.
  await frames(page, 30);
}

const frames = (page: Page, n: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () =>
          --left <= 0 ? resolve() : requestAnimationFrame(step);
        requestAnimationFrame(step);
      }),
    n,
  );

// --- Painted pixels --------------------------------------------------------
const COLOR_OWNER: [number, number, number, string][] = [
  [220, 60, 60, "A"],
  [160, 0, 0, "A"],
  [255, 138, 138, "A"],
  [255, 210, 210, "A"],
  [240, 200, 40, "A/native"],
  [60, 90, 220, "B"],
  [0, 0, 160, "B"],
  [138, 138, 255, "B"],
  [210, 220, 255, "B"],
  [40, 180, 80, "canvas"], // Adaptive panel: renderer-owned
  [200, 200, 200, "canvas"], // background
];

/** Painted owner at each point: majority class of a 5×5 patch. */
async function paintedOwners(page: Page, points: { x: number; y: number }[]) {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ({ data, points, colors }) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${data}`)).blob(),
      );
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return points.map(({ x, y }) => {
        const votes = new Map<string, number>();
        const px = ctx.getImageData(x - 2, y - 2, 5, 5).data;
        for (let i = 0; i < px.length; i += 4) {
          let best = "?";
          let bestD = 28;
          for (const [r, g, b, owner] of colors) {
            const d = Math.hypot(px[i]! - r, px[i + 1]! - g, px[i + 2]! - b);
            if (d < bestD) [best, bestD] = [owner, d];
          }
          votes.set(best, (votes.get(best) ?? 0) + 1);
        }
        votes.delete("?");
        return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
      });
    },
    { data: png, points, colors: COLOR_OWNER },
  );
}

// --- Probing ---------------------------------------------------------------
interface Probe {
  x: number;
  y: number;
  expectedOwner: string;
  expectedTarget: string;
  painted: string;
  efp: string;
  down: string;
  click: string;
}

function ownerOfTarget(
  target: string,
  canvasId: string,
  nativeExtracted: boolean,
) {
  if (target === canvasId) return "canvas";
  if (target.startsWith("A-native")) return nativeExtracted ? "A/native" : "A";
  if (target === "surface-A" || target.startsWith("A-")) return "A";
  if (target === "surface-B" || target.startsWith("B-")) return "B";
  return target;
}

async function probeAll(page: Page, step = STEP): Promise<Probe[]> {
  const grid: { x: number; y: number }[] = [];
  for (let y = step / 2; y < 700; y += step)
    for (let x = step / 2; x < 1000; x += step)
      grid.push({ x: Math.round(x), y: Math.round(y) });
  const plan = await page.evaluate(
    ({ grid, r }) =>
      grid
        .filter(({ x, y }) => window.__lab.safe(x, y, r))
        .map(({ x, y }) => ({ x, y, ...window.__lab.expected(x, y) })),
    { grid, r: SAFE_RADIUS },
  );
  const painted = await paintedOwners(page, plan);
  const out: Probe[] = [];
  for (const [i, p] of plan.entries()) {
    await page.mouse.move(p.x, p.y);
    await frames(page, 2);
    const efp = await page.evaluate(
      ([x, y]) => {
        let el = document.elementFromPoint(x!, y!);
        while (el && !el.id) el = el.parentElement;
        return el?.id ?? "(none)";
      },
      [p.x, p.y],
    );
    await page.evaluate(() => window.__lab.clearLog());
    await page.mouse.down();
    await page.mouse.up();
    const d = await page.evaluate(() => window.__lab.log.dispatch);
    out.push({
      x: p.x,
      y: p.y,
      expectedOwner:
        p.owner === "panel" || p.owner === "none" ? "canvas" : p.owner,
      expectedTarget: p.target,
      painted: painted[i]!,
      efp,
      down: d.find((e) => e.type === "pointerdown")?.target ?? "(none)",
      click: d.find((e) => e.type === "click")?.target ?? "(none)",
    });
  }
  return out;
}

interface RunSummary {
  query: string;
  track: string | null;
  probes: number;
  /** geometric depth owner ≠ painted owner */
  depthVsVisual: number;
  /** painted owner ≠ owner of the element that received the press */
  visualVsClick: number;
  /** expected target ≠ pointerdown target or ≠ click target */
  clickMismatch: number;
  /** elementFromPoint ≠ pointerdown target */
  efpVsDown: number;
  mismatches: Probe[];
  stats: unknown;
}

async function run(
  page: Page,
  query: string,
  step?: number,
): Promise<RunSummary> {
  await open(page, query);
  const canvasId = (await page.evaluate(() => window.__lab.canvasId))!;
  const nativeExtracted = /scenario=S5/.test(query);
  const probes = (await probeAll(page, step)).map((p) =>
    // A's Native card still in its page slot is part of A's page.
    !nativeExtracted && p.painted === "A/native" ? { ...p, painted: "A" } : p,
  );
  const own = (t: string) => ownerOfTarget(t, canvasId, nativeExtracted);
  const bad = probes.filter(
    (p) =>
      p.painted !== p.expectedOwner ||
      own(p.down) !== p.painted ||
      p.down !== p.expectedTarget ||
      p.click !== p.expectedTarget ||
      p.efp !== p.down,
  );
  return {
    query,
    track: await page.evaluate(() => window.__lab.track),
    probes: probes.length,
    depthVsVisual: probes.filter((p) => p.painted !== p.expectedOwner).length,
    visualVsClick: probes.filter((p) => own(p.down) !== p.painted).length,
    clickMismatch: probes.filter(
      (p) => p.down !== p.expectedTarget || p.click !== p.expectedTarget,
    ).length,
    efpVsDown: probes.filter((p) => p.efp !== p.down).length,
    mismatches: bad,
    stats: await page.evaluate(() => window.__lab.stats()),
  };
}

// --- Evidence --------------------------------------------------------------
const records: Record<string, unknown>[] = [];
// Relative to apps/xr-lab (Playwright runs there), as the P1-08A spike.
const OUT = "../../docs/evidence/p1-08a2";

async function shot(page: Page, info: TestInfo, name: string) {
  const file = `${name}-${info.project.name}.png`;
  if (EVIDENCE) {
    await mkdir(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${file}` });
  } else await page.screenshot({ path: info.outputPath(file) });
}

function record(info: TestInfo, entry: Record<string, unknown>) {
  records.push({ browser: info.project.name, ...entry });
}

test.afterAll(async ({ browserName }, info) => {
  const body = JSON.stringify(
    {
      milestone: "P1-08A2",
      browser: browserName,
      evidenceMode: EVIDENCE,
      grid: STEP,
      records,
    },
    null,
    2,
  );
  if (EVIDENCE) {
    await mkdir(OUT, { recursive: true });
    await writeFile(`${OUT}/results-${browserName}.json`, body + "\n");
  } else await writeFile(info.outputPath(`results-${browserName}.json`), body);
});

const hasHtmlInCanvas = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement("canvas");
    c.setAttribute("content", "drawable");
    const gl = c.getContext("webgl2") as
      (WebGL2RenderingContext & { texElementSubImage2D?: unknown }) | null;
    return (
      (c as { content?: string }).content === "drawable" &&
      typeof (c as { updateElementGeometry?: unknown })
        .updateElementGeometry === "function" &&
      typeof gl?.texElementSubImage2D === "function"
    );
  });

// ===========================================================================
test.describe("P1-08A2 capability", () => {
  test("HTML-in-Canvas feature detection in the installed browser", async ({
    page,
    browserName,
    browser,
  }, info) => {
    await open(page, "track=hic&scenario=S3");
    const lab = await page.evaluate(() => ({
      track: window.__lab.track,
      unsupported: window.__lab.unsupported,
      capability: window.__lab.capability(),
    }));
    record(info, {
      test: "capability",
      browserVersion: browser.version(),
      ...lab,
    });
    if (browserName === "chromium") {
      // Chromium 157+ stable API, and not the pre-157 name r187 tests for.
      expect(lab.track).toBe("html-in-canvas");
      expect(lab.capability).toMatchObject({
        supported: true,
        contentAttributeReflects: true,
        texElementSubImage2D: true,
        texElementImage2D: false,
        updateElementGeometry: true,
      });
    } else {
      // UNSUPPORTED is a recorded result, not a skip.
      expect(lab.track).toBeNull();
      expect(lab.unsupported).toMatchObject({
        supported: false,
        contentAttributeReflects: false,
        requestPaint: false,
        texElementSubImage2D: false,
        updateElementGeometry: false,
      });
    }
  });
});

// ===========================================================================
test.describe("P1-08A2 Track A — native HTML-in-Canvas (raw WebGL2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/research-depth.html?track=dom&scenario=S1");
    test.skip(
      !(await hasHtmlInCanvas(page)),
      "UNSUPPORTED: no HTML-in-Canvas in this browser (asserted in the capability test)",
    );
  });

  test("S3 crossing: browser hit order is not depth order (default)", async ({
    page,
  }, info) => {
    const r = await run(page, "track=hic&scenario=S3&hit=order");
    record(info, { test: "A/S3/order", ...r });
    await shot(page, info, "s3-hic-order");
    // Pixels are depth-correct (shared WebGL depth buffer) ...
    expect(r.depthVsVisual, JSON.stringify(r.mismatches)).toBe(0);
    // ... but hit-testing follows the drawables' order, not depth: the
    // Surface registered last takes clicks where the other is in front.
    // If this ever reaches 0, Chromium changed behavior: re-evaluate.
    expect(r.visualVsClick).toBeGreaterThan(0);
    expect(
      r.mismatches.every(
        (p) => p.down.endsWith("B") || p.down.startsWith("B-"),
      ),
    ).toBe(true);
  });

  test("S3 crossing: geometric hit clips make visible = depth = click owner", async ({
    page,
  }, info) => {
    const r = await run(page, "track=hic&scenario=S3&hit=clip");
    record(info, { test: "A/S3/clip", ...r });
    await shot(page, info, "s3-hic-clip");
    expect(r.mismatches, JSON.stringify(r.mismatches.slice(0, 5))).toEqual([]);
  });

  for (const scenario of SCENARIOS) {
    test(`${scenario} with geometric hit clips`, async ({ page }, info) => {
      const r = await run(page, `track=hic&scenario=${scenario}&hit=clip`);
      record(info, { test: `A/${scenario}/clip`, ...r });
      await shot(page, info, `${scenario.toLowerCase()}-hic-clip`);
      expect(r.mismatches, JSON.stringify(r.mismatches.slice(0, 5))).toEqual(
        [],
      );
    });
  }

  test("canvasClip (rectangle) is honored but cannot express a split region", async ({
    page,
  }, info) => {
    await open(page, "track=hic&scenario=S3&hit=rect&rectspace=zero");
    // An empty canvasClip removes both Surfaces from hit-testing.
    const pts = await page.evaluate(() =>
      [
        [350, 250],
        [650, 300],
      ].filter(([x, y]) => window.__lab.expected(x!, y!).owner !== "none"),
    );
    const got: string[] = [];
    for (const [x, y] of pts) {
      await page.evaluate(() => window.__lab.clearLog());
      await page.mouse.click(x!, y!);
      got.push(
        (await page.evaluate(
          () =>
            window.__lab.log.dispatch.find((d) => d.type === "pointerdown")
              ?.target,
        )) ?? "",
      );
    }
    expect(got.every((t) => t === "stage")).toBe(true);
    const element = await run(page, "track=hic&scenario=S3&hit=rect");
    const canvas = await run(
      page,
      "track=hic&scenario=S3&hit=rect&rectspace=canvas",
    );
    record(info, {
      test: "A/S3/canvasClip",
      zeroClipTargets: got,
      elementSpace: element,
      canvasSpace: canvas,
    });
    // Neither reading of the (rect-only) clip reproduced the split region.
    expect(element.clickMismatch + canvas.clickMismatch).toBeGreaterThan(0);
  });

  test("real keyboard, focus, typing and text selection reach drawable DOM", async ({
    page,
  }, info) => {
    await open(page, "track=hic&scenario=S3&hit=clip");
    const at = (target: string) =>
      page.evaluate((t) => {
        for (let y = 20; y < 700; y += 6)
          for (let x = 20; x < 1000; x += 6)
            if (
              window.__lab.expected(x, y).target === t &&
              window.__lab.safe(x, y, 12)
            )
              return { x, y };
        return null;
      }, target);
    const a = (await at("A-input"))!;
    const b = (await at("B-input"))!;
    await page.mouse.click(a.x, a.y);
    await page.keyboard.type("alpha beta");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.type("gamma");
    const values = await page.evaluate(() => ({
      a: (document.getElementById("A-input") as HTMLInputElement).value,
      b: (document.getElementById("B-input") as HTMLInputElement).value,
      focused: document.activeElement?.id,
    }));
    expect(values).toEqual({ a: "alpha beta", b: "gamma", focused: "B-input" });
    // Double-click selects a word inside the input (native selection).
    await page.mouse.dblclick(a.x, a.y);
    const selection = await page.evaluate(() => {
      const i = document.getElementById("A-input") as HTMLInputElement;
      return {
        focused: document.activeElement?.id,
        length: (i.selectionEnd ?? 0) - (i.selectionStart ?? 0),
      };
    });
    expect(selection.focused).toBe("A-input");
    expect(selection.length).toBeGreaterThan(0);
    const keydowns = await page.evaluate(() =>
      window.__lab.log.dispatch
        .filter((d) => d.type === "keydown")
        .map((d) => d.target),
    );
    expect(new Set(keydowns)).toEqual(new Set(["A-input", "B-input"]));
    record(info, { test: "A/keyboard", values, selection });
  });

  test("A5: React roots mounted in the drawable canvas vs moved in after mount", async ({
    page,
  }, info) => {
    // Case 1: mounted directly as drawable children.
    await open(page, "track=hic&scenario=S3&hit=clip");
    const direct = await page.evaluate(() => window.__lab.surfaces());
    expect(direct.every((s) => s.parent === "stage")).toBe(true);
    // Case 2: an ordinary, already-mounted page with state, then moved in.
    await open(page, "track=hic&scenario=S3&hit=clip&mount=moved");
    const btn = page.locator("#A-left");
    await btn.click();
    await btn.click();
    await page.locator("#A-input").click();
    await page.keyboard.type("before");
    await page.evaluate(() => {
      (window as unknown as { __node: Element }).__node =
        document.getElementById("A-left")!;
    });
    const parents = await page.evaluate(() => window.__lab.adoptStaged());
    await frames(page, 30);
    const after = await page.evaluate(() => ({
      same:
        (window as unknown as { __node: Element }).__node ===
        document.getElementById("A-left"),
      label: document.getElementById("A-left")!.textContent,
      input: (document.getElementById("A-input") as HTMLInputElement).value,
      mounts: window.__lab.log.lifecycle.filter((l) => l.kind === "mount")
        .length,
      unmounts: window.__lab.log.lifecycle.filter((l) => l.kind === "unmount")
        .length,
    }));
    expect(parents).toEqual(["stage", "stage"]);
    expect(after).toEqual({
      same: true,
      label: "L 2",
      input: "before",
      mounts: 2,
      unmounts: 0,
    });
    // The moved page is now rendered and hit-tested in 3D: its existing
    // listeners receive a real press at its 3D location.
    await page.evaluate(() => window.__lab.clearLog());
    const p = (await page.evaluate(() => {
      for (let y = 20; y < 700; y += 6)
        for (let x = 20; x < 1000; x += 6)
          if (
            window.__lab.expected(x, y).target === "A-left" &&
            window.__lab.safe(x, y, 12)
          )
            return { x, y };
      return null;
    }))!;
    await page.mouse.click(p.x, p.y);
    const handlers = await page.evaluate(() =>
      window.__lab.log.handler.map((h) => h.control),
    );
    expect(handlers).toEqual(["A-left"]);
    record(info, {
      test: "A5",
      direct,
      moved: after,
      movedThenClicked: handlers,
    });
  });
});

// ===========================================================================
test.describe("P1-08A2 Track B — depth-aware DOM composition", () => {
  test("S3 crossing: baseline layer order (ADR 0002) misroutes one side", async ({
    page,
  }, info) => {
    const r = await run(page, "track=dom&scenario=S3&compose=order");
    record(info, { test: "B/S3/order", ...r });
    await shot(page, info, "s3-dom-order");
    expect(r.depthVsVisual).toBeGreaterThan(0);
    // In the baseline what is painted is also what is hit: consistent but wrong.
    expect(r.visualVsClick).toBe(0);
  });

  test("S3 crossing: split clips make visible = depth = click owner", async ({
    page,
  }, info) => {
    const r = await run(page, "track=dom&scenario=S3&compose=split");
    record(info, { test: "B/S3/split", ...r });
    await shot(page, info, "s3-dom-split");
    expect(r.mismatches, JSON.stringify(r.mismatches.slice(0, 5))).toEqual([]);
  });

  for (const scenario of SCENARIOS) {
    test(`${scenario}: baseline vs split`, async ({ page }, info) => {
      const order = await run(
        page,
        `track=dom&scenario=${scenario}&compose=order`,
      );
      await shot(page, info, `${scenario.toLowerCase()}-dom-order`);
      const split = await run(
        page,
        `track=dom&scenario=${scenario}&compose=split`,
      );
      await shot(page, info, `${scenario.toLowerCase()}-dom-split`);
      record(info, { test: `B/${scenario}`, order, split });
      expect(
        split.mismatches,
        JSON.stringify(split.mismatches.slice(0, 5)),
      ).toEqual([]);
    });
  }

  test("real keyboard, focus, typing and text selection on split layers", async ({
    page,
    browserName,
  }, info) => {
    const selections: Record<string, unknown> = {};
    // The baseline (order) is the control: same transforms, no split clips.
    for (const compose of ["order", "split"]) {
      await open(page, `track=dom&scenario=S3&compose=${compose}`);
      const at = (target: string) =>
        page.evaluate((t) => {
          for (let y = 20; y < 700; y += 6)
            for (let x = 20; x < 1000; x += 6)
              if (
                window.__lab.expected(x, y).target === t &&
                window.__lab.safe(x, y, 12)
              )
                return { x, y };
          return null;
        }, target);
      const a = (await at("A-input"))!;
      const b = (await at("B-input"))!;
      await page.mouse.click(a.x, a.y);
      await page.keyboard.type("alpha beta");
      await page.mouse.click(b.x, b.y);
      await page.keyboard.type("gamma");
      const sel = () =>
        page.evaluate(() => {
          const i = document.getElementById("A-input") as HTMLInputElement;
          return {
            focused: document.activeElement?.id,
            length: (i.selectionEnd ?? 0) - (i.selectionStart ?? 0),
          };
        });
      await page.mouse.dblclick(a.x, a.y);
      const dblclick = await sel();
      // Mouse-drag selection inside the input.
      await page.mouse.move(a.x + 30, a.y);
      await page.mouse.down();
      await page.mouse.move(a.x - 40, a.y, { steps: 5 });
      await page.mouse.up();
      const drag = await sel();
      const values = await page.evaluate(() => ({
        a: (document.getElementById("A-input") as HTMLInputElement).value,
        b: (document.getElementById("B-input") as HTMLInputElement).value,
      }));
      selections[compose] = { values, dblclick, drag };
      expect(values).toEqual({ a: "alpha beta", b: "gamma" });
      expect(drag.focused).toBe("A-input");
      expect(drag.length).toBeGreaterThan(0);
      if (browserName === "chromium")
        expect(dblclick.length).toBeGreaterThan(0);
    }
    // Firefox 159: double-click word selection does not happen in a
    // perspective-transformed input, with or without split clips (control).
    if (browserName === "firefox")
      expect((selections.split as { dblclick: unknown }).dblclick).toEqual(
        (selections.order as { dblclick: unknown }).dblclick,
      );
    record(info, { test: "B/keyboard", selections });
  });
});

// ===========================================================================
test.describe("P1-08A2 Three.js r187 and Babylon.js 9.36", () => {
  test("Three.js r187 stock HTMLTexture does not upload with the stable API", async ({
    page,
    browserName,
  }, info) => {
    await open(page, "track=three&scenario=S3&three=stock");
    const inspect = (await page.evaluate(() => window.__lab.inspect())) as {
      canvasLayoutSubtree: string | null;
      canvasContent: string | null;
      hosts: { parentIsCanvas: boolean; drawable: boolean }[];
    };
    const cap = await page.evaluate(() => window.__lab.capability());
    // The page center of A is painted with whatever r187 uploaded.
    const [painted] = await paintedOwners(page, [{ x: 330, y: 420 }]);
    const pixel = await page.evaluate(() => {
      const c = document.getElementById("stage") as HTMLCanvasElement;
      const gl = c.getContext("webgl2")!;
      const px = new Uint8Array(4);
      gl.readPixels(330, 700 - 420, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [...px];
    });
    record(info, { test: "three/stock", cap, inspect, painted, pixel });
    await shot(page, info, "s3-three-stock");
    // r187 only uploads if 'texElementImage2D' in gl: never true here, so
    // the element is never adopted by the canvas and the planes are black.
    expect(cap.rendererHasTexElementImage2D).toBe(false);
    expect(inspect.canvasLayoutSubtree).toBeNull();
    expect(inspect.hosts.every((h) => !h.parentIsCanvas)).toBe(true);
    expect(pixel.slice(0, 3)).toEqual([0, 0, 0]);
    record(info, { test: "three/stock/browser", browserName });
  });

  test("Three.js r187 + isolated ExternalTexture adapter", async ({
    page,
  }, info) => {
    test.skip(
      !(await (async () => {
        await page.goto("/research-depth.html?track=dom");
        return hasHtmlInCanvas(page);
      })()),
      "UNSUPPORTED: no HTML-in-Canvas",
    );
    const order = await run(
      page,
      "track=three&scenario=S3&three=adapter&hit=order",
    );
    const clip = await run(
      page,
      "track=three&scenario=S3&three=adapter&hit=clip",
    );
    await shot(page, info, "s3-three-adapter-clip");
    record(info, { test: "three/adapter", order, clip });
    expect(order.depthVsVisual).toBe(0);
    expect(order.visualVsClick).toBeGreaterThan(0);
    expect(
      clip.mismatches,
      JSON.stringify(clip.mismatches.slice(0, 5)),
    ).toEqual([]);
  });

  test("Babylon.js 9.36 HtmlTexture + HtmlInteractionManager", async ({
    page,
    browserName,
  }, info) => {
    const r = await run(page, "track=babylon&scenario=S3");
    const inspect = await page.evaluate(() => window.__lab.inspect());
    record(info, { test: "babylon", inspect, ...r });
    await shot(page, info, "s3-babylon");
    if (browserName === "chromium") {
      // Native path: depth-correct pixels, screen-aligned affine hit quads
      // (no perspective) in DOM order: measured, documented mismatches.
      expect(r.depthVsVisual).toBe(0);
      expect(r.clickMismatch).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
test.describe("P1-08A2 React state and lifecycle", () => {
  const tracks = ["track=dom&compose=split", "track=hic&hit=clip"];
  for (const t of tracks) {
    test(`S7/S9 lifecycle (${t})`, async ({ page }, info) => {
      await page.goto("/research-depth.html?track=dom");
      test.skip(
        t.includes("hic") && !(await hasHtmlInCanvas(page)),
        "UNSUPPORTED: no HTML-in-Canvas",
      );
      await open(page, `${t}&scenario=S7`);
      const at = (target: string) =>
        page.evaluate((tg) => {
          for (let y = 20; y < 700; y += 6)
            for (let x = 20; x < 1000; x += 6)
              if (
                window.__lab.expected(x, y).target === tg &&
                window.__lab.safe(x, y, 12)
              )
                return { x, y };
          return null;
        }, target);
      // S7: independent state per root, no remounts while interacting.
      const aLeft = (await at("A-left"))!;
      const bRight = (await at("B-right"))!;
      await page.evaluate(() => {
        (window as unknown as { __n: Element[] }).__n = [
          document.getElementById("A-left")!,
          document.getElementById("B-right")!,
        ];
      });
      for (let i = 0; i < 3; i++) await page.mouse.click(aLeft.x, aLeft.y);
      for (let i = 0; i < 2; i++) await page.mouse.click(bRight.x, bRight.y);
      await frames(page, 10);
      const s7 = await page.evaluate(() => ({
        a: document.getElementById("A-left")!.textContent,
        b: document.getElementById("B-right")!.textContent,
        same: (window as unknown as { __n: Element[] }).__n.every(
          (n) => n.isConnected,
        ),
        mounts: window.__lab.log.lifecycle.filter((l) => l.kind === "mount")
          .length,
        unmounts: window.__lab.log.lifecycle.filter((l) => l.kind === "unmount")
          .length,
        handlers: window.__lab.log.handler.map(
          (h) => `${h.surface}${h.epoch}:${h.control}`,
        ),
      }));
      expect(s7.a).toBe("L 3");
      expect(s7.b).toBe("R 2");
      expect(s7.same).toBe(true);
      expect([s7.mounts, s7.unmounts]).toEqual([2, 0]);

      // S9: remove A during a pointer gesture, re-add it (new epoch).
      const old = (await page.evaluate(() =>
        window.__lab.surfaces().find((s) => s.id === "A"),
      ))!;
      await page.evaluate(() => window.__lab.clearLog());
      await page.mouse.move(aLeft.x, aLeft.y);
      await page.mouse.down();
      const removed = await page.evaluate(() =>
        window.__lab.removeSurface("A"),
      );
      const fresh = await page.evaluate(() => window.__lab.addSurface("A"));
      await frames(page, 30);
      await page.mouse.up();
      await frames(page, 2);
      const s9 = await page.evaluate(
        ({ old, fresh }) => ({
          handlers: window.__lab.log.handler.map(
            (h) => `${h.surface}${h.epoch}:${h.control}`,
          ),
          clicks: window.__lab.log.dispatch
            .filter((d) => d.type === "click")
            .map((d) => d.target),
          oldCurrent: window.__lab.isCurrent(
            { surfaceId: "A", epoch: old.epoch },
            "A-left",
          ),
          freshCurrent: window.__lab.isCurrent(fresh, "A-left"),
          lifecycle: window.__lab.log.lifecycle.map(
            (l) => `${l.surface}${l.epoch}:${l.kind}`,
          ),
          freshLabel: document.getElementById("A-left")?.textContent,
          stats: window.__lab.stats(),
        }),
        { old, fresh },
      );
      expect(removed).toBe(true);
      expect(fresh.epoch).toBeGreaterThan(old.epoch);
      // No action of the press reached anyone: not the removed incarnation,
      // not the new one, not B.
      expect(s9.handlers).toEqual([]);
      expect(s9.oldCurrent).toBe(false);
      expect(s9.freshCurrent).toBe(true);
      expect(s9.freshLabel).toBe("L 0");
      expect(s9.lifecycle).toEqual(
        expect.arrayContaining([
          `A${old.epoch}:unmount`,
          `A${fresh.epoch}:mount`,
        ]),
      );
      if (t.includes("hic")) {
        // The removed Surface's texture was deleted; a new one allocated.
        expect(s9.stats.texturesDeleted).toBeGreaterThanOrEqual(1);
        expect(s9.stats.texturesLive).toBe(2);
      }
      // A new press reaches only the new incarnation.
      await page.evaluate(() => window.__lab.clearLog());
      await page.mouse.click(aLeft.x, aLeft.y);
      const after = await page.evaluate(() =>
        window.__lab.log.handler.map(
          (h) => `${h.surface}${h.epoch}:${h.control}`,
        ),
      );
      expect(after).toEqual([`A${fresh.epoch}:A-left`]);
      record(info, {
        test: `S7-S9 ${t}`,
        s7,
        s9: { ...s9, stats: undefined },
        after,
      });
    });
  }

  test("S8 rapid updates while moving (10 Hz content, animated poses)", async ({
    page,
    browserName,
  }, info) => {
    const queries = ["track=dom&compose=split"];
    if (browserName === "chromium") queries.push("track=hic&hit=clip");
    const results: Record<string, unknown>[] = [];
    for (const q of queries) {
      await open(page, `${q}&scenario=S8&tick=1&animate=1`);
      const before = await page.evaluate(() => ({
        tick: Number(document.getElementById("A-value")!.dataset.tick),
        uploads: window.__lab.stats().uploads,
      }));
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => ({
        tick: Number(document.getElementById("A-value")!.dataset.tick),
        uploads: window.__lab.stats().uploads,
        clipWrites: window.__lab.stats().clipWrites,
      }));
      // Input during motion: a press at A-left's current geometric location.
      let delivered = 0;
      const attempts = 8;
      for (let i = 0; i < attempts; i++) {
        const p = await page.evaluate(() => {
          for (let y = 20; y < 700; y += 8)
            for (let x = 20; x < 1000; x += 8)
              if (
                window.__lab.expected(x, y).target === "A-left" &&
                window.__lab.safe(x, y, 20)
              )
                return { x, y };
          return null;
        });
        if (!p) continue;
        await page.evaluate(() => window.__lab.clearLog());
        await page.mouse.click(p.x, p.y);
        const h = await page.evaluate(() =>
          window.__lab.log.handler.map((x) => x.control),
        );
        if (h.length === 1 && h[0] === "A-left") delivered++;
      }
      const ticks = after.tick - before.tick;
      const uploads = after.uploads - before.uploads;
      results.push({
        query: q,
        ticks,
        uploads,
        clipWrites: after.clipWrites,
        delivered,
        attempts,
      });
      expect(ticks).toBeGreaterThanOrEqual(8);
      if (q.includes("hic")) expect(uploads).toBeGreaterThanOrEqual(ticks);
      expect(delivered).toBeGreaterThanOrEqual(attempts - 1);
    }
    record(info, { test: "S8", results });
  });
});
