import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { ENGINES, probe, type Engine, type Probe, watchConsole } from "./lab";

/**
 * P1-06 spatial web surface. Every interaction uses real mouse/keyboard
 * input: native HTML controls on the transformed page, the 3D panels via
 * canvas raycasts, and camera orbit by dragging the canvas. The host probe
 * is read-only and only reports projections and drawn panel content.
 */

type Vec3 = [number, number, number];
type Point = { x: number; y: number };
type TestWindow = Window & { __xrHostProbe?: Probe; __surfaceMarker?: Node };

const EVIDENCE = "../../docs/evidence";
const surface = (page: Page) => page.getByTestId("web-surface");
const slot = (page: Page, id: string) =>
  page.locator(`[data-spatialflex-item="${id}"]`);
const outline = (page: Page, id: string) =>
  surface(page).locator(`.surface-outline[data-surface-item="${id}"]`);
const status = (page: Page) => page.getByTestId("surface-status");

async function open(page: Page, engine: Engine, website = true) {
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off${website ? "&surface=website" : ""}`,
  );
  await expect(page.getByTestId("engine-id")).toHaveText(engine);
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  if (website)
    await expect(status(page)).toHaveAttribute("data-value", "visible");
}

/** Client positions of the page's four corner markers (padding-box corners). */
function corners(page: Page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-surface-corner]")].map(
        (marker) => {
          const r = marker.getBoundingClientRect();
          return [marker.dataset.surfaceCorner!, { x: r.left, y: r.top }];
        },
      ),
    ),
  ) as Promise<Record<"tl" | "tr" | "bl" | "br", Point>>;
}

/**
 * Where the renderer's own camera projects the same corners, from the pose
 * the inspector reports. An independent path: the engine's projection
 * (Three.js Vector3.project / Babylon Vector3.Project) and a separate Euler
 * implementation, compared with the browser's composited DOM geometry.
 */
function expectedCorners(page: Page) {
  return page.evaluate(() => {
    const dd = document.querySelector<HTMLElement>(
      "[data-testid=surface-pose]",
    )!;
    const pose = JSON.parse(dd.dataset.pose!) as {
      position: Vec3;
      rotation: Vec3;
      width: number;
      height: number;
    };
    const res = JSON.parse(dd.dataset.resolution!) as {
      width: number;
      height: number;
    };
    const page = document.querySelector<HTMLElement>(
      "[data-testid=web-surface]",
    )!;
    const border = parseFloat(getComputedStyle(page).borderTopWidth);
    const [rx, ry, rz] = pose.rotation;
    // Rotation matrix for XYZ Euler angles: R = Rx · Ry · Rz.
    const cx = Math.cos(rx),
      sx = Math.sin(rx);
    const cy = Math.cos(ry),
      sy = Math.sin(ry);
    const cz = Math.cos(rz),
      sz = Math.sin(rz);
    const R = [
      [cy * cz, -cy * sz, sy],
      [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
      [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
    ];
    const world = (u: number, v: number): Vec3 => {
      const local = [
        (u / res.width - 0.5) * pose.width,
        (0.5 - v / res.height) * pose.height,
        0,
      ];
      return [0, 1, 2].map(
        (i) =>
          pose.position[i]! + R[i]![0]! * local[0]! + R[i]![1]! * local[1]!,
      ) as Vec3;
    };
    const p = (window as unknown as TestWindow).__xrHostProbe!;
    const b = border;
    return {
      tl: p.project(world(b, b)),
      tr: p.project(world(res.width - b, b)),
      bl: p.project(world(b, res.height - b)),
      br: p.project(world(res.width - b, res.height - b)),
    };
  }) as Promise<Record<"tl" | "tr" | "bl" | "br", Point | null>>;
}

/** The DOM surface is exactly where the 3D camera projects its world pose. */
async function expectAnchored(page: Page) {
  await expect
    .poll(async () => {
      const [actual, expected] = await Promise.all([
        corners(page),
        expectedCorners(page),
      ]);
      return Math.max(
        ...(["tl", "tr", "bl", "br"] as const).map((k) =>
          expected[k]
            ? Math.hypot(
                actual[k].x - expected[k]!.x,
                actual[k].y - expected[k]!.y,
              )
            : Infinity,
        ),
      );
    })
    .toBeLessThan(2);
  return corners(page);
}

const edge = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const moved = (a: Record<string, Point>, b: Record<string, Point>) =>
  Math.max(...Object.keys(a).map((k) => edge(a[k]!, b[k]!)));

async function locate(page: Page, id: string, part: string) {
  let point: Point | null = null;
  await expect
    .poll(
      async () =>
        (point = await page.evaluate(
          ([id, part]) =>
            (window as unknown as TestWindow).__xrHostProbe?.locate(
              id!,
              part!,
            ) ?? null,
          [id, part],
        )),
    )
    .not.toBeNull();
  return point!;
}

async function click3D(page: Page, id: string, part: string) {
  const { x, y } = await locate(page, id, part);
  await page.mouse.click(x, y);
}

const drawn = (page: Page, id: string) =>
  page.evaluate(
    (id) => (window as unknown as TestWindow).__xrHostProbe?.drawn[id]?.text,
    id,
  );

async function diagnostics(page: Page) {
  const subs = page.getByTestId("active-subscriptions");
  return {
    active: await subs.textContent(),
    subscribes: await subs.getAttribute("data-total-subscribes"),
    unsubscribes: await subs.getAttribute("data-total-unsubscribes"),
    mounts: await page.getByTestId("counter-mounts").textContent(),
    instances: await page.getByTestId("counter-instances").textContent(),
  };
}

/** Layout geometry of a slot in page CSS pixels (unaffected by the 3D transform). */
const layoutBox = (page: Page, id: string) =>
  slot(page, id).evaluate((el: HTMLElement) => ({
    left: el.offsetLeft,
    top: el.offsetTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  }));

async function select(page: Page, id: string) {
  await surface(page).getByTestId("surface-select-mode").click();
  await outline(page, id).hover();
  await expect(outline(page, id)).toHaveAttribute("data-hovered", "true");
  await outline(page, id).click();
  await expect(outline(page, id)).toHaveAttribute("data-selected", "true");
}

async function extract(page: Page, id: string, source: "visible" | "reserved") {
  await select(page, id);
  await surface(page).getByTestId("surface-source").selectOption(source);
  await surface(page).getByTestId("surface-extract").click();
  await expect.poll(() => probe(page, "panels")).toContain(id);
  await expect(outline(page, id)).toHaveAttribute("data-extracted", source);
}

/** An empty part of the canvas (floor, lower right), away from the surface and panels. */
async function emptyCanvasPoint(page: Page) {
  const box = (await page.getByTestId("xr-canvas").boundingBox())!;
  return { x: box.x + box.width - 60, y: box.y + box.height - 40 };
}

async function orbit(page: Page, dx: number, dy = 0) {
  const start = await emptyCanvasPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
}

const shot = (page: Page, name: string, enabled: boolean) =>
  enabled
    ? page.screenshot({ path: `${EVIDENCE}/p1-06-${name}.png` })
    : Promise.resolve();

for (const engine of ENGINES) {
  test(`${engine}: live React website is perspective-anchored in the 3D world`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    const capture = engine === "three" && testInfo.project.name === "chromium";
    // Split mode first: state created there must survive the mode switch.
    await open(page, engine, false);
    await shot(page, "split", capture);
    const note = page.getByTestId("counter-note");
    await note.fill("typed before switching");
    await page.getByTestId("counter-local").click();
    await page.getByTestId("web-increment").click();
    await page.getByTestId("counter-local").evaluate((node) => {
      (window as unknown as TestWindow).__surfaceMarker = node;
    });
    const before = await diagnostics(page);
    await expect(page.locator("[data-testid=web-surface]")).toHaveCount(0);

    await page.getByTestId("surface-toggle").click();
    await expect(page.getByTestId("surface-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(status(page)).toHaveAttribute("data-value", "visible");
    expect(page.url()).toContain("surface=website");
    // Same mounted component and state on the surface: no remount or clone.
    await expect(surface(page).getByTestId("counter-note")).toHaveValue(
      "typed before switching",
    );
    await expect(surface(page).getByTestId("counter-local")).toHaveText(
      "Local clicks: 1",
    );
    expect(
      await page
        .getByTestId("counter-local")
        .evaluate(
          (node) => node === (window as unknown as TestWindow).__surfaceMarker,
        ),
    ).toBe(true);
    expect(await diagnostics(page)).toEqual(before);
    for (const id of ["shared-counter", "live-chart", "image-panel"])
      await expect(
        surface(page).locator(`[data-spatialflex-item="${id}"]`),
      ).toBeVisible();

    const initial = await expectAnchored(page);
    await shot(page, "website", capture);
    // The layer covers exactly the canvas; the page never scrolls.
    const canvas = (await page.getByTestId("xr-canvas").boundingBox())!;
    const layer = (await page.locator(".web-surface-layer").boundingBox())!;
    expect(Math.abs(layer.x - canvas.x)).toBeLessThan(1);
    expect(Math.abs(layer.width - canvas.width)).toBeLessThan(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    ).toBeLessThanOrEqual(0);

    // Native controls on the transformed page: real clicks and typing.
    await surface(page).getByTestId("web-increment").click();
    await expect(page.getByTestId("web-count")).toHaveText("2");
    await expect(page.getByTestId("increment-calls")).toHaveText("2");
    await surface(page).getByTestId("counter-local").click();
    await expect(page.getByTestId("counter-local")).toHaveText(
      "Local clicks: 2",
    );
    await surface(page).getByTestId("counter-note").click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("typed on the surface");
    await expect(page.getByTestId("counter-note")).toHaveValue(
      "typed on the surface",
    );
    await surface(page).getByTestId("image-variant").selectOption("night");
    await expect(page.getByTestId("image-variant")).toHaveValue("night");

    // Camera orbit: the projection changes and stays anchored, with a
    // perspective (non-affine) shape.
    // About 28° of yaw (OrbitControls and ArcRotateCamera, with inertia, differ in
    // sensitivity); the surface stays front-facing.
    await orbit(page, engine === "three" ? -70 : -45, -10);
    await expect(status(page)).toHaveAttribute("data-value", "visible");
    const orbited = await expectAnchored(page);
    expect(moved(initial, orbited)).toBeGreaterThan(20);
    const left = edge(orbited.tl, orbited.bl);
    const right = edge(orbited.tr, orbited.br);
    expect(Math.abs(left - right) / Math.max(left, right)).toBeGreaterThan(
      0.03,
    );
    await shot(page, "angled", capture);

    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    const reset = await expectAnchored(page);
    expect(moved(initial, reset)).toBeLessThan(2);

    // Browser resize and aspect ratio changes.
    await page.setViewportSize({ width: 1100, height: 760 });
    await expectAnchored(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectAnchored(page);

    // Pose updates: position and scale.
    await page.getByRole("button", { name: "Move surface right" }).click();
    await page.getByRole("button", { name: "Scale surface up" }).click();
    const posed = await expectAnchored(page);
    expect(edge(posed.tl, posed.tr)).toBeGreaterThan(
      edge(reset.tl, reset.tr) * 1.05,
    );

    // Leaving the mode keeps the same component and its state.
    await page.getByTestId("surface-toggle").click();
    await expect(page.locator("[data-testid=web-surface]")).toHaveCount(0);
    await expect(page.getByTestId("counter-note")).toHaveValue(
      "typed on the surface",
    );
    expect((await diagnostics(page)).mounts).toBe(before.mounts);
    expect((await diagnostics(page)).instances).toBe("1");
    expect(errors).toEqual([]);
  });

  test(`${engine}: select → extract → interact in 3D → restore, for every widget`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    const capture = engine === "three" && testInfo.project.name === "chromium";
    await open(page, engine);
    await surface(page).getByTestId("counter-note").fill("local note survives");
    await surface(page).getByTestId("counter-local").click();
    const before = await diagnostics(page);
    const counterBox = await layoutBox(page, "shared-counter");
    const chartBox = await layoutBox(page, "live-chart");
    const textures = await probe(page, "liveTextures");

    // Select directly on the website.
    await surface(page).getByTestId("surface-select-mode").click();
    await outline(page, "shared-counter").hover();
    await expect(outline(page, "shared-counter")).toHaveAttribute(
      "data-hovered",
      "true",
    );
    await shot(page, "hover", capture);
    await outline(page, "shared-counter").click();
    await expect(surface(page).getByTestId("surface-selected")).toHaveText(
      "Selected: Shared counter",
    );
    await shot(page, "selected", capture);

    // Extract with the original's space reserved.
    await expect(surface(page).getByTestId("surface-source")).toHaveValue(
      "reserved",
    );
    await surface(page).getByTestId("surface-extract").click();
    await expect.poll(() => probe(page, "panels")).toContain("shared-counter");
    await expect(slot(page, "shared-counter")).toHaveAttribute(
      "data-source-visibility",
      "reserved",
    );
    await expect(
      slot(page, "shared-counter").locator("[data-spatialflex-panel]"),
    ).toHaveCSS("visibility", "hidden");
    // Footprint reserved: neither the source nor its neighbor reflows.
    expect(await layoutBox(page, "shared-counter")).toEqual(counterBox);
    expect(await layoutBox(page, "live-chart")).toEqual(chartBox);
    const extraction = page.getByTestId("surface-extraction-shared-counter");
    await expect(extraction).toContainText("presentation-");
    await expect(extraction).toContainText("hidden, space reserved");

    // A separate world-space object beside the surface, in front of it.
    const pose = JSON.parse(
      (await page.getByTestId("surface-pose").getAttribute("data-pose"))!,
    ) as { position: Vec3 };
    const world = (await page.evaluate(() =>
      (window as unknown as TestWindow).__xrHostProbe!.worldPosition(
        "shared-counter",
        "background",
      ),
    ))!;
    expect(world[2]).toBeGreaterThan(pose.position[2]);
    const sc = await corners(page);
    const panelCenter = await locate(page, "shared-counter", "background");
    expect(panelCenter.x).toBeGreaterThan(Math.max(sc.tr.x, sc.br.x) + 20);
    await shot(page, "extracted", capture);

    // Interact with the 3D panel: exactly one domain action.
    const chartBefore = await page
      .getByTestId("web-chart")
      .getAttribute("data-values");
    await click3D(page, "shared-counter", "button:increment");
    await expect(page.getByTestId("web-count")).toHaveText("1");
    await expect(page.getByTestId("increment-calls")).toHaveText("1");
    await expect(page.getByTestId("action-count")).toHaveText("1");
    await expect
      .poll(() => drawn(page, "shared-counter"))
      .toBe("Shared count=1");
    await expect(page.getByTestId("web-chart")).not.toHaveAttribute(
      "data-values",
      chartBefore!,
    );
    await shot(page, "updated", capture);

    // Restore: the same component returns with its local state.
    await surface(page).getByTestId("surface-restore").click();
    await expect
      .poll(() => probe(page, "panels"))
      .not.toContain("shared-counter");
    await expect(slot(page, "shared-counter")).not.toHaveAttribute(
      "data-source-visibility",
    );
    await expect(surface(page).getByTestId("counter-note")).toHaveValue(
      "local note survives",
    );
    await expect(surface(page).getByTestId("counter-local")).toHaveText(
      "Local clicks: 1",
    );
    await expect(surface(page).getByTestId("web-count")).toBeVisible();
    await shot(page, "restored", capture);
    expect(await diagnostics(page)).toEqual(before);

    // Live Chart, keeping the original visible: a live mirror without actions.
    await extract(page, "live-chart", "visible");
    await expect(slot(page, "live-chart")).not.toHaveAttribute(
      "data-source-visibility",
    );
    await expect(surface(page).getByTestId("web-chart")).toBeVisible();
    const bars = await drawn(page, "live-chart");
    await surface(page).getByTestId("web-increment").click();
    await expect(page.getByTestId("web-count")).toHaveText("2");
    await expect.poll(() => drawn(page, "live-chart")).not.toBe(bars);
    expect(await drawn(page, "live-chart")).toBe(
      `Recent counts=[${await page.getByTestId("web-chart").getAttribute("data-values")}]`,
    );

    // Image, space reserved: its 3D action changes application state once.
    await extract(page, "image-panel", "reserved");
    const variant = await page.getByTestId("image-variant").inputValue();
    await click3D(page, "image-panel", "button:next-variant");
    await expect(page.getByTestId("image-variant")).not.toHaveValue(variant);
    await expect
      .poll(() => drawn(page, "image-panel"))
      .toContain(await page.getByTestId("image-variant").inputValue());
    // Closing the 3D panel restores the original too.
    await click3D(page, "image-panel", "close");
    await expect.poll(() => probe(page, "panels")).not.toContain("image-panel");
    await expect(slot(page, "image-panel")).not.toHaveAttribute(
      "data-source-visibility",
    );
    await surface(page).getByTestId("surface-select-mode").click();
    await outline(page, "live-chart").click();
    await surface(page).getByTestId("surface-restore").click();
    await expect.poll(() => probe(page, "panels")).toEqual([]);
    await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
    expect(await diagnostics(page)).toEqual(before);
    await expect(page.getByTestId("increment-calls")).toHaveText("2");

    {
      await mkdir(EVIDENCE, { recursive: true });
      await writeFile(
        `${EVIDENCE}/p1-06-${engine}-${testInfo.project.name}.json`,
        JSON.stringify(
          {
            engine,
            browser: testInfo.project.name,
            context: "same-document",
            flow: "select → extract (reserve) → 3D +1 → restore; chart keep-original; image reserve + 3D Next + 3D close",
            sourceFootprint: { before: counterBox, during: counterBox },
            neighborLayout: chartBox,
            incrementCalls: 2,
            counterMounts: before.mounts,
            counterInstances: before.instances,
            activeSubscriptions: before.active,
            totalSubscribes: before.subscribes,
            liveTexturesAfterRestore: textures,
          },
          null,
          2,
        ) + "\n",
      );
    }
    expect(errors).toEqual([]);
  });

  test(`${engine}: 3D panels in front of the surface show through it; behind it they are hidden`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await open(page, engine);
    await extract(page, "shared-counter", "visible");
    const hit = async () => {
      const { x, y } = await locate(page, "shared-counter", "background");
      return page.evaluate(
        ([x, y]) => {
          const element = document.elementFromPoint(x!, y!);
          return element?.closest("[data-testid=web-surface]")
            ? "surface"
            : element?.tagName.toLowerCase();
        },
        [x, y],
      );
    };
    expect(await hit()).toBe("canvas");
    // Slide the surface under the panel: the panel is nearer the camera, so
    // the page is cut out there and the panel stays visible and usable.
    for (let i = 0; i < 6; i++)
      await page.getByRole("button", { name: "Move surface right" }).click();
    await expect
      .poll(async () => {
        const c = await corners(page);
        const p = await locate(page, "shared-counter", "background");
        return Math.max(c.tr.x, c.br.x) > p.x;
      })
      .toBe(true);
    await expect(surface(page)).not.toHaveCSS("clip-path", "none");
    await expect.poll(hit).toBe("canvas");
    await click3D(page, "shared-counter", "button:increment");
    await expect(page.getByTestId("increment-calls")).toHaveText("1");
    // Move the surface in front of the panel: now the page covers it.
    for (let i = 0; i < 4; i++)
      await page.getByRole("button", { name: "Move surface closer" }).click();
    await expect.poll(hit).toBe("surface");
    await expect(surface(page)).toHaveCSS("clip-path", "none");
    expect(errors).toEqual([]);
  });
}

test("selection mode: keyboard, registered components only, no interception", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await open(page, "three");
  // Normal mode: no selection affordance intercepts ordinary controls.
  await expect(surface(page).locator("button.surface-outline")).toHaveCount(0);
  await surface(page).getByTestId("image-mounted").click();
  await expect(page.getByTestId("image-mounted")).not.toBeChecked();
  await surface(page).getByTestId("image-mounted").click();
  await expect(page.getByTestId("image-mounted")).toBeChecked();
  await surface(page).getByTestId("counter-note").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("still typing");
  await expect(page.getByTestId("counter-note")).toHaveValue("still typing");

  // Keyboard: toggle selection mode, move through outlines, pick, extract.
  await surface(page).getByTestId("surface-select-mode").focus();
  await page.keyboard.press("Enter");
  await expect(
    surface(page).getByTestId("surface-select-mode"),
  ).toHaveAttribute("aria-pressed", "true");
  // Exactly the registered components are outlined.
  await expect(surface(page).locator("button.surface-outline")).toHaveCount(3);
  await expect(outline(page, "live-chart")).toHaveAttribute(
    "aria-label",
    "Select Live chart",
  );
  // Page controls are inert in selection mode; clicks on unregistered
  // content select nothing and change nothing.
  await surface(page).getByTestId("action-count").click({ force: true });
  await expect(surface(page).getByTestId("surface-message")).toHaveText(
    "Only registered SpatialFlex components can be selected.",
  );
  await expect(surface(page).getByTestId("surface-selected")).toHaveText(
    "Nothing selected",
  );
  await surface(page).getByTestId("image-mounted").click({ force: true });
  await expect(page.getByTestId("image-mounted")).toBeChecked();

  await page.keyboard.press("Escape");
  await expect(surface(page).getByTestId("surface-select-mode")).toBeFocused();
  await expect(surface(page).locator("button.surface-outline")).toHaveCount(0);
  await page.keyboard.press("Enter");
  // Entering selection mode focuses the first registered component.
  await expect(outline(page, "shared-counter")).toBeFocused();
  await expect(outline(page, "shared-counter")).toHaveAttribute(
    "data-hovered",
    "true",
  );
  await page.keyboard.press("Tab");
  await expect(outline(page, "live-chart")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(surface(page).getByTestId("surface-selected")).toHaveText(
    "Selected: Live chart",
  );
  await expect(surface(page).getByTestId("surface-extract")).toBeFocused();
  // Collapse is listed but explicitly unsupported.
  await expect(
    surface(page).locator(
      "[data-testid=surface-source] option[value=collapsed]",
    ),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect.poll(() => probe(page, "panels")).toContain("live-chart");
  await surface(page).getByTestId("surface-restore").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => probe(page, "panels")).toEqual([]);
  await expect(page.getByTestId("counter-note")).toHaveValue("still typing");
  expect(errors).toEqual([]);
});

test("lifecycle: unmount invalidates an extraction; repeated cycles do not leak", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await open(page, "three");
  const before = await diagnostics(page);
  const textures = await probe(page, "liveTextures");

  await extract(page, "image-panel", "reserved");
  const first = await page
    .getByTestId("surface-extraction-image-panel")
    .textContent();
  // Unmount the extracted component with the website's own checkbox.
  await surface(page).getByTestId("image-mounted").click();
  await expect.poll(() => probe(page, "panels")).not.toContain("image-panel");
  await expect(page.getByTestId("surface-extraction-image-panel")).toHaveCount(
    0,
  );
  await expect(surface(page).getByTestId("surface-selected")).toHaveText(
    "Nothing selected",
  );
  // Remount with the same logical id: a fresh, visible registration.
  await surface(page).getByTestId("image-mounted").click();
  await expect(slot(page, "image-panel")).toBeVisible();
  await expect(slot(page, "image-panel")).not.toHaveAttribute(
    "data-source-visibility",
  );
  expect(await probe(page, "panels")).toEqual([]);
  await extract(page, "image-panel", "reserved");
  const second = await page
    .getByTestId("surface-extraction-image-panel")
    .textContent();
  expect(second!.match(/presentation-\d+/)![0]).not.toBe(
    first!.match(/presentation-\d+/)![0],
  );
  await surface(page).getByTestId("surface-restore").click();

  // A press held on the old panel cannot act on a newer presentation.
  await extract(page, "shared-counter", "reserved");
  const target = await locate(page, "shared-counter", "button:increment");
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await surface(page).getByTestId("surface-restore").focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => probe(page, "panels"))
    .not.toContain("shared-counter");
  await surface(page).getByTestId("surface-extract").focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => probe(page, "panels")).toContain("shared-counter");
  await page.mouse.up();
  await expect(page.getByTestId("increment-calls")).toHaveText("0");
  await click3D(page, "shared-counter", "button:increment");
  await expect(page.getByTestId("increment-calls")).toHaveText("1");
  await surface(page).getByTestId("surface-restore").click();

  // Repeated cycles: no leaked subscriptions, instances or textures.
  for (let i = 0; i < 3; i++) {
    await surface(page).getByTestId("surface-extract").click();
    await expect.poll(() => probe(page, "panels")).toContain("shared-counter");
    await surface(page).getByTestId("surface-restore").click();
    await expect.poll(() => probe(page, "panels")).toEqual([]);
  }
  await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
  const after = await diagnostics(page);
  expect(after.active).toBe(before.active);
  expect(after.mounts).toBe(before.mounts);
  expect(after.instances).toBe("1");
  expect(errors).toEqual([]);
});

test("unmounting the workspace shows the website in place; remounting re-anchors it", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await open(page, "three");
  const before = await diagnostics(page);
  await page.getByRole("button", { name: "Unmount workspace" }).click();
  await expect(page.locator("[data-testid=web-surface]")).toHaveCount(0);
  await expect.poll(() => probe(page, "activeHosts")).toBe(0);
  // Releasing the GL context on unmount is the expected cleanup; some
  // browsers report it as a warning (as in desktop.spec.ts).
  errors.splice(
    0,
    errors.length,
    ...errors.filter((p) => !/WebGL context was lost/.test(p)),
  );
  await expect(page.getByTestId("web-increment")).toBeVisible();
  await page.getByTestId("web-increment").click();
  await expect(page.getByTestId("web-count")).toHaveText("1");
  await page.getByRole("button", { name: "Mount workspace" }).click();
  await expect(status(page)).toHaveAttribute("data-value", "visible");
  await expectAnchored(page);
  expect((await diagnostics(page)).mounts).toBe(before.mounts);
  expect(errors).toEqual([]);
});

for (const [name, query, reason] of [
  [
    "cross-context iframe Host",
    "integration=spatialflex&bridge=iframe",
    /same-context Host/,
  ],
  ["baseline integration", "integration=baseline&bridge=off", /SpatialFlex/],
] as const)
  test(`Spatial Website is explicitly unsupported with the ${name}`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto(`/?engine=three&${query}&xr-emulator=off&surface=website`);
    // Interact once the page has loaded and its Host is running.
    if (query.includes("iframe"))
      await expect(page.getByTestId("bridge-status")).toHaveText("connected");
    else await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
    await expect(page.getByTestId("surface-toggle")).toBeDisabled();
    await expect(page.getByTestId("surface-support")).toHaveText(reason);
    await expect(page.locator("[data-testid=web-surface]")).toHaveCount(0);
    // The existing XR mirror keeps working in this configuration.
    await page
      .getByTestId("xr-item-shared-counter")
      .getByRole("button", { name: "Show in XR" })
      .click();
    await expect(page.getByTestId("xr-item-shared-counter")).toHaveAttribute(
      "data-shown",
      "true",
    );
    expect(errors).toEqual([]);
  });
