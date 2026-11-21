import { expect, test, type Page } from "@playwright/test";

/**
 * P1-08B3 Multi-Surface XR fixture (`multi-surface-xr.html`): independent
 * React Surfaces placed in ONE Three.js scene (one camera, one render
 * loop), composited as live DOM through `WorkspaceScene` (FrameAuthority →
 * one depth snapshot → page clips + InputRouter).
 *
 * Real mouse and keyboard input only. `__multiSurfaceXR` and
 * `__xrHostProbe` are read-only probes (state, and projecting a world
 * point through the Three.js camera); they never act.
 */

interface SurfaceInfo {
  id: string;
  epoch: number;
  position: number[];
  rotation: number[];
  presentations: number;
}
interface Inspect {
  status: string;
  hosts: number;
  pages: number;
  captures: number;
  surfaces: {
    key: string;
    visibility: string;
    clipPath: string | null;
    hiddenBy: string[];
    interactive: boolean;
  }[];
  counters: Record<string, number>;
}

const lab = <T>(page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(
    ([method, args]) =>
      (
        window as unknown as {
          __multiSurfaceXR: Record<string, (...a: unknown[]) => unknown>;
        }
      ).__multiSurfaceXR[method as string]!(...(args as unknown[])),
    [method, args] as const,
  ) as Promise<T>;

const surfaces = (page: Page) => lab<SurfaceInfo[]>(page, "surfaces");
const inspect = (page: Page) => lab<Inspect>(page, "inspect");
const status = (page: Page) => page.getByTestId("scene-status");

/** Client point of page CSS (u, v) of a Surface, via the Three.js camera. */
async function point(page: Page, id: string, u: number, v: number) {
  const p = await lab<{ x: number; y: number } | null>(page, "point", id, u, v);
  expect(p, `${id}(${u},${v}) on screen`).not.toBeNull();
  return p!;
}

/** Waits for n more rendered frames (the composition follows the camera). */
const frames = (page: Page, n = 3) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const step = () =>
          --left <= 0 ? resolve() : requestAnimationFrame(step);
        requestAnimationFrame(step);
      }),
    n,
  );

async function open(page: Page, query = "") {
  await page.goto(`/multi-surface-xr.html${query}`);
  await page.waitForFunction(
    () =>
      "__multiSurfaceXR" in window &&
      document.querySelectorAll(".msx-page[data-depth='resolved']").length >= 2,
  );
}

/** Painted owner at client points: majority colour of a 5×5 patch. */
const COLORS: [number, number, number, string][] = [
  [255, 210, 210, "A"],
  [210, 220, 255, "B"],
  [221, 227, 234, "canvas"], // scene background #dde3ea
];
async function painted(page: Page, points: { x: number; y: number }[]) {
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
        const px = ctx.getImageData(
          Math.round(x) - 2,
          Math.round(y) - 2,
          5,
          5,
        ).data;
        for (let i = 0; i < px.length; i += 4) {
          let best = "?";
          let bestD = 24;
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
    { data: png, points, colors: COLORS },
  );
}

/** The browser's own hit test at a client point (page id or canvas). */
const hitTest = (page: Page, p: { x: number; y: number }) =>
  page.evaluate(
    ({ x, y }) =>
      (
        document
          .elementFromPoint(x, y)
          ?.closest(".msx-page") as HTMLElement | null
      )?.dataset.surface ??
      (document.elementFromPoint(x, y)?.tagName === "CANVAS" ? "canvas" : "?"),
    p,
  );

const hits = async (page: Page) => ({
  A: Number((await page.getByTestId("A-hits").textContent())!.split(" ")[1]),
  B: Number((await page.getByTestId("B-hits").textContent())!.split(" ")[1]),
});

/** Visible owner, browser hit owner and the owner a real click reaches. */
async function owners(page: Page, p: { x: number; y: number }) {
  const [visible] = await painted(page, [p]);
  const hit = await hitTest(page, p);
  const before = await hits(page);
  await page.mouse.click(p.x, p.y);
  const after = await hits(page);
  const clicked = after.A > before.A ? "A" : after.B > before.B ? "B" : "none";
  return { visible, hit, clicked };
}

