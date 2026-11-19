import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  ENGINES,
  probe,
  showInXR,
  watchConsole,
  xrItem,
  type Engine,
  type Probe,
} from "./lab";

/**
 * P1-07B3: the XR Lab's SpatialFlex integration runs on the SDK's shared
 * PresentationRuntime (the one the external consumer uses), with the
 * Spatial Website's page as the runtime's Native DOM host (page-surface
 * mode). Real mouse and keyboard input only. Geometry is checked against
 * the renderer's own camera (host probe), independently of the compositor.
 */

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Point = { x: number; y: number };
type Pose = { position: Vec3; rotation: Quat; scale: number };
type Target = {
  itemId: string;
  presentationId: string;
  registrationId: string;
  kind: "native" | "adaptive";
  transform: Pose;
  initial: Pose;
};
type TestWindow = Window & {
  __xrHostProbe?: Probe & { worldPosition(id: string, part: string): Vec3 };
  __xrLabManipulation?: { targets(): Target[] };
  __marked?: Record<string, Element>;
};

const EVIDENCE = process.env.LAB_EVIDENCE ?? "../../docs/evidence/p1-07b3";
const COUNTER = "shared-counter";
const surface = (page: Page) => page.getByTestId("web-surface");
const slot = (page: Page, id: string) =>
  page.locator(`[data-spatialflex-item="${id}"]`);
const panel = (page: Page, id: string) =>
  slot(page, id).locator("[data-spatialflex-panel]");
const outline = (page: Page, id: string) =>
  surface(page).locator(`.surface-outline[data-surface-item="${id}"]`);
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((v, i) => v - b[i]!));

