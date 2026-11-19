import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * P1-07B: an independent React application using SpatialFlex through its
 * package entry points. Real mouse and keyboard input only. Poses are read
 * from the app's read-only probe (`window.__spatialConsumer`, the
 * ItemManipulator) and placement is checked against the app's own Three.js
 * projection (`window.__spatialView`).
 */

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Point = { x: number; y: number };
type Pose = { position: Vec3; rotation: Quat; scale: number };
type Target = {
  itemId: string;
  presentationId: string;
  kind: "native" | "adaptive";
  transform: Pose;
  initial: Pose;
};
type W = Window & {
  __spatialConsumer?: {
    targets(): Target[];
    getSnapshot(): { active: unknown; selected: string | null };
  };
  __spatialView?: {
    frames: number;
    liveRenderers: number;
    liveTextures: number;
    project(p: Vec3): Point | null;
    locate(id: string, u: number, v: number): Point | null;
  };
  __marked?: Element[];
  __liveListeners?: (target: EventTarget, type: string) => number;
};

const EVIDENCE = process.env.CONSUMER_EVIDENCE ?? "../../docs/evidence/p1-07b2";
const COUNTER = "incident-counter";
const NOTES = "shift-notes";
const CHART = "throughput-chart";
const REGION = "region-status";

/** Live listeners per target and type, excluding Playwright's own. */
const countListeners = () => {
  const live = new WeakMap<EventTarget, Map<unknown, Set<string>>>();
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const keyOf = (type: string, o?: boolean | EventListenerOptions) =>
    `${type}:${typeof o === "boolean" ? o : !!o?.capture}`;
  proto.addEventListener = function (this: EventTarget, type, listener, o) {
    if (listener && !new Error().stack?.includes("InjectedScript")) {
      const by = live.get(this) ?? new Map<unknown, Set<string>>();
      live.set(this, by);
      const keys = by.get(listener) ?? new Set<string>();
      keys.add(keyOf(type, o));
      by.set(listener, keys);
    }
    return add.call(this, type, listener, o);
  } as typeof proto.addEventListener;
  proto.removeEventListener = function (this: EventTarget, type, listener, o) {
    if (listener) live.get(this)?.get(listener)?.delete(keyOf(type, o));
    return remove.call(this, type, listener, o);
  } as typeof proto.removeEventListener;
  (window as W).__liveListeners = (target, type) =>
    [...(live.get(target)?.values() ?? [])].filter((k) =>
      [...k].some((x) => x.startsWith(`${type}:`)),
    ).length;
};

async function open(page: Page) {
  await page.addInitScript(countListeners);
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as W).__spatialView?.frames ?? 0))
    .toBeGreaterThan(2);
}

const slot = (page: Page, id: string) =>
  page.locator(`[data-spatialflex-item="${id}"]`);
const panel = (page: Page, id: string) =>
  slot(page, id).locator("[data-spatialflex-panel]");
const handle = (page: Page, id: string, mode: string): Locator =>
  panel(page, id).locator(
    mode === "translate"
      ? '[data-spatialflex-handle="translate"][role=button]'
      : `[data-spatialflex-handle="${mode}"]`,
  );
const targets = (page: Page) =>
  page.evaluate(() => (window as W).__spatialConsumer!.targets());
const target = async (page: Page, id: string) =>
  (await targets(page)).find((t) => t.itemId === id);
const poseOf = async (page: Page, id: string) =>
  (await target(page, id))!.transform;
const active = (page: Page) =>
  page.evaluate(() => (window as W).__spatialConsumer!.getSnapshot().active);
const windowListeners = (page: Page, type: string) =>
  page.evaluate((t) => (window as W).__liveListeners!(window, t), type);