async function layout(page: Page, id: "side" | "cross" | "ambiguous") {
  await page.getByTestId(`layout-${id}`).check();
  await frames(page, 4);
}

test("two independent Surfaces share one scene and one camera", async ({
  page,
}, info) => {
  await open(page);
  await expect(status(page)).toHaveAttribute("data-value", "resolved");
  const s = await surfaces(page);
  expect(s.map((x) => x.id)).toEqual(["A", "B"]);
  expect(s[0]!.epoch).not.toBe(s[1]!.epoch);
  // One renderer (lease) drives both pages; one canvas in the document.
  await expect(page.getByTestId("authority")).toHaveText(/renderer: three#\d+/);
  await expect(page.locator("canvas")).toHaveCount(1);
  const i = await inspect(page);
  expect(i.hosts).toBe(2);
  expect(i.pages).toBe(2);
  expect(i.surfaces.map((x) => x.visibility)).toEqual(["visible", "visible"]);
  expect(i.surfaces.map((x) => x.clipPath)).toEqual(["none", "none"]);
  // Live DOM: real elements in the document, transformed — not textures.
  await expect(page.locator(".msx-page[data-surface='A']")).toHaveCSS(
    "transform",
    /^matrix3d/,
  );
  await page.screenshot({ path: info.outputPath("side.png") });
});

test("Scenario 1: state, input and Adaptive actions stay within their Surface", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("A-counter").click();
  await page.getByTestId("A-counter").click();
  await page.getByTestId("B-counter").click();
  await page.getByTestId("A-input").click();
  await page.keyboard.type("alpha");
  await page.getByTestId("B-input").click();
  await page.keyboard.type("beta");
  await expect(page.getByTestId("A-counter")).toHaveText("A count 2");
  await expect(page.getByTestId("B-counter")).toHaveText("B count 1");
  await expect(page.getByTestId("A-input")).toHaveValue("alpha");
  await expect(page.getByTestId("B-input")).toHaveValue("beta");

  // Adaptive panels: WebGL, same item id and the same per-runtime instance id.
  await page.getByTestId("A-present").click();
  await page.getByTestId("B-present").click();
  await expect(page.getByTestId("A-presentations")).toHaveText(
    "adaptive:adaptive-1",
  );
  await expect(page.getByTestId("B-presentations")).toHaveText(
    "adaptive:adaptive-1",
  );
  const [a, b] = await surfaces(page);
  const panelA = `A@${a!.epoch}/chart/adaptive-1`;
  await frames(page, 4);
  const target = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __xrHostProbe: {
            locate(id: string, part: string): { x: number; y: number } | null;
          };
        }
      ).__xrHostProbe.locate(id, "button:increment"),
    panelA,
  );
  expect(target).not.toBeNull();
  // The panel is in front of A's page: the canvas (not the page) gets it.
  expect(await hitTest(page, target!)).toBe("canvas");
  await page.mouse.click(target!.x, target!.y);
  await expect(page.getByTestId("A-counter")).toHaveText("A count 3");
  await expect(page.getByTestId("B-counter")).toHaveText("B count 1");
  await expect(page.getByTestId("log").locator("li").last()).toHaveText(
    `action ${panelA} increment → accepted`,
  );
  expect(b!.epoch).not.toBe(a!.epoch);
});

test("Scenario 2: moving and rotating A leaves B's state, DOM identity and pose alone", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("B-counter").click();
  await page.getByTestId("B-input").click();
  await page.keyboard.type("kept");
  await page.evaluate(() => {
    (window as unknown as { __b: Element }).__b = document.querySelector(
      "[data-testid='B-counter']",
    )!;
  });
  const before = await surfaces(page);
  const bTransform = await page
    .locator(".msx-page[data-surface='B']")
    .evaluate((e) => (e as HTMLElement).style.transform);
  const aTransform = await page
    .locator(".msx-page[data-surface='A']")
    .evaluate((e) => (e as HTMLElement).style.transform);
  await page.getByTestId("A-move").click();
  await page.getByTestId("A-rotate").click();
  await frames(page, 4);
  const after = await surfaces(page);
  expect(after[0]!.epoch).toBe(before[0]!.epoch); // moved, not re-registered
  expect(after[0]!.position[0]).toBeCloseTo(before[0]!.position[0]! + 0.1, 6);
  expect(after[0]!.rotation).not.toEqual(before[0]!.rotation);
  expect(after[1]).toEqual(before[1]);
  expect(
    await page
      .locator(".msx-page[data-surface='A']")
      .evaluate((e) => (e as HTMLElement).style.transform),
  ).not.toBe(aTransform);
  expect(
    await page
      .locator(".msx-page[data-surface='B']")
      .evaluate((e) => (e as HTMLElement).style.transform),
  ).toBe(bTransform);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __b: Element }).__b ===
        document.querySelector("[data-testid='B-counter']"),
    ),
  ).toBe(true);
  await expect(page.getByTestId("B-counter")).toHaveText("B count 1");
  await expect(page.getByTestId("B-input")).toHaveValue("kept");
  // A still works where it now is.
  await page.getByTestId("A-counter").click();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 1");
});