async function open(page: Page, engine: Engine, mode = "website") {
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=${mode}`,
  );
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  if (mode === "website")
    await expect(page.getByTestId("surface-status")).toHaveAttribute(
      "data-value",
      "visible",
    );
}

async function extract(
  page: Page,
  id: string,
  presentation: "native" | "adaptive",
) {
  await surface(page).getByTestId("surface-select-mode").click();
  await outline(page, id).click();
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

const restore = (page: Page, label: string) =>
  page.getByRole("button", { name: `Restore ${label}` }).click();
const targets = (page: Page) =>
  page.evaluate(
    () => (window as TestWindow).__xrLabManipulation?.targets() ?? [],
  );
const target = async (page: Page, id: string) =>
  (await targets(page)).find((t) => t.itemId === id);

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}
const centerOf = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** SDK-owned marks on an element: inline transform/clip, data-spatial-*. */
const sdkMarks = (page: Page, id: string) =>
  panel(page, id).evaluate((el: HTMLElement) => ({
    transform: el.style.transform,
    clipPath: el.style.clipPath,
    // The compositor's data-spatial-* marks (not the component's own
    // data-spatialflex-* attributes).
    data: Object.keys(el.dataset).filter((k) => /^spatial[A-Z]/.test(k)),
  }));

/**
 * Where the renderer's camera projects the element's composited world
 * rectangle, against the element's DOM bounding box (pixels).
 */
async function placementError(page: Page, id: string) {
  return page.evaluate((id) => {
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
    const [cx, sx, cy, sy, cz, sz] = [
      Math.cos(rx),
      Math.sin(rx),
      Math.cos(ry),
      Math.sin(ry),
      Math.cos(rz),
      Math.sin(rz),
    ];
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
    const r = el.getBoundingClientRect();
    const xs = pts.map((q) => q.x),
      ys = pts.map((q) => q.y);
    return Math.max(
      Math.abs(r.left - Math.min(...xs)),
      Math.abs(r.top - Math.min(...ys)),
      Math.abs(r.right - Math.max(...xs)),
      Math.abs(r.bottom - Math.max(...ys)),
    );
  }, id);
}

async function evidence(
  testInfo: { project: { name: string } },
  engine: Engine,
  name: string,
  data: unknown,
) {
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(
    `${EVIDENCE}/${name}-${engine}-${testInfo.project.name}.json`,
    `${JSON.stringify(data, null, 2)}\n`,
  );
}

for (const engine of ENGINES) {
  test(`${engine}: M1 page-surface mode — the shared runtime composites the original element through the transformed page`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    await open(page, engine);
    await extract(page, COUNTER, "native");
    // One owner: the runtime's compositor writes the element; the page
    // (Lab-owned) carries no SDK marks and the visibility rule exists once.
    const ownership = await page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(
        `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
      )!;
      const page = document.querySelector<HTMLElement>(
        '[data-testid="web-surface"]',
      )!;
      return {
        insidePage: page.contains(el),
        elementTransform: el.style.transform.slice(0, 9),
        visibility: el.dataset.spatialVisibility,
        pageSdkMarks: Object.keys(page.dataset).filter((k) =>
          /^spatial[A-Z]/.test(k),
        ),
        visibilityRules: document.querySelectorAll(
          "#spatialflex-native-visibility",
        ).length,
      };
    }, COUNTER);
    expect(ownership).toEqual({
      insidePage: true,
      elementTransform: "matrix3d(",
      visibility: "visible",
      pageSdkMarks: [],
      visibilityRules: 1,
    });
    // Projected geometry: the DOM box is where the renderer's camera
    // projects the composited world rectangle.
    await expect.poll(() => placementError(page, COUNTER)).toBeLessThan(2);
    const geometryError = await placementError(page, COUNTER);
    // DOM hit targeting: the element under the projected point is the
    // original button, and a real click reaches its React handler.
    const local = '[data-testid="counter-local"]';
    const point = await centerOf(page, local);
    const hit = await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-testid]")
          ?.getAttribute("data-testid"),
      point,
    );
    expect(hit).toBe("counter-local");
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(local)).toHaveText("Local clicks: 1");
    // The page clip keeps the element's footprint: the page is not cut
    // where the element is in front of it.
    const pageClip = await surface(page).evaluate(
      (el: HTMLElement) => el.style.clipPath,
    );
    if (engine === "three" && testInfo.project.name === "chromium")
      await page.screenshot({ path: `${EVIDENCE}/m1-page-surface.png` });
    await evidence(testInfo, engine, "m1-page-surface", {
      ownership,
      geometryErrorPx: geometryError,
      hitTarget: hit,
      pageClipPath: pageClip.slice(0, 60),
    });
    expect(errors).toEqual([]);
  });

  test(`${engine}: M2 Native lifecycle — extract, manipulate, restore, re-extract keeps the same mounted element`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    await open(page, engine);
    const note = surface(page).getByTestId("counter-note");
    await note.fill("typed before");
    await surface(page).getByTestId("counter-local").click();
    const mountsBefore = await page.getByTestId("counter-mounts").textContent();
    await panel(page, COUNTER).evaluate((el) => {
      (window as TestWindow).__marked = { panel: el };
    });
    const layout = () =>
      panel(page, COUNTER).evaluate((el: HTMLElement) => [
        el.offsetWidth,
        el.offsetHeight,
      ]);

    await extract(page, COUNTER, "native");
    // Its layout size in space (with the SDK panel bar), before any
    // manipulation.
    const size = await layout();
    const first = (await target(page, COUNTER))!;
    expect(first.presentationId).toMatch(/^native-\d+$/);
    const sameNode = () =>
      panel(page, COUNTER).evaluate(
        (el) => (window as TestWindow).__marked!.panel === el,
      );
    expect(await sameNode()).toBe(true);
    // Editable in space, state and listeners preserved.
    await note.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" + in space");
    await expect(note).toHaveValue("typed before + in space");
    await expect(surface(page).getByTestId("counter-local")).toHaveText(
      "Local clicks: 1",
    );
    // A real drag on the SDK's Native handle moves the presentation, not
    // the component's layout.
    const box = (await panel(page, COUNTER)
      .locator('[data-spatialflex-handle="translate"][role=button]')
      .boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await drag(page, from, { x: from.x - 70, y: from.y + 30 });
    const moved = (await target(page, COUNTER))!;
    expect(
      distance(moved.transform.position, first.initial.position),
    ).toBeGreaterThan(0.05);
    expect(await layout()).toEqual(size);
    await expect.poll(() => placementError(page, COUNTER)).toBeLessThan(2);

    await restore(page, "Shared counter");
    await expect.poll(() => target(page, COUNTER)).toBeUndefined();
    expect(await sdkMarks(page, COUNTER)).toEqual({
      transform: "",
      clipPath: "",
      data: [],
    });
    expect(await sameNode()).toBe(true);
    await expect(note).toHaveValue("typed before + in space");

    // Re-extraction: a new presentation identity at a fresh start pose.
    await extract(page, COUNTER, "native");
    const second = (await target(page, COUNTER))!;
    expect(second.presentationId).not.toBe(first.presentationId);
    expect(second.transform).toEqual(second.initial);
    expect(await sameNode()).toBe(true);
    await expect(page.getByTestId("counter-mounts")).toHaveText(mountsBefore!);
    await evidence(testInfo, engine, "m2-native-lifecycle", {
      first: first.presentationId,
      second: second.presentationId,
      sameNode: true,
      layoutSize: size,
      movedBy: distance(moved.transform.position, first.initial.position),
      reactMounts: mountsBefore,
    });
    expect(errors).toEqual([]);
  });

  test(`${engine}: M3 Adaptive lifecycle — show, move, hide, show again is a new instance; its action runs once`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    await open(page, engine, "split");
    await showInXR(page, COUNTER);
    const first = (await target(page, COUNTER))!;
    expect(first.presentationId).toMatch(/^presentation-\d+$/);
    // Lab layout policy (Move buttons) shifts the layout origin; the
    // runtime moves the presentation by exactly that much.
    await xrItem(page, COUNTER)
      .getByRole("button", { name: "Move Shared counter right" })
      .click();
    await expect
      .poll(async () => (await target(page, COUNTER))!.transform.position[0])
      .toBeGreaterThan(first.transform.position[0]);
    const moved = (await target(page, COUNTER))!;
    const step = moved.transform.position[0] - first.transform.position[0];
    expect(moved.initial.position[0] - first.initial.position[0]).toBeCloseTo(
      step,
      9,
    );
    await expect
      .poll(async () =>
        distance(
          (await page.evaluate(
            (id) =>
              (window as TestWindow).__xrHostProbe!.worldPosition(
                id,
                "background",
              ),
            COUNTER,
          ))!,
          moved.transform.position,
        ),
      )
      .toBeLessThan(1e-4);

    await xrItem(page, COUNTER)
      .getByRole("button", { name: "Remove from XR" })
      .click();
    await expect.poll(() => probe(page, "panels")).not.toContain(COUNTER);
    expect(await target(page, COUNTER)).toBeUndefined();
    await showInXR(page, COUNTER);
    const second = (await target(page, COUNTER))!;
    expect(second.presentationId).not.toBe(first.presentationId);
    // A new instance starts at its slot, without the old Move offset.
    expect(second.initial.position).toEqual(first.initial.position);

    // Its semantic action, with the real mouse on the 3D button: once.
    const count = Number(await page.getByTestId("web-count").textContent());
    const button = await page.evaluate(
      (id) =>
        (window as TestWindow).__xrHostProbe!.locate(id, "button:increment"),
      COUNTER,
    );
    await page.mouse.click(button!.x, button!.y);
    await expect(page.getByTestId("web-count")).toHaveText(String(count + 1));
    await page.waitForTimeout(200);
    await expect(page.getByTestId("web-count")).toHaveText(String(count + 1));
    await evidence(testInfo, engine, "m3-adaptive-lifecycle", {
      first: first.presentationId,
      second: second.presentationId,
      moveStep: step,
      actionRuns: 1,
    });
    expect(errors).toEqual([]);
  });

  test(`${engine}: M6 host lifecycle — website/split switch and workspace remount end Native only, keep Adaptive, leak nothing`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    await open(page, engine);
    await extract(page, "live-chart", "adaptive");
    await extract(page, COUNTER, "native");
    const adaptive = (await target(page, "live-chart"))!;
    const subscriptions = await page
      .getByTestId("active-subscriptions")
      .textContent();

    // Split mode: the page surface (the runtime's Native DOM host)
    // disconnects; Native ends, the renderer keeps drawing Adaptive.
    await page.getByTestId("surface-toggle").click();
    await expect(page.locator(".lab")).toHaveAttribute("data-surface", "split");
    await expect.poll(() => target(page, COUNTER)).toBeUndefined();
    expect(await sdkMarks(page, COUNTER)).toEqual({
      transform: "",
      clipPath: "",
      data: [],
    });
    expect(await probe(page, "panels")).toContain("live-chart");
    expect((await target(page, "live-chart"))!.presentationId).toBe(
      adaptive.presentationId,
    );

    // Back to the website, extract again, then unmount the workspace (the
    // renderer is disposed): Native ends with the surface host.
    await page.getByTestId("surface-toggle").click();
    await expect(page.getByTestId("surface-status")).toHaveAttribute(
      "data-value",
      "visible",
    );
    await extract(page, COUNTER, "native");
    await page.getByRole("button", { name: "Unmount workspace" }).click();
    await expect.poll(() => target(page, COUNTER)).toBeUndefined();
    expect(await sdkMarks(page, COUNTER)).toEqual({
      transform: "",
      clipPath: "",
      data: [],
    });
    // Remount: the same Adaptive instance is drawn again; nothing stale.
    await page.getByRole("button", { name: "Mount workspace" }).click();
    await expect.poll(() => probe(page, "panels")).toEqual(["live-chart"]);
    expect((await target(page, "live-chart"))!.presentationId).toBe(
      adaptive.presentationId,
    );
    expect((await targets(page)).map((t) => t.itemId)).toEqual(["live-chart"]);
    await expect(page.getByTestId("active-subscriptions")).toHaveText(
      subscriptions!,
    );
    // The Native DOM path still works after the host was recreated.
    await extract(page, COUNTER, "native");
    await expect.poll(() => placementError(page, COUNTER)).toBeLessThan(2);
    await evidence(testInfo, engine, "m6-host-lifecycle", {
      adaptiveKept: adaptive.presentationId,
      nativeEndedOnSplit: true,
      nativeEndedOnUnmount: true,
      subscriptions,
    });
    // Releasing the GL context on unmount is the expected cleanup; some
    // browsers report it as a warning (as in surface.spec.ts).
    expect(errors.filter((e) => !/WebGL context was lost/.test(e))).toEqual([]);
  });
}