const panelListeners = (page: Page, id: string, type: string) =>
  page.evaluate(
    ([id, t]) =>
      (window as W).__liveListeners!(
        document.querySelector(
          `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
        )!,
        t!,
      ),
    [id, type],
  );
const yaw = ([x, y, z, w]: Quat) =>
  Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((v, i) => v - b[i]!));
const centerOf = async (locator: Locator): Promise<Point> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

async function drag(page: Page, from: Point, to: Point, hold = false) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  if (!hold) await page.mouse.up();
}

async function select(page: Page, id: string) {
  await page.getByTestId(`select-${id}`).check();
}
async function extract(page: Page, id: string, as: "native" | "adaptive") {
  await select(page, id);
  await page.getByTestId(`extract-${as}`).click();
  await expect.poll(async () => (await target(page, id))?.kind).toBe(as);
  if (as === "native")
    await expect(panel(page, id)).toHaveAttribute("data-spatial-placed", "");
}
async function restore(page: Page, id: string) {
  await select(page, id);
  await page.getByTestId("restore").click();
  await expect.poll(() => target(page, id)).toBeUndefined();
}

/** Screen points of fixed world points: they move only with the camera. */
const cameraMark = (page: Page) =>
  page.evaluate(() =>
    (
      [
        [1, 2, -1.2],
        [-1, 1, -2],
      ] as Vec3[]
    ).map((p) => (window as W).__spatialView!.project(p)!),
  );
const cameraShift = async (page: Page, start: Point[]) => {
  const now = await cameraMark(page);
  return Math.max(
    ...now.map((p, i) => distance([p.x, p.y], [start[i]!.x, start[i]!.y])),
  );
};

/** The element's bounding box matches where its world pose projects. */
async function expectPlaced(page: Page, id: string) {
  await expect
    .poll(async () => {
      const error = await page.evaluate((id) => {
        const el = document.querySelector<HTMLElement>(
          `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
        )!;
        if (!el.dataset.spatialPose) return Infinity;
        const pose = JSON.parse(el.dataset.spatialPose) as {
          position: Vec3;
          rotation: Vec3;
          width: number;
          height: number;
        };
        const [rx, ry, rz] = pose.rotation;
        const cx = Math.cos(rx),
          sx = Math.sin(rx),
          cy = Math.cos(ry),
          sy = Math.sin(ry),
          cz = Math.cos(rz),
          sz = Math.sin(rz);
        const R = [
          [cy * cz, -cy * sz, sy],
          [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
          [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
        ];
        const pts = [
          [-0.5, 0.5],
          [0.5, 0.5],
          [0.5, -0.5],
          [-0.5, -0.5],
        ].map(([u, v]) =>
          (window as W).__spatialView!.project(
            [0, 1, 2].map(
              (i) =>
                pose.position[i]! +
                R[i]![0]! * u! * pose.width +
                R[i]![1]! * v! * pose.height,
            ) as Vec3,
          )!,
        );
        const r = el.getBoundingClientRect();
        const xs = pts.map((p) => p.x),
          ys = pts.map((p) => p.y);
        return Math.max(
          Math.abs(r.left - Math.min(...xs)),
          Math.abs(r.top - Math.min(...ys)),
          Math.abs(r.right - Math.max(...xs)),
          Math.abs(r.bottom - Math.max(...ys)),
        );
      }, id);
      return error;
    })
    .toBeLessThan(2);
}

