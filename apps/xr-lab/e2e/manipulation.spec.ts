import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { ENGINES, probe, type Engine, type Probe, watchConsole } from "./lab";

/**
 * P1-06B spatial panel manipulation. Every manipulation is real mouse or
 * keyboard input on the rendered page: Native DOM handles are DOM elements
 * inside the transformed original element, XR Adaptive handles are meshes
 * picked by the renderer. Poses are read from the read-only manipulation
 * hook and checked against the renderer's own projection (host probe) and
 * the DOM's geometry.
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
type TestWindow = Window & {
  __xrHostProbe?: Probe;
  __xrLabManipulation?: { targets(): Target[] };
  __marked?: Record<string, Element>;
  __liveWindowListeners?: (type: string) => number;
  __lastPointerId?: number;
};

const EVIDENCE = "../../docs/evidence";
const COUNTER = "shared-counter";
const surface = (page: Page) => page.getByTestId("web-surface");
const slot = (page: Page, id: string) =>
  page.locator(`[data-spatialflex-item="${id}"]`);
const panel = (page: Page, id: string) =>
  slot(page, id).locator("[data-spatialflex-panel]");
const outline = (page: Page, id: string) =>
  surface(page).locator(`.surface-outline[data-surface-item="${id}"]`);
const modeStatus = (page: Page) => page.getByTestId("manipulation-mode");
/** A Native DOM handle rendered by the SDK inside the original element. */
const handle = (
  page: Page,
  id: string,
  mode: "translate" | "rotate" | "resize",
): Locator =>
  panel(page, id).locator(
    mode === "translate"
      ? '[data-spatialflex-handle="translate"][role=button]'
      : `[data-spatialflex-handle="${mode}"]`,
  );

/** Counts live window listeners per type (capture phase), to detect leaks. */
const countWindowListeners = () => {
  const live = new Map<unknown, Set<string>>();
  const add = window.addEventListener;
  const remove = window.removeEventListener;
  const keyOf = (type: string, options?: boolean | EventListenerOptions) =>
    `${type}:${typeof options === "boolean" ? options : !!options?.capture}`;
  window.addEventListener = function (
    this: Window,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    {
      const keys = live.get(listener) ?? new Set<string>();
      keys.add(keyOf(type, options));
      live.set(listener, keys);
    }
    return add.call(this, type, listener, options);
  } as typeof window.addEventListener;
  window.removeEventListener = function (
    this: Window,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) {
    live.get(listener)?.delete(keyOf(type, options));
    return remove.call(this, type, listener, options);
  } as typeof window.removeEventListener;
  add.call(
    window,
    "pointerdown",
    (event: Event) => {
      (window as TestWindow).__lastPointerId = (
        event as PointerEvent
      ).pointerId;
    },
    true,
  );
  (window as TestWindow).__liveWindowListeners = (type: string) =>
    [...live.values()].filter((keys) => keys.has(type)).length;
};