test("Scenario 3: X crossing — visible owner = hit owner = click owner on both sides", async ({
  page,
}, info) => {
  await open(page);
  await layout(page, "cross");
  const i = await inspect(page);
  expect(i.surfaces.map((s) => s.hiddenBy.map((k) => k.split("@")[0]))).toEqual(
    [["surface:B"], ["surface:A"]],
  );
  expect(i.surfaces.every((s) => s.clipPath?.startsWith("path("))).toBe(true);
  await page.screenshot({ path: info.outputPath("cross.png") });
  // Left of the crossing line A's page is nearer the camera, right of it
  // B's (A turns +0.6 rad about y, B -0.6 rad): plain plane geometry.
  for (const [id, u, v] of [
    ["A", 80, 190],
    ["A", 120, 230],
    ["B", 320, 110],
    ["B", 280, 70],
  ] as const) {
    const p = await point(page, id, u, v);
    expect(await owners(page, p), `${id}(${u},${v})`).toEqual({
      visible: id,
      hit: id,
      clicked: id,
    });
  }
});

test("Scenario 3: moving A changes the clip and the owner at the same screen point", async ({
  page,
}) => {
  await open(page);
  await layout(page, "cross");
  // A point right of the crossing line, on B's page, where B is in front.
  const p = await point(page, "B", 235, 110);
  expect(await owners(page, p)).toEqual({
    visible: "B",
    hit: "B",
    clicked: "B",
  });
  const clip = (await inspect(page)).surfaces[0]!.clipPath;
  for (let k = 0; k < 3; k++) await page.getByTestId("A-move").click();
  await frames(page, 4);
  expect((await inspect(page)).surfaces[0]!.clipPath).not.toBe(clip);
  // A moved 0.3 m along +x; its rotated plane came forward there.
  expect(await owners(page, p)).toEqual({
    visible: "A",
    hit: "A",
    clicked: "A",
  });
  expect((await inspect(page)).counters.mismatches).toBe(0);
});

test("a non-interactive Surface in front blocks input instead of passing it behind", async ({
  page,
}) => {
  await open(page);
  await layout(page, "cross");
  await page.getByTestId("B-interactive").uncheck();
  await frames(page, 2);
  const right = await point(page, "B", 320, 110);
  // Still visibly B, and the browser would deliver it to B...
  expect(await hitTest(page, right)).toBe("B");
  // ...but neither B (non-interactive) nor A behind it receives the click.
  const before = await hits(page);
  await page.mouse.click(right.x, right.y);
  expect(await hits(page)).toEqual(before);
  await expect(page.getByTestId("B-counter")).toHaveText("B count 0");
  // A is unaffected where it is in front.
  const left = await point(page, "A", 80, 190);
  expect((await owners(page, left)).clicked).toBe("A");
});

test("pointer move and release stay with the gesture owner", async ({
  page,
}) => {
  await open(page);
  const pad = await page.getByTestId("A-pad").boundingBox();
  const b = await point(page, "B", 200, 220);
  await page.mouse.move(pad!.x + pad!.width / 2, pad!.y + pad!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x - 40, b.y, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId("A-pad-log")).toHaveText("down,move,up");
  await expect(page.getByTestId("B-pad-log")).toHaveText("");
  expect((await hits(page)).B).toBe(0);
  expect((await inspect(page)).captures).toBe(0);
});