/** What the browser hit-tests at the projected center of a native panel. */
const hitAtCenter = (page: Page, id: string) =>
  page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(
      `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
    )!;
    const pose = JSON.parse(el.dataset.spatialPose ?? "null") as {
      position: Vec3;
    } | null;
    if (!pose) return "unplaced";
    const p = (window as W).__spatialView!.project(pose.position)!;
    const hit = document.elementFromPoint(p.x, p.y);
    return hit && el.contains(hit) ? "native" : (hit?.tagName ?? "none");
  }, id);

/**
 * Compositor-owned residue on an element after restore (the SDK's own
 * `data-spatialflex-*` attributes are React-rendered, not residue).
 */
const residue = (page: Page, id: string) =>
  panel(page, id).evaluate((el: HTMLElement) =>
    [
      el.style.transform && "transform",
      el.style.clipPath && "clip-path",
      ...Object.keys(el.dataset).filter((k) =>
        /^(spatial(?!flex)|manipulat)/.test(k),
      ),
    ].filter(Boolean),
  );

const diagnostics = async (page: Page) => ({
  subscriptions: await page.getByTestId("active-subscriptions").textContent(),
  subscribes: await page
    .getByTestId("active-subscriptions")
    .getAttribute("data-total-subscribes"),
  mounts: await page.getByTestId("mounts").textContent(),
});

const mark = (page: Page, id: string) =>
  page.evaluate((id) => {
    (window as W).__marked = [
      ...document.querySelectorAll(
        `[data-spatialflex-item="${id}"] article, [data-spatialflex-item="${id}"] article :is(button, input, textarea)`,
      ),
    ];
  }, id);
const sameNodes = (page: Page, id: string) =>
  page.evaluate((id) => {
    const now = [
      ...document.querySelectorAll(
        `[data-spatialflex-item="${id}"] article, [data-spatialflex-item="${id}"] article :is(button, input, textarea)`,
      ),
    ];
    const marked = (window as W).__marked!;
    return (
      marked.length > 0 &&
      marked.length === now.length &&
      marked.every((el, i) => el === now[i])
    );
  }, id);

const watchConsole = (page: Page) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (!["error", "warning"].includes(m.type())) return;
    if (
      /GL Driver Message|WEBGL_debug_renderer_info|MouseEvent\.moz/.test(
        m.text(),
      )
    )
      return;
    problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
};

const evidence: Record<string, unknown> = {};

test("E1 Native DOM extraction keeps the original node, state, Context and handlers", async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);
  await open(page);
  const card = slot(page, COUNTER).locator("article");
  await page.getByTestId("acknowledge").click();
  await expect(page.getByTestId("acknowledge")).toHaveText(/Acknowledged: 1/);
  await mark(page, COUNTER);
  const before = await diagnostics(page);
  const width = await card.evaluate((el: HTMLElement) => el.offsetWidth);

  await select(page, COUNTER);
  await expect(page.getByTestId("compatibility")).toHaveAttribute(
    "data-supported",
    "true",
  );
  await extract(page, COUNTER, "native");
  const start = (await target(page, COUNTER))!;
  expect(start.presentationId).toMatch(/^native-\d+$/);
  await expectPlaced(page, COUNTER);
  expect(await hitAtCenter(page, COUNTER)).toBe("native");
  // Same nodes, one instance, local state, Context, CSS width.
  expect(await sameNodes(page, COUNTER)).toBe(true);
  await expect(page.getByTestId("incidents")).toHaveCount(1);
  await expect(panel(page, COUNTER).getByTestId("acknowledge")).toHaveText(
    /Acknowledged: 1/,
  );
  await expect(panel(page, COUNTER).getByTestId("region")).toHaveText(
    "Region: eu-west (Dublin)",
  );
  expect(await card.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(width);
  // Real clicks in space: each handler runs exactly once.
  const actions = Number(await page.getByTestId("action-calls").textContent());
  await panel(page, COUNTER).getByTestId("report-incident").click();
  await expect(page.getByTestId("incidents")).toHaveText("4");
  await expect(page.getByTestId("action-calls")).toHaveText(
    String(actions + 1),
  );
  await panel(page, COUNTER).getByTestId("acknowledge").click();
  await expect(panel(page, COUNTER).getByTestId("acknowledge")).toHaveText(
    /Acknowledged: 2/,
  );
  // No second React root or subscription: same mounts and subscriptions.
  expect(await diagnostics(page)).toEqual(before);
  await page.screenshot({
    path: `${EVIDENCE}/e1-native-${testInfo.project.name}.png`,
  });

  await restore(page, COUNTER);
  expect(await residue(page, COUNTER)).toEqual([]);
  expect(await sameNodes(page, COUNTER)).toBe(true);
  await expect(page.getByTestId("acknowledge")).toHaveText(/Acknowledged: 2/);
  expect(await card.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(width);
  expect(await diagnostics(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("E2 move, yaw and uniform scale; camera untouched; Escape cancels", async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);
  await open(page);
  await extract(page, COUNTER, "native");
  const start = await poseOf(page, COUNTER);
  const camera = await cameraMark(page);
  const width = await panel(page, COUNTER).evaluate(
    (el: HTMLElement) => el.offsetWidth,
  );

  // Translate: the projected center follows the pointer.
  const grab = await centerOf(handle(page, COUNTER, "translate"));
  const to = { x: grab.x + 120, y: grab.y + 60 };
  const p0 = (await page.evaluate(
    (p) => (window as W).__spatialView!.project(p),
    start.position,
  ))!;
  await drag(page, grab, to);
  const moved = await poseOf(page, COUNTER);
  const p1 = (await page.evaluate(
    (p) => (window as W).__spatialView!.project(p),
    moved.position,
  ))!;
  expect(Math.abs(p1.x - p0.x - 120)).toBeLessThan(8);
  expect(Math.abs(p1.y - p0.y - 60)).toBeLessThan(8);
  expect(moved.rotation).toEqual(start.rotation);
  expect(await cameraShift(page, camera)).toBeLessThan(0.5);
  await expectPlaced(page, COUNTER);

  // Yaw.
  const rot = await centerOf(handle(page, COUNTER, "rotate"));
  await drag(page, rot, { x: rot.x + 50, y: rot.y });
  const rotated = await poseOf(page, COUNTER);
  expect(Math.abs(yaw(rotated.rotation))).toBeGreaterThan(0.1);
  expect(rotated.position).toEqual(moved.position);
  await expectPlaced(page, COUNTER);

  // Uniform scale: world size only, the CSS size is unchanged.
  const corner = await centerOf(handle(page, COUNTER, "resize"));
  await drag(page, corner, { x: corner.x + 40, y: corner.y + 30 });
  const scaled = await poseOf(page, COUNTER);
  expect(scaled.scale).toBeGreaterThan(1.1);
  expect(
    await panel(page, COUNTER).evaluate((el: HTMLElement) => el.offsetWidth),
  ).toBe(width);
  await expectPlaced(page, COUNTER);
  expect(await cameraShift(page, camera)).toBeLessThan(0.5);

  // Escape mid-drag: back to the pose before the drag; release moves nothing.
  const again = await centerOf(handle(page, COUNTER, "translate"));
  await drag(page, again, { x: again.x - 90, y: again.y }, true);
  expect(await active(page)).not.toBeNull();
  await page.keyboard.press("Escape");
  await page.mouse.move(again.x - 140, again.y, { steps: 3 });
  await page.mouse.up();
  expect(await poseOf(page, COUNTER)).toEqual(scaled);
  expect(await cameraShift(page, camera)).toBeLessThan(0.5);

  // Keyboard: Escape reverts steps, Enter commits them.
  await handle(page, COUNTER, "rotate").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Escape");
  expect(await poseOf(page, COUNTER)).toEqual(scaled);
  await handle(page, COUNTER, "translate").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  expect(
    distance((await poseOf(page, COUNTER)).position, scaled.position),
  ).toBeCloseTo(0.02, 6);
  const committed = await poseOf(page, COUNTER);

  // Orbiting the camera on empty space keeps the committed world pose.
  const view = (await page.getByTestId("spatial-canvas").boundingBox())!;
  await drag(
    page,
    { x: view.x + view.width - 40, y: view.y + view.height - 40 },
    { x: view.x + view.width - 120, y: view.y + view.height - 60 },
  );
  await expect.poll(() => cameraShift(page, camera)).toBeGreaterThan(5);
  expect(await poseOf(page, COUNTER)).toEqual(committed);
  await expectPlaced(page, COUNTER);
  await page.screenshot({
    path: `${EVIDENCE}/e2-manipulated-${testInfo.project.name}.png`,
  });

  // Re-extraction: a new presentation instance at its start pose.
  const first = (await target(page, COUNTER))!.presentationId;
  await restore(page, COUNTER);
  await extract(page, COUNTER, "native");
  const second = (await target(page, COUNTER))!;
  expect(second.presentationId).not.toBe(first);
  expect(second.transform).toEqual(second.initial);
  expect(errors).toEqual([]);
  evidence[`e2-${testInfo.project.name}`] = {
    start,
    moved,
    rotated,
    scaled,
    committed,
  };
});

test("E3 MUI controls and a Recharts chart keep working in space", async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);
  await open(page);
  const before = await diagnostics(page);
  await mark(page, NOTES);
  await extract(page, NOTES, "native");
  await expectPlaced(page, NOTES);
  const notes = panel(page, NOTES);
  // MUI TextField (controlled).
  await notes.getByTestId("summary").click();
  await page.keyboard.press("End");
  await page.keyboard.type(", pager tested");
  await expect(notes.getByTestId("summary-echo")).toHaveText(
    "Night shift: all quiet, pager tested",
  );
  // Typing never manipulates the panel.
  expect(await active(page)).toBeNull();
  // Native uncontrolled textarea.
  await notes.getByTestId("handover").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" now");
  await expect(notes.getByTestId("handover")).toHaveValue(
    "Handover: check queue depth now",
  );
  // MUI Switch.
  await notes.getByText("On call").click();
  await expect(notes.getByText("Off call")).toBeVisible();
  // MUI Select: its menu opens in a portal outside the panel (document
  // body, not transformed); choosing an option updates the panel.
  await notes.getByRole("combobox").click();
  await page.getByRole("option", { name: "High" }).click();
  await expect(notes.getByTestId("priority-value")).toHaveText("high");
  expect(await sameNodes(page, NOTES)).toBe(true);
  await page.screenshot({
    path: `${EVIDENCE}/e3-mui-${testInfo.project.name}.png`,
  });
  await restore(page, NOTES);
  await expect(panel(page, NOTES).getByTestId("summary")).toHaveValue(
    "Night shift: all quiet, pager tested",
  );
  await expect(panel(page, NOTES).getByTestId("priority-value")).toHaveText(
    "high",
  );

  // Recharts in space: updates from the application store.
  await extract(page, CHART, "native");
  await expectPlaced(page, CHART);
  const chart = panel(page, CHART).getByTestId("chart");
  const values = (await chart.getAttribute("data-values"))!.split(",");
  const path = () =>
    chart.locator("path.recharts-line-curve").getAttribute("d");
  const pathBefore = await path();
  await panel(page, CHART).getByTestId("record-sample").click();
  // The store's next sample (see store.tsx), appended to the series.
  const next = 30 + ((Number(values.at(-1)) * 7 + 13) % 40);
  await expect(chart).toHaveAttribute(
    "data-values",
    [...values, String(next)].slice(-12).join(","),
  );
  await expect.poll(path).not.toBe(pathBefore);
  // One store subscription per subscribing component, as before.
  const after = await diagnostics(page);
  expect(after.subscriptions).toBe(before.subscriptions);
  expect(after.subscribes).toBe(before.subscribes);
  expect(after.mounts).toBe(before.mounts);
  await restore(page, CHART);
  expect(errors).toEqual([]);
});

test("E4 lifecycle: repeated cycles, adaptive presentations, unmount mid-drag, renderer disposal", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await open(page);
  const baseline = {
    move: await windowListeners(page, "pointermove"),
    up: await windowListeners(page, "pointerup"),
    key: await windowListeners(page, "keydown"),
    diagnostics: await diagnostics(page),
  };
  const seen = new Set<string>();
  for (let cycle = 0; cycle < 3; cycle++) {
    await extract(page, COUNTER, "native");
    const native = (await target(page, COUNTER))!;
    expect(seen.has(native.presentationId)).toBe(false);
    seen.add(native.presentationId);
    expect(native.transform).toEqual(native.initial);
    expect(await panelListeners(page, COUNTER, "pointerdown")).toBe(1);
    const from = await centerOf(handle(page, COUNTER, "translate"));
    await drag(page, from, { x: from.x - 40, y: from.y + 20 });
    await restore(page, COUNTER);
    expect(await residue(page, COUNTER)).toEqual([]);
    expect(await panelListeners(page, COUNTER, "pointerdown")).toBe(0);

    // XR Adaptive: drawn by the app's renderer from the semantic view.
    await extract(page, COUNTER, "adaptive");
    const adaptive = (await target(page, COUNTER))!;
    expect(seen.has(adaptive.presentationId)).toBe(false);
    seen.add(adaptive.presentationId);
    const camera = await cameraMark(page);
    const body = (await page.evaluate(
      (id) => (window as W).__spatialView!.locate(id, 0.5, 0.65),
      COUNTER,
    ))!;
    await drag(page, body, { x: body.x + 60, y: body.y - 20 });
    expect(await poseOf(page, COUNTER)).not.toEqual(adaptive.initial);
    // The panel took the drag, not the camera.
    expect(await cameraShift(page, camera)).toBeLessThan(0.5);
    // Its semantic action runs the application's action exactly once.
    const incidents = Number(await page.getByTestId("incidents").textContent());
    const button = (await page.evaluate(
      (id) => (window as W).__spatialView!.locate(id, 0.5, 0.15),
      COUNTER,
    ))!;
    await page.mouse.click(button.x, button.y);
    await expect(page.getByTestId("incidents")).toHaveText(
      String(incidents + 1),
    );
    await restore(page, COUNTER);
    await expect
      .poll(() =>
        page.evaluate(() => (window as W).__spatialView!.liveTextures),
      )
      .toBe(0);
    expect(await windowListeners(page, "pointermove")).toBe(baseline.move);
    expect(await windowListeners(page, "pointerup")).toBe(baseline.up);
    expect(await windowListeners(page, "keydown")).toBe(baseline.key);
  }

  // Unmount during a native drag (the interruption comes from the keyboard).
  await extract(page, NOTES, "native");
  const from = await centerOf(handle(page, NOTES, "translate"));
  await drag(page, from, { x: from.x - 40, y: from.y }, true);
  expect(await active(page)).not.toBeNull();
  await page.getByTestId("notes-mounted").focus();
  await page.keyboard.press("Space");
  await expect(slot(page, NOTES)).toHaveCount(0);
  await page.mouse.move(from.x - 120, from.y, { steps: 3 });
  await page.mouse.up();
  expect(await target(page, NOTES)).toBeUndefined();
  expect(await active(page)).toBeNull();
  expect(await windowListeners(page, "pointermove")).toBe(baseline.move);
  await page.getByTestId("notes-mounted").focus();
  await page.keyboard.press("Space");
  await expect(slot(page, NOTES)).toHaveCount(1);
  await expect(panel(page, NOTES)).not.toHaveAttribute(
    "data-spatialflex-placement",
  );

  // Renderer disposal: closing the 3D view restores and disposes.
  await extract(page, COUNTER, "native");
  await extract(page, CHART, "adaptive");
  await page.getByTestId("toggle-view").click();
  await expect(page.getByTestId("spatial-canvas")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as W).__spatialView!.liveRenderers),
  ).toBe(0);
  expect(await targets(page)).toEqual([]);
  expect(await residue(page, COUNTER)).toEqual([]);
  await page.getByTestId("toggle-view").click();
  await expect
    .poll(() => page.evaluate(() => (window as W).__spatialView!.liveRenderers))
    .toBe(1);
  expect(await windowListeners(page, "pointermove")).toBe(baseline.move);
  expect(errors.filter((e) => !/WebGL context was lost/.test(e))).toEqual([]);
  evidence[`e4-${testInfo.project.name}`] = {
    presentationInstances: [...seen],
    listeners: baseline,
  };
});

test("E5 an unsupported ancestor is diagnosed and Native DOM is refused", async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);
  await open(page);
  await select(page, REGION);
  const compatibility = page.getByTestId("compatibility");
  await expect(compatibility).toHaveAttribute("data-supported", "false");
  await expect(compatibility).toContainText(
    "ancestor div.carousel has will-change: transform",
  );
  await expect(compatibility).toContainText("Use XR Adaptive");
  await expect(page.getByTestId("extract-native")).toBeDisabled();
  expect(await target(page, REGION)).toBeUndefined();
  // Nothing was placed: no wrong-position interactive element.
  await expect(panel(page, REGION)).not.toHaveAttribute(
    "data-spatialflex-placement",
  );
  expect(await residue(page, REGION)).toEqual([]);
  // XR Adaptive stays available as an explicit choice (never automatic).
  await page.getByTestId("extract-adaptive").click();
  await expect
    .poll(async () => (await target(page, REGION))?.kind)
    .toBe("adaptive");
  await page.screenshot({
    path: `${EVIDENCE}/e5-diagnostic-${testInfo.project.name}.png`,
  });
  evidence[`e5-${testInfo.project.name}`] = {
    diagnostic: await compatibility.textContent(),
  };
  expect(errors).toEqual([]);
});

test("E6 switching strategy is a transaction; actions are scoped to the live instance", async ({
  page,
}, testInfo) => {
  const errors = watchConsole(page);
  await open(page);
  const card = slot(page, COUNTER).locator("article");
  await mark(page, COUNTER);
  // Native → Adaptive: the original returns to its layout, then the 3D
  // panel of the new instance appears.
  await extract(page, COUNTER, "native");
  const native = (await target(page, COUNTER))!;
  await page.getByTestId("extract-adaptive").click();
  await expect
    .poll(async () => (await target(page, COUNTER))?.kind)
    .toBe("adaptive");
  const adaptive = (await target(page, COUNTER))!;
  expect(adaptive.presentationId).not.toBe(native.presentationId);
  expect(await targets(page)).toHaveLength(1);
  await expect(panel(page, COUNTER)).not.toHaveAttribute(
    "data-spatialflex-placement",
  );
  expect(await residue(page, COUNTER)).toEqual([]);
  expect(await sameNodes(page, COUNTER)).toBe(true);
  expect(
    await card.evaluate((el) => el.closest("[data-spatialflex-item]") !== null),
  ).toBe(true);
  // The adaptive instance's action runs the app's action exactly once.
  const incidents = Number(await page.getByTestId("incidents").textContent());
  const calls = Number(await page.getByTestId("action-calls").textContent());
  const button = (await page.evaluate(
    (id) => (window as W).__spatialView!.locate(id, 0.5, 0.15),
    COUNTER,
  ))!;
  await page.mouse.click(button.x, button.y);
  await expect(page.getByTestId("incidents")).toHaveText(String(incidents + 1));
  await expect(page.getByTestId("action-calls")).toHaveText(String(calls + 1));
  // Adaptive → Native: back in space as a new native instance.
  await page.getByTestId("extract-native").click();
  await expect(panel(page, COUNTER)).toHaveAttribute("data-spatial-placed", "");
  const again = (await target(page, COUNTER))!;
  expect(again.kind).toBe("native");
  expect(again.transform).toEqual(again.initial);
  await expect
    .poll(() => page.evaluate(() => (window as W).__spatialView!.liveTextures))
    .toBe(0);
  // A refused switch keeps the current presentation: Region status is
  // presented as XR Adaptive; Native DOM stays refused, nothing changes.
  await extract(page, REGION, "adaptive");
  const regionAdaptive = (await target(page, REGION))!;
  await expect(page.getByTestId("extract-native")).toBeDisabled();
  expect(await target(page, REGION)).toEqual(regionAdaptive);
  await page.screenshot({
    path: `${EVIDENCE}/e6-switch-${testInfo.project.name}.png`,
  });
  expect(errors).toEqual([]);
});

test.afterAll(async ({ browserName }) => {
  if (Object.keys(evidence).length === 0) return;
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(
    `${EVIDENCE}/consumer-${browserName}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
});