async function open(page: Page, engine: Engine) {
  await page.addInitScript(countWindowListeners);
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=website`,
  );
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  await expect(page.getByTestId("surface-status")).toHaveAttribute(
    "data-value",
    "visible",
  );
}

async function select(page: Page, id: string) {
  await surface(page).getByTestId("surface-select-mode").click();
  await outline(page, id).click();
  await expect(outline(page, id)).toHaveAttribute("data-selected", "true");
}

async function extract(
  page: Page,
  id: string,
  presentation: "native" | "adaptive",
) {
  await select(page, id);
  await surface(page)
    .getByTestId(`surface-presentation-${presentation}`)
    .click();
  await surface(page).getByTestId("surface-source").selectOption("reserved");
  await surface(page).getByTestId("surface-extract").click();
  if (presentation === "native")
    await expect(panel(page, id)).toHaveAttribute("data-spatial-placed", "");
  else await expect.poll(() => probe(page, "panels")).toContain(id);
  await expect
    .poll(async () => (await target(page, id))?.kind)
    .toBe(presentation);
}

const targets = (page: Page) =>
  page.evaluate(() => (window as TestWindow).__xrLabManipulation!.targets());
const target = async (page: Page, id: string) =>
  (await targets(page)).find((t) => t.itemId === id);
const poseOf = async (page: Page, id: string) =>
  (await target(page, id))!.transform;

const project = (page: Page, point: Vec3) =>
  page.evaluate(
    (p) => (window as TestWindow).__xrHostProbe!.project(p),
    point,
  ) as Promise<Point | null>;
const locate = async (page: Page, id: string, part: string) => {
  let point: Point | null = null;
  await expect
    .poll(async () => {
      point = await page.evaluate(
        ([i, p]) => (window as TestWindow).__xrHostProbe!.locate(i!, p!),
        [id, part],
      );
      return point;
    })
    .not.toBeNull();
  return point!;
};
const worldPosition = (page: Page, id: string, part: string) =>
  page.evaluate(
    ([i, p]) => (window as TestWindow).__xrHostProbe!.worldPosition(i!, p!),
    [id, part],
  ) as Promise<Vec3 | null>;

/** Heading about +y (0: facing +z), as in the SDK. */
const yaw = ([x, y, z, w]: Quat) =>
  Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));
const rotate = ([x, y, z, w]: Quat, v: Vec3): Vec3 => {
  const t: Vec3 = [
    2 * (y * v[2] - z * v[1]),
    2 * (z * v[0] - x * v[2]),
    2 * (x * v[1] - y * v[0]),
  ];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
};
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((v, i) => v - b[i]!));

const centerOf = async (locator: Locator): Promise<Point> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A real mouse drag; `hold` keeps the button pressed at the end. */
async function drag(page: Page, from: Point, to: Point, hold = false) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(
    from.x + (to.x - from.x) / 2,
    from.y + (to.y - from.y) / 2,
    { steps: 5 },
  );
  await page.mouse.move(to.x, to.y, { steps: 5 });
  if (!hold) await page.mouse.up();
}

/** Client positions of the surface page's corners: they move with the camera. */
const surfaceCorners = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-surface-corner]")].flatMap((m) => {
      const r = m.getBoundingClientRect();
      return [r.left, r.top];
    }),
  );
const expectSameCamera = async (page: Page, corners: number[]) => {
  const now = await surfaceCorners(page);
  now.forEach((v, i) => expect(Math.abs(v - corners[i]!)).toBeLessThan(0.5));
};

async function orbit(page: Page, engine: Engine) {
  const box = (await page.getByTestId("xr-canvas").boundingBox())!;
  const start = { x: box.x + box.width - 40, y: box.y + box.height - 30 };
  const dx = engine === "three" ? -60 : -40;
  await drag(page, start, { x: start.x + dx, y: start.y - 10 });
}

/**
 * The original element is exactly where its manipulated world pose projects
 * through the renderer's camera (compositor-independent reference).
 */
async function expectPlaced(page: Page, id: string) {
  const expected = () =>
    page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(
        `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
      )!;
      const pose = JSON.parse(el.dataset.spatialPose!) as {
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
      const p = (window as TestWindow).__xrHostProbe!;
      const pts = [
        [-0.5, 0.5],
        [0.5, 0.5],
        [0.5, -0.5],
        [-0.5, -0.5],
      ].map(([u, v]) => {
        const local = [u! * pose.width, v! * pose.height];
        return p.project(
          [0, 1, 2].map(
            (i) =>
              pose.position[i]! + R[i]![0]! * local[0]! + R[i]![1]! * local[1]!,
          ) as Vec3,
        )!;
      });
      const xs = pts.map((q) => q.x),
        ys = pts.map((q) => q.y);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        right: Math.max(...xs),
        bottom: Math.max(...ys),
      };
    }, id);
  await expect
    .poll(async () => {
      const actual = (await panel(page, id).boundingBox())!;
      const e = await expected();
      return Math.max(
        Math.abs(actual.x - e.x),
        Math.abs(actual.y - e.y),
        Math.abs(actual.x + actual.width - e.right),
        Math.abs(actual.y + actual.height - e.bottom),
      );
    })
    .toBeLessThan(2);
}

/** The DOM pose the compositor wrote equals the manipulator's pose. */
async function expectCompositedPose(page: Page, id: string) {
  await expect
    .poll(async () => {
      const pose = await poseOf(page, id);
      const written = JSON.parse(
        (await panel(page, id).getAttribute("data-spatial-pose"))!,
      ) as { position: Vec3 };
      return distance(written.position, pose.position);
    })
    .toBeLessThan(1e-9);
}