test("Scenario 4: removing A keeps B; re-adding A gets a new epoch; old gestures are refused", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("B-counter").click();
  await page.getByTestId("B-input").click();
  await page.keyboard.type("kept");
  await page.getByTestId("B-present").click();
  await page.evaluate(() => {
    (window as unknown as { __b: Element }).__b = document.querySelector(
      "[data-testid='B-counter']",
    )!;
  });
  const oldA = (await surfaces(page))[0]!.epoch;

  // Press on A's counter, remove and re-add A while the button is held.
  const counter = await page.getByTestId("A-counter").boundingBox();
  await page.mouse.move(counter!.x + 10, counter!.y + 8);
  await page.mouse.down();
  expect((await inspect(page)).captures).toBe(1);
  await page.keyboard.press("Alt+Shift+Digit1");
  await expect(page.getByTestId("live-surfaces")).toHaveText(/^live: B@\d+$/);
  expect((await inspect(page)).captures).toBe(0);
  await page.keyboard.press("Alt+Shift+Digit1");
  await expect(page.getByTestId("live-surfaces")).toHaveText(
    /^live: B@\d+, A@\d+$/,
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".msx-page[data-depth='resolved']").length ===
      2,
  );
  const fresh = await page.getByTestId("A-counter").boundingBox();
  await page.mouse.move(fresh!.x + 10, fresh!.y + 8);
  await page.mouse.up();
  // The old incarnation's gesture never reaches the new A.
  await expect(page.getByTestId("A-counter")).toHaveText("A count 0");
  const newA = (await surfaces(page)).find((s) => s.id === "A")!.epoch;
  expect(newA).toBeGreaterThan(oldA);
  // B: same node, same state, its presentation still live.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __b: Element }).__b ===
        document.querySelector("[data-testid='B-counter']"),
    ),
  ).toBe(true);
  await expect(page.getByTestId("B-counter")).toHaveText("B count 1");
  await expect(page.getByTestId("B-input")).toHaveValue("kept");
  await expect(page.getByTestId("B-presentations")).toHaveText(
    "adaptive:adaptive-1",
  );
  const i = await inspect(page);
  expect(i.hosts).toBe(2);
  expect(i.pages).toBe(2);
  expect(i.counters.cancelledGestures).toBeGreaterThanOrEqual(1);
  // The new A works normally.
  await page.getByTestId("A-counter").click();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 1");
});

test("a renderer restart revokes authority and cancels the gesture in progress", async ({
  page,
}) => {
  await open(page);
  const lease = await page.getByTestId("authority").textContent();
  const counter = await page.getByTestId("A-counter").boundingBox();
  await page.mouse.move(counter!.x + 10, counter!.y + 8);
  await page.mouse.down();
  await page.keyboard.press("Alt+Shift+Digit2");
  await expect(page.getByTestId("authority")).not.toHaveText(lease!);
  await expect(page.getByTestId("authority")).toHaveText(/renderer: three#\d+/);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".msx-page[data-depth='resolved']").length ===
      2,
  );
  await page.mouse.up();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 0");
  expect((await inspect(page)).captures).toBe(0);
  await page.getByTestId("A-counter").click();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 1");
});

test("Scenario 5: indeterminate depth fails closed and recovers", async ({
  page,
}, info) => {
  await open(page);
  await page.getByTestId("A-input").click();
  await page.keyboard.type("x");
  await layout(page, "ambiguous");
  await expect(status(page)).toHaveAttribute("data-value", "indeterminate");
  await expect(status(page)).toContainText(/coplanar/i);
  await page.screenshot({ path: info.outputPath("indeterminate.png") });
  // Display fallback: still placed and visible, marked, unclipped...
  await expect(
    page.locator(".msx-page[data-depth='indeterminate']"),
  ).toHaveCount(2);
  const i = await inspect(page);
  expect(i.surfaces.map((s) => [s.visibility, s.clipPath])).toEqual([
    ["visible", "none"],
    ["visible", "none"],
  ]);
  // ...but nothing in it takes input: no click, no focus, no keys.
  const before = await hits(page);
  for (const id of ["A", "B"] as const) {
    const box = await page.getByTestId(`${id}-counter`).boundingBox();
    if (box) await page.mouse.click(box.x + 8, box.y + 6);
  }
  expect(await hits(page)).toEqual(before);
  await page.keyboard.type("yz");
  await expect(page.getByTestId("A-input")).toHaveValue("x");
  await expect(page.getByTestId("A-counter")).toHaveText("A count 0");
  // A resolvable layout restores normal operation.
  await layout(page, "side");
  await expect(status(page)).toHaveAttribute("data-value", "resolved");
  await page.getByTestId("A-counter").click();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 1");
});