const mark = (page: Page) =>
  page.evaluate(() => {
    const item = document.querySelector(
      '[data-spatialflex-item="shared-counter"]',
    )!;
    (window as TestWindow).__marked = {
      article: item.querySelector("article")!,
      increment: item.querySelector("[data-testid=web-increment]")!,
      note: item.querySelector("[data-testid=counter-note]")!,
    };
  });
const sameNodes = (page: Page) =>
  page.evaluate(() => {
    const marked = (window as TestWindow).__marked!;
    const item = document.querySelector(
      '[data-spatialflex-item="shared-counter"]',
    )!;
    return (
      marked.article === item.querySelector("article") &&
      marked.increment ===
        document.querySelector("[data-testid=web-increment]") &&
      marked.note === document.querySelector("[data-testid=counter-note]") &&
      document.querySelectorAll("[data-testid=web-count]").length === 1
    );
  });
async function diagnostics(page: Page) {
  const subs = page.getByTestId("active-subscriptions");
  return {
    active: await subs.textContent(),
    subscribes: await subs.getAttribute("data-total-subscribes"),
    mounts: await page.getByTestId("counter-mounts").textContent(),
    instances: await page.getByTestId("counter-instances").textContent(),
  };
}

const liveListeners = (page: Page, type: string) =>
  page.evaluate((t) => (window as TestWindow).__liveWindowListeners!(t), type);

const evidence: Record<string, unknown> = {};
const shot = (page: Page, name: string, enabled: boolean) =>
  enabled
    ? page.screenshot({ path: `${EVIDENCE}/p1-06b-${name}.png` })
    : Promise.resolve();