test("repeated remove/re-add leaves two Surfaces, two hosts and no gestures", async ({
  page,
}) => {
  await open(page);
  let last = 0;
  for (let k = 0; k < 10; k++) {
    await page.getByTestId("toggle-A").click();
    await expect(page.getByTestId("live-surfaces")).toHaveText(/^live: B@\d+$/);
    await page.getByTestId("toggle-A").click();
    await expect(page.getByTestId("live-surfaces")).toHaveText(
      /^live: B@\d+, A@\d+$/,
    );
    const epoch = (await surfaces(page)).find((s) => s.id === "A")!.epoch;
    expect(epoch).toBeGreaterThan(last);
    last = epoch;
  }
  await frames(page, 3);
  const i = await inspect(page);
  expect([i.hosts, i.pages, i.captures]).toEqual([2, 2, 0]);
  await expect(page.locator(".msx-page")).toHaveCount(2);
});

test("five Surfaces in one scene resolve and route", async ({ page }, info) => {
  await open(page, "?surfaces=5");
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".msx-page[data-depth='resolved']").length ===
      5,
  );
  const i = await inspect(page);
  expect(i.surfaces).toHaveLength(5);
  expect([i.hosts, i.pages]).toEqual([5, 5]);
  await page.screenshot({ path: info.outputPath("five.png") });
  await layout(page, "cross");
  expect((await owners(page, await point(page, "A", 80, 190))).clicked).toBe(
    "A",
  );
  expect((await owners(page, await point(page, "B", 320, 110))).clicked).toBe(
    "B",
  );
  expect((await inspect(page)).counters.mismatches).toBe(0);
});

test("IWER immersive session: WebGL keeps rendering, DOM pages are suspended without input", async ({
  page,
}) => {
  // Emulated WebXR runtime (IWER), not a headset: this shows the scene's
  // policy inside an immersive session, not what a real HMD displays.
  await open(page, "?xr-emulator=iwer");
  await expect(page.getByTestId("xr-availability")).toHaveAttribute(
    "data-value",
    "available",
    { timeout: 15_000 },
  );
  await page.getByTestId("A-present").click();
  await page.getByRole("button", { name: "Enter VR" }).click();
  await expect(page.getByTestId("xr-session")).toHaveAttribute(
    "data-value",
    "immersive-vr",
    { timeout: 15_000 },
  );
  await expect(status(page)).toHaveAttribute("data-value", "suspended");
  const frames0 = await page.evaluate(
    () =>
      (window as unknown as { __xrHostProbe: { frames: number } }).__xrHostProbe
        .frames,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __xrHostProbe: { frames: number } })
            .__xrHostProbe.frames,
      ),
    )
    .toBeGreaterThan(frames0 + 5);
  // The DOM pages are hidden (not presentable in the XR view) and inert.
  await expect(page.locator(".msx-page[data-depth='suspended']")).toHaveCount(
    2,
  );
  for (const id of ["A", "B"])
    await expect(page.locator(`.msx-page[data-surface='${id}']`)).toHaveCSS(
      "visibility",
      "hidden",
    );
  expect((await inspect(page)).surfaces.map((s) => s.visibility)).toEqual([
    "waiting",
    "waiting",
  ]);
  // The Adaptive panel is still a live WebGL presentation of A.
  await expect(page.getByTestId("A-presentations")).toHaveText(
    "adaptive:adaptive-1",
  );
  await page.getByRole("button", { name: "Exit VR" }).dispatchEvent("click");
  await expect(page.getByTestId("xr-session")).toHaveAttribute(
    "data-value",
    "none",
    {
      timeout: 15_000,
    },
  );
  await expect(status(page)).toHaveAttribute("data-value", "resolved");
  await page.getByTestId("A-counter").click();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 1");
});