for (const engine of ENGINES) {
  test(`${engine}: Native DOM panel is moved, rotated and resized with the mouse`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors = watchConsole(page);
    const capture = engine === "three" && testInfo.project.name === "chromium";
    await open(page, engine);
    await surface(page).getByTestId("counter-note").fill("typed before");
    await mark(page);
    const before = await diagnostics(page);
    const moveListeners = await liveListeners(page, "pointermove:true");

    await extract(page, COUNTER, "native");
    const start = (await target(page, COUNTER))!;
    expect(start.presentationId).toMatch(/^native-\d+$/);
    expect(start.transform).toEqual(start.initial);
    await expectPlaced(page, COUNTER);
    await shot(page, "native-before", capture);
    const cssWidth = await panel(page, COUNTER).evaluate(
      (el: HTMLElement) => el.offsetWidth,
    );
    const startBox = (await panel(page, COUNTER).boundingBox())!;

    // --- Translate: the title bar follows the pointer, the camera stays.
    const corners = await surfaceCorners(page);
    const grab = await centerOf(handle(page, COUNTER, "translate"));
    // Across the website page: the panel must stay in front of it (it
    // slides on its own plane, parallel to the page) and stay hittable.
    const to = { x: grab.x - 300, y: grab.y + 120 };
    await drag(page, grab, to, true);
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "translate");
    await expect(panel(page, COUNTER)).toHaveAttribute(
      "data-manipulating",
      "translate",
    );
    // One pointer session: exactly one extra capture listener.
    expect(await liveListeners(page, "pointermove:true")).toBe(
      moveListeners + 1,
    );
    await page.mouse.up();
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
    expect(await liveListeners(page, "pointermove:true")).toBe(moveListeners);
    await expectSameCamera(page, corners);
    const moved = await poseOf(page, COUNTER);
    expect(distance(moved.position, start.transform.position)).toBeGreaterThan(
      0.2,
    );
    expect(moved.rotation).toEqual(start.transform.rotation);
    expect(moved.scale).toBe(1);
    await expectCompositedPose(page, COUNTER);
    await expectPlaced(page, COUNTER);
    // The grabbed title is still under the pointer (perspective-correct).
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest("[data-spatialflex-handle]")
            ?.getAttribute("data-spatialflex-handle"),
        to,
      ),
    ).toBe("translate");
    // The projected center moved with the pointer.
    const p0 = (await project(page, start.transform.position))!;
    const p1 = (await project(page, moved.position))!;
    expect(Math.abs(p1.x - p0.x - (to.x - grab.x))).toBeLessThan(8);
    expect(Math.abs(p1.y - p0.y - (to.y - grab.y))).toBeLessThan(8);
    await expect(panel(page, COUNTER)).toHaveAttribute(
      "data-manipulation-selected",
      "",
    );
    await shot(page, "native-moved", capture);

    // --- Orbiting the camera outside panels keeps the world pose.
    await orbit(page, engine);
    await expect
      .poll(async () => {
        const now = await surfaceCorners(page);
        return Math.max(...now.map((v, i) => Math.abs(v - corners[i]!)));
      })
      .toBeGreaterThan(5);
    expect(await poseOf(page, COUNTER)).toEqual(moved);
    await expectPlaced(page, COUNTER);
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect
      .poll(async () => {
        const now = await surfaceCorners(page);
        return Math.max(...now.map((v, i) => Math.abs(v - corners[i]!)));
      })
      .toBeLessThan(0.5);

    // --- Rotate (yaw) with the ⟲ handle.
    const rotateFrom = await centerOf(handle(page, COUNTER, "rotate"));
    await drag(page, rotateFrom, { x: rotateFrom.x + 60, y: rotateFrom.y });
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
    const rotated = await poseOf(page, COUNTER);
    expect(yaw(rotated.rotation) - yaw(moved.rotation)).toBeGreaterThan(0.15);
    expect(rotated.position).toEqual(moved.position);
    await expectSameCamera(page, corners);
    await expectPlaced(page, COUNTER);
    await shot(page, "native-rotated", capture);

    // --- Resize: spatial scale only; the CSS layout size is unchanged.
    const resizeFrom = await centerOf(handle(page, COUNTER, "resize"));
    await drag(page, resizeFrom, {
      x: resizeFrom.x + 40,
      y: resizeFrom.y + 30,
    });
    const resized = await poseOf(page, COUNTER);
    expect(resized.scale).toBeGreaterThan(1.15);
    expect(resized.position).toEqual(rotated.position);
    expect(resized.rotation).toEqual(rotated.rotation);
    await expectPlaced(page, COUNTER);
    expect(
      await panel(page, COUNTER).evaluate((el: HTMLElement) => el.offsetWidth),
    ).toBe(cssWidth);
    const resizedBox = (await panel(page, COUNTER).boundingBox())!;
    expect(resizedBox.height).toBeGreaterThan(startBox.height * 1.1);
    await expectSameCamera(page, corners);
    await shot(page, "native-resized", capture);

    // --- The original controls work in the manipulated panel.
    const calls = Number(
      await page.getByTestId("increment-calls").textContent(),
    );
    await panel(page, COUNTER).getByTestId("web-increment").click();
    await expect(page.getByTestId("increment-calls")).toHaveText(
      String(calls + 1),
    );
    await panel(page, COUNTER)
      .getByTestId("counter-note")
      .fill("typed in space");
    await panel(page, COUNTER).getByTestId("counter-local").click();
    await expect(panel(page, COUNTER).getByTestId("counter-local")).toHaveText(
      /1/,
    );
    // Clicking content selects nothing and moves nothing.
    expect(await poseOf(page, COUNTER)).toEqual(resized);
    expect(await sameNodes(page)).toBe(true);
    expect(await diagnostics(page)).toEqual(before);

    // --- Restore: back in place with its state; the spatial styles released.
    await page.getByRole("button", { name: "Restore Shared counter" }).click();
    await expect(panel(page, COUNTER)).not.toHaveAttribute(
      "data-spatialflex-placement",
    );
    expect(await target(page, COUNTER)).toBeUndefined();
    expect(
      await panel(page, COUNTER).evaluate(
        (el: HTMLElement) =>
          el.style.transform +
          el.style.position +
          (el.dataset.manipulationSelected ?? "") +
          (el.dataset.manipulating ?? ""),
      ),
    ).toBe("");
    await expect(panel(page, COUNTER).getByTestId("counter-note")).toHaveValue(
      "typed in space",
    );
    expect(await sameNodes(page)).toBe(true);
    expect(await diagnostics(page)).toEqual(before);
    expect(await liveListeners(page, "pointermove:true")).toBe(moveListeners);

    // --- A new extraction is a new presentation at its default pose.
    await extract(page, COUNTER, "native");
    const again = (await target(page, COUNTER))!;
    expect(again.presentationId).not.toBe(start.presentationId);
    expect(again.transform).toEqual(again.initial);
    expect(again.initial.scale).toBe(1);
    expect(
      distance(again.initial.position, start.initial.position),
    ).toBeLessThan(1e-9);
    if (capture)
      evidence.native = {
        engine,
        initial: start.transform,
        moved,
        rotated,
        resized,
        projectedCenter: { before: p0, afterMove: p1 },
        pointer: { from: grab, to },
        cssLayoutWidth: cssWidth,
        boundingBox: { before: startBox, afterResize: resizedBox },
      };
    expect(errors).toEqual([]);
  });

  test(`${engine}: XR Adaptive panel is manipulated with 3D handles through the same engine`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const errors = watchConsole(page);
    const capture = engine === "three" && testInfo.project.name === "chromium";
    await open(page, engine);
    const textures = await probe(page, "liveTextures");

    // A Native presentation of the counter, manipulated and restored first:
    // the Adaptive presentation that follows starts fresh.
    await extract(page, COUNTER, "native");
    const native = (await target(page, COUNTER))!;
    const grab = await centerOf(handle(page, COUNTER, "translate"));
    await drag(page, grab, { x: grab.x - 80, y: grab.y + 40 });
    await page.getByRole("button", { name: "Restore Shared counter" }).click();
    await expect.poll(() => target(page, COUNTER)).toBeUndefined();

    await extract(page, COUNTER, "adaptive");
    const start = (await target(page, COUNTER))!;
    expect(start.presentationId).toMatch(/^presentation-\d+$/);
    expect(start.presentationId).not.toBe(native.presentationId);
    expect(start.transform).toEqual(start.initial);
    // Babylon reports world positions in float32.
    expect(
      distance(
        (await worldPosition(page, COUNTER, "background"))!,
        start.transform.position,
      ),
    ).toBeLessThan(1e-4);

    // --- Translate with the Move handle; the camera does not orbit.
    const corners = await surfaceCorners(page);
    const from = await locate(page, COUNTER, "handle:translate");
    const to = { x: from.x - 140, y: from.y + 50 };
    await drag(page, from, to, true);
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "translate");
    await page.mouse.up();
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
    await expectSameCamera(page, corners);
    const moved = await poseOf(page, COUNTER);
    expect(distance(moved.position, start.transform.position)).toBeGreaterThan(
      0.2,
    );
    // The renderer draws the panel at the manipulated pose, and the grabbed
    // handle is under the pointer.
    await expect
      .poll(async () =>
        distance(
          (await worldPosition(page, COUNTER, "background"))!,
          moved.position,
        ),
      )
      .toBeLessThan(1e-4);
    const handleNow = await locate(page, COUNTER, "handle:translate");
    expect(Math.abs(handleNow.x - to.x)).toBeLessThan(4);
    expect(Math.abs(handleNow.y - to.y)).toBeLessThan(4);
    await shot(page, "adaptive-moved", capture);

    // --- Escape cancels a drag in progress: back to the drag's start.
    const escFrom = await locate(page, COUNTER, "handle:translate");
    await drag(page, escFrom, { x: escFrom.x + 90, y: escFrom.y - 40 }, true);
    expect(
      distance((await poseOf(page, COUNTER)).position, moved.position),
    ).toBeGreaterThan(0.05);
    await page.keyboard.press("Escape");
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
    await page.mouse.move(escFrom.x + 120, escFrom.y);
    await page.mouse.up();
    expect(await poseOf(page, COUNTER)).toEqual(moved);
    await expectSameCamera(page, corners);

    // --- Rotate and resize.
    const rotateFrom = await locate(page, COUNTER, "handle:rotate");
    await drag(page, rotateFrom, { x: rotateFrom.x + 50, y: rotateFrom.y });
    const rotated = await poseOf(page, COUNTER);
    expect(yaw(rotated.rotation)).toBeGreaterThan(0.15);
    const resizeFrom = await locate(page, COUNTER, "handle:resize");
    await drag(page, resizeFrom, {
      x: resizeFrom.x + 40,
      y: resizeFrom.y + 30,
    });
    const resized = await poseOf(page, COUNTER);
    expect(resized.scale).toBeGreaterThan(1.15);
    expect(resized.rotation).toEqual(rotated.rotation);
    await expectSameCamera(page, corners);
    // The renderer applied exactly that rotation and scale to every part.
    const closeLocal: Vec3 = [0.255, 0.155, 0.005];
    const expectedClose = rotate(
      resized.rotation,
      closeLocal.map((v) => v * resized.scale) as Vec3,
    ).map((v, i) => v + resized.position[i]!);
    await expect
      .poll(async () =>
        distance((await worldPosition(page, COUNTER, "close"))!, expectedClose),
      )
      .toBeLessThan(1e-4);

    // --- The semantic action runs exactly once on the manipulated panel.
    const calls = Number(
      await page.getByTestId("increment-calls").textContent(),
    );
    const count = Number(await page.getByTestId("web-count").textContent());
    const plus = await locate(page, COUNTER, "button:increment");
    await page.mouse.click(plus.x, plus.y);
    await expect(page.getByTestId("increment-calls")).toHaveText(
      String(calls + 1),
    );
    await expect(page.getByTestId("web-count")).toHaveText(String(count + 1));
    expect(await poseOf(page, COUNTER)).toEqual(resized);

    // --- Reset returns this presentation to its initial pose.
    await page
      .getByRole("button", { name: "Reset transform of Shared counter" })
      .click();
    expect(await poseOf(page, COUNTER)).toEqual(start.initial);
    await expect
      .poll(async () =>
        distance(
          (await worldPosition(page, COUNTER, "background"))!,
          start.initial.position,
        ),
      )
      .toBeLessThan(1e-4);

    // --- Restore: panel and its handle textures are released.
    await page.getByRole("button", { name: "Restore Shared counter" }).click();
    await expect.poll(() => probe(page, "panels")).not.toContain(COUNTER);
    await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
    expect(await target(page, COUNTER)).toBeUndefined();
    if (capture)
      evidence.adaptive = {
        engine,
        initial: start.transform,
        moved,
        rotated,
        resized,
        pointer: { from, to },
        handleAfterMove: handleNow,
      };
    expect(errors).toEqual([]);
  });

  test(`${engine}: keyboard manipulation, cancel paths and independent panels`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    const capture = engine === "three" && testInfo.project.name === "chromium";
    await open(page, engine);
    const textures = await probe(page, "liveTextures");
    const moveListeners = await liveListeners(page, "pointermove:true");
    const keyListeners = await liveListeners(page, "keydown:true");

    await extract(page, COUNTER, "native");
    const start = (await target(page, COUNTER))!;
    const initial = start.initial;

    // --- Keyboard: focus the Move handle, step with the arrow keys.
    await handle(page, COUNTER, "translate").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "translate");
    let pose = await poseOf(page, COUNTER);
    expect(pose.position[0] - initial.position[0]).toBeCloseTo(0.04, 9);
    expect(pose.position[1] - initial.position[1]).toBeCloseTo(0.1, 9);
    // Tab to the Rotate handle; the same keyboard session continues.
    await page.keyboard.press("Tab");
    await expect(handle(page, COUNTER, "rotate")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    pose = await poseOf(page, COUNTER);
    expect(yaw(pose.rotation) - yaw(initial.rotation)).toBeCloseTo(
      -Math.PI / 36,
      6,
    );
    // Escape reverts the whole keyboard session.
    await page.keyboard.press("Escape");
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
    expect(await poseOf(page, COUNTER)).toEqual(initial);
    // Enter commits.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
    const turned = await poseOf(page, COUNTER);
    expect(yaw(turned.rotation) - yaw(initial.rotation)).toBeCloseTo(
      Math.PI / 36,
      6,
    );
    // From the panel's text field, Tab reaches the Resize handle.
    await panel(page, COUNTER).getByTestId("counter-note").click();
    await page.keyboard.press("Tab");
    await expect(handle(page, COUNTER, "resize")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    // Leaving the panel commits the steps.
    await page.getByTestId("manipulation-inspector").click();
    await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
    expect((await poseOf(page, COUNTER)).scale).toBeCloseTo(1.1, 9);
    await expectPlaced(page, COUNTER);

    // --- Pointer cancel and window blur cancel a drag in progress.
    const committed = await poseOf(page, COUNTER);
    for (const cancel of ["pointercancel", "blur"] as const) {
      const from = await centerOf(handle(page, COUNTER, "translate"));
      await drag(page, from, { x: from.x - 60, y: from.y + 30 }, true);
      expect(
        distance((await poseOf(page, COUNTER)).position, committed.position),
      ).toBeGreaterThan(0.03);
      // The platform ends the pointer stream (no user release).
      await page.evaluate((type) => {
        if (type === "blur") window.dispatchEvent(new FocusEvent("blur"));
        else
          window.dispatchEvent(
            new PointerEvent("pointercancel", {
              // The real press's pointer (Chromium 1, Firefox 0).
              pointerId: (window as TestWindow).__lastPointerId!,
            }),
          );
      }, cancel);
      await expect(modeStatus(page)).toHaveAttribute("data-mode", "idle");
      expect(await poseOf(page, COUNTER)).toEqual(committed);
      await page.mouse.up();
      expect(await poseOf(page, COUNTER)).toEqual(committed);
      expect(await liveListeners(page, "pointermove:true")).toBe(moveListeners);
    }

    // --- Several panels: independent poses, one selection.
    await extract(page, "live-chart", "native");
    await extract(page, "image-panel", "adaptive");
    const others = async () => ({
      counter: await poseOf(page, COUNTER),
      chart: await poseOf(page, "live-chart"),
      image: await poseOf(page, "image-panel"),
    });
    const baseline = await others();
    const chartFrom = await centerOf(handle(page, "live-chart", "translate"));
    await drag(page, chartFrom, { x: chartFrom.x - 120, y: chartFrom.y + 40 });
    let now = await others();
    expect(
      distance(now.chart.position, baseline.chart.position),
    ).toBeGreaterThan(0.1);
    expect(now.counter).toEqual(baseline.counter);
    expect(now.image).toEqual(baseline.image);
    await expect(page.getByTestId("manipulation-live-chart")).toHaveAttribute(
      "data-selected",
      "true",
    );
    await expect(panel(page, "live-chart")).toHaveAttribute(
      "data-manipulation-selected",
      "",
    );
    await expect(panel(page, COUNTER)).not.toHaveAttribute(
      "data-manipulation-selected",
    );
    const imageFrom = await locate(page, "image-panel", "handle:translate");
    await drag(page, imageFrom, { x: imageFrom.x - 160, y: imageFrom.y + 20 });
    const after = await others();
    expect(distance(after.image.position, now.image.position)).toBeGreaterThan(
      0.1,
    );
    expect(after.chart).toEqual(now.chart);
    expect(after.counter).toEqual(now.counter);
    await expect(page.getByTestId("manipulation-image-panel")).toHaveAttribute(
      "data-selected",
      "true",
    );
    await expect(panel(page, "live-chart")).not.toHaveAttribute(
      "data-manipulation-selected",
    );
    now = after;
    await expectPlaced(page, COUNTER);
    await expectPlaced(page, "live-chart");
    await shot(page, "multiple-panels", capture);

    // --- Repeated extract/restore cycles leak no listeners or textures.
    for (const label of ["Shared counter", "Live chart", "Image"])
      await page
        .getByRole("button", { name: `Restore ${label}`, exact: true })
        .click();
    await expect.poll(() => targets(page)).toEqual([]);
    for (let i = 0; i < 3; i++) {
      await extract(page, COUNTER, i % 2 ? "adaptive" : "native");
      if (i % 2) {
        const f = await locate(page, COUNTER, "handle:translate");
        await drag(page, f, { x: f.x - 40, y: f.y + 20 });
      } else {
        const f = await centerOf(handle(page, COUNTER, "translate"));
        await drag(page, f, { x: f.x - 40, y: f.y + 20 });
      }
      await page
        .getByRole("button", { name: "Restore Shared counter" })
        .click();
      await expect.poll(() => targets(page)).toEqual([]);
    }
    await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
    expect(await liveListeners(page, "pointermove:true")).toBe(moveListeners);
    expect(await liveListeners(page, "keydown:true")).toBe(keyListeners);
    if (capture)
      evidence.multiple = {
        engine,
        poses: now,
      };
    expect(errors).toEqual([]);
  });
}

test.afterAll(async ({ browserName }) => {
  if (browserName !== "chromium" || !Object.keys(evidence).length) return;
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(
    `${EVIDENCE}/p1-06b-manipulation.json`,
    JSON.stringify(evidence, null, 2) + "\n",
  );
});
