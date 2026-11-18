import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { ENGINES, probe, type Engine, type Probe, watchConsole } from "./lab";

/**
 * P1-06A Native DOM extraction: the original mounted element itself is
 * presented in space. Identity is checked by element references kept in the
 * page, React lifecycle by the fixture's mount and subscription diagnostics;
 * all interaction is real mouse and keyboard input.
 */

type Vec3 = [number, number, number];
type Point = { x: number; y: number };
type Marked = Window & {
  __xrHostProbe?: Probe;
  __marked?: Record<string, Element>;
};

const EVIDENCE = "../../docs/evidence";
const surface = (page: Page) => page.getByTestId("web-surface");
const slot = (page: Page, id: string) =>
  page.locator(`[data-spatialflex-item="${id}"]`);
const panel = (page: Page, id: string) =>
  slot(page, id).locator("[data-spatialflex-panel]");
const outline = (page: Page, id: string) =>
  surface(page).locator(`.surface-outline[data-surface-item="${id}"]`);

async function open(page: Page, engine: Engine) {
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=website`,
  );
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  await expect(page.getByTestId("surface-status")).toHaveAttribute(
    "data-value",
    "visible",
  );
}

/** Keeps references to the original nodes, to compare identity later. */
const mark = (page: Page) =>
  page.evaluate(() => {
    const item = document.querySelector(
      '[data-spatialflex-item="shared-counter"]',
    )!;
    (window as Marked).__marked = {
      article: item.querySelector("article")!,
      increment: item.querySelector("[data-testid=web-increment]")!,
      note: item.querySelector("[data-testid=counter-note]")!,
      local: item.querySelector("[data-testid=counter-local]")!,
    };
  });
const sameNodes = (page: Page) =>
  page.evaluate(() => {
    const marked = (window as Marked).__marked!;
    const item = document.querySelector(
      '[data-spatialflex-item="shared-counter"]',
    )!;
    return (
      marked.article === item.querySelector("article") &&
      marked.increment ===
        document.querySelector("[data-testid=web-increment]") &&
      marked.note === document.querySelector("[data-testid=counter-note]") &&
      marked.local === document.querySelector("[data-testid=counter-local]") &&
      // A single instance of the content exists in the document.
      document.querySelectorAll("[data-testid=web-count]").length === 1 &&
      marked.article.isConnected
    );
  });

/** Design of the original component: computed styles of its parts. */
const design = (page: Page) =>
  page.evaluate(() => {
    const item = document.querySelector(
      '[data-spatialflex-item="shared-counter"]',
    )!;
    const pick = (el: Element) => {
      const s = getComputedStyle(el);
      return [
        s.fontFamily,
        s.fontSize,
        s.fontWeight,
        s.color,
        s.backgroundColor,
        s.borderTopWidth,
        s.borderTopStyle,
        s.borderRadius,
        s.paddingTop,
        s.paddingLeft,
        s.width,
      ].join("|");
    };
    return ["article", "h3", "output", "article button", "input"].map((sel) =>
      pick(item.querySelector(sel)!),
    );
  });

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

const layoutBox = (page: Page, id: string) =>
  slot(page, id).evaluate((el: HTMLElement) => ({
    left: el.offsetLeft,
    top: el.offsetTop,
    width: el.offsetWidth,
    height: el.offsetHeight,
  }));

async function select(page: Page, id: string) {
  await surface(page).getByTestId("surface-select-mode").click();
  await outline(page, id).click();
  await expect(outline(page, id)).toHaveAttribute("data-selected", "true");
}

async function extractNative(
  page: Page,
  id: string,
  source: "reserved" | "collapsed" = "reserved",
) {
  await select(page, id);
  await surface(page).getByTestId("surface-presentation-native").click();
  await expect(
    surface(page).getByTestId("surface-presentation-native"),
  ).toBeChecked();
  await surface(page).getByTestId("surface-source").selectOption(source);
  await surface(page).getByTestId("surface-extract").click();
  await expect(panel(page, id)).toHaveAttribute(
    "data-spatialflex-placement",
    "external",
  );
  await expect(panel(page, id)).toHaveAttribute("data-spatial-placed", "");
}

/**
 * Restore from the surface (select → Restore). A collapsed source has no
 * layout box to outline, so it is restored with the SDK panel's own Attach
 * control on the native panel itself.
 */
async function restore(page: Page, id: string) {
  if (
    (await slot(page, id).getAttribute("data-source-policy")) === "collapse"
  ) {
    await panel(page, id)
      .locator("[data-spatialflex-panel-bar]")
      .getByRole("button", { name: "Attach" })
      .click();
  } else {
    await select(page, id);
    await surface(page).getByTestId("surface-restore").click();
  }
  await expect(panel(page, id)).not.toHaveAttribute(
    "data-spatialflex-placement",
  );
}

/**
 * Bounding box of the panel's world quad as projected by the renderer's own
 * camera (independent of the DOM compositor), from the pose the compositor
 * reports on the element.
 */
function expectedBox(page: Page, id: string) {
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
    const p = (window as Marked).__xrHostProbe!;
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
}

/** The original element is exactly where its own world pose projects. */
async function expectPlaced(page: Page, id: string) {
  await expect
    .poll(async () => {
      const actual = (await panel(page, id).boundingBox())!;
      const expected = await expectedBox(page, id);
      return Math.max(
        Math.abs(actual.x - expected.x),
        Math.abs(actual.y - expected.y),
        Math.abs(actual.x + actual.width - expected.right),
        Math.abs(actual.y + actual.height - expected.bottom),
      );
    })
    .toBeLessThan(2);
  return (await panel(page, id).boundingBox())!;
}

/** Client positions of the surface page's corner markers. */
const surfaceCorners = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-surface-corner]")].map((m) => {
      const r = m.getBoundingClientRect();
      return { x: r.left, y: r.top };
    }),
  );

async function orbit(page: Page, engine: Engine) {
  const box = (await page.getByTestId("xr-canvas").boundingBox())!;
  const start = { x: box.x + box.width - 40, y: box.y + box.height - 30 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const dx = engine === "three" ? -60 : -40;
  await page.mouse.move(start.x + dx, start.y - 10, { steps: 10 });
  await page.mouse.up();
}

const shot = (page: Page, name: string, enabled: boolean) =>
  enabled
    ? page.screenshot({ path: `${EVIDENCE}/p1-06a-${name}.png` })
    : Promise.resolve();

for (const engine of ENGINES) {
  test(`${engine}: Native DOM moves the original Shared Counter into space and restores it`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    const capture = engine === "three" && testInfo.project.name === "chromium";
    await open(page, engine);
    await shot(page, "website", capture);
    await surface(page).getByTestId("counter-note").fill("typed before");
    await surface(page).getByTestId("counter-local").click();
    await mark(page);
    const before = await diagnostics(page);
    const styles = await design(page);
    const source = await layoutBox(page, "shared-counter");
    const chart = await layoutBox(page, "live-chart");

    await extractNative(page, "shared-counter");
    // The same nodes, one instance, the same React lifecycle and design.
    expect(await sameNodes(page)).toBe(true);
    expect(await diagnostics(page)).toEqual(before);
    expect(await design(page)).toEqual(styles);
    await expect(
      page.getByTestId("surface-extraction-shared-counter"),
    ).toContainText("Native DOM (the original element), native-");
    // Reserve: neither the source footprint nor its neighbor moves.
    expect(await layoutBox(page, "shared-counter")).toEqual(source);
    expect(await layoutBox(page, "live-chart")).toEqual(chart);
    await expect(slot(page, "shared-counter")).toHaveAttribute(
      "data-source-policy",
      "placeholder",
    );

    // Independently placed in the world, outside the surface's area.
    const placed = await expectPlaced(page, "shared-counter");
    const corners = await surfaceCorners(page);
    expect(placed.x).toBeGreaterThan(Math.max(...corners.map((c) => c.x)));
    await shot(page, "native", capture);

    // The original controls, operated in space with real input.
    const chartValues = await page
      .getByTestId("web-chart")
      .getAttribute("data-values");
    await panel(page, "shared-counter").getByTestId("web-increment").click();
    await expect(page.getByTestId("web-count")).toHaveText("1");
    await expect(page.getByTestId("increment-calls")).toHaveText("1");
    await expect(page.getByTestId("web-chart")).not.toHaveAttribute(
      "data-values",
      chartValues!,
    );
    await panel(page, "shared-counter").getByTestId("counter-local").click();
    await expect(page.getByTestId("counter-local")).toHaveText(
      "Local clicks: 2",
    );
    const note = panel(page, "shared-counter").getByTestId("counter-note");
    await note.click();
    await expect(note).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("typed in space");
    await expect(note).toHaveValue("typed in space");
    await expect(note).toBeFocused();
    await shot(page, "native-input", capture);

    // Orbit and resize: the same node keeps its own world projection.
    await orbit(page, engine);
    const orbited = await expectPlaced(page, "shared-counter");
    expect(
      Math.abs(orbited.x - placed.x) + Math.abs(orbited.y - placed.y),
    ).toBeGreaterThan(8);
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    await expectPlaced(page, "shared-counter");
    await page.setViewportSize({ width: 1180, height: 820 });
    await expectPlaced(page, "shared-counter");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectPlaced(page, "shared-counter");
    // Still operable after the camera and viewport changes.
    await panel(page, "shared-counter").getByTestId("web-increment").click();
    await expect(page.getByTestId("increment-calls")).toHaveText("2");

    await restore(page, "shared-counter");
    expect(await sameNodes(page)).toBe(true);
    await expect(panel(page, "shared-counter")).not.toHaveAttribute(
      "data-spatial-placed",
    );
    expect(
      await panel(page, "shared-counter").evaluate(
        (el: HTMLElement) =>
          el.style.transform + el.style.clipPath + el.style.position,
      ),
    ).toBe("");
    expect(await layoutBox(page, "shared-counter")).toEqual(source);
    expect(await design(page)).toEqual(styles);
    await expect(surface(page).getByTestId("counter-note")).toHaveValue(
      "typed in space",
    );
    await expect(surface(page).getByTestId("counter-local")).toHaveText(
      "Local clicks: 2",
    );
    expect(await diagnostics(page)).toEqual(before);
    await shot(page, "native-restored", capture);

    await mkdir(EVIDENCE, { recursive: true });
    await writeFile(
      `${EVIDENCE}/p1-06a-${engine}-${testInfo.project.name}.json`,
      JSON.stringify(
        {
          engine,
          browser: testInfo.project.name,
          presentation: "native",
          source: "reserved",
          sameNodesDuringAndAfter: true,
          singleContentInstance: true,
          computedDesignUnchanged: true,
          sourceFootprint: source,
          neighborLayout: chart,
          panelBoundingBox: placed,
          counterMounts: before.mounts,
          counterInstances: before.instances,
          activeSubscriptions: before.active,
          totalSubscribes: before.subscribes,
          incrementCalls: 2,
        },
        null,
        2,
      ) + "\n",
    );
    expect(errors).toEqual([]);
  });

  test(`${engine}: Native DOM ↔ XR Adaptive on the same Counter`, async ({
    page,
  }, testInfo) => {
    const errors = watchConsole(page);
    const capture = engine === "three" && testInfo.project.name === "chromium";
    await open(page, engine);
    await mark(page);
    const before = await diagnostics(page);

    // Unsupported combinations are disabled with reasons.
    await select(page, "shared-counter");
    await surface(page).getByTestId("surface-presentation-native").click();
    const options = surface(page).getByTestId("surface-source");
    await expect(options.locator("option[value=visible]")).toBeDisabled();
    await expect(options.locator("option[value=collapsed]")).toBeEnabled();
    await expect(
      surface(page).getByTestId("surface-unsupported"),
    ).toContainText("Native DOM moves the one original instance");
    await surface(page).getByTestId("surface-presentation-adaptive").click();
    await expect(options.locator("option[value=collapsed]")).toBeDisabled();
    await expect(options.locator("option[value=visible]")).toBeEnabled();
    await expect(
      surface(page).getByTestId("surface-unsupported"),
    ).toContainText("XR Adaptive keeps the original mounted in place");
    await surface(page).getByTestId("surface-select-mode").click();
    await page.keyboard.press("Escape");

    await extractNative(page, "shared-counter");
    expect(await probe(page, "panels")).toEqual([]);
    await restore(page, "shared-counter");

    // The same Counter as XR Adaptive: a separate renderer-native panel.
    await select(page, "shared-counter");
    await surface(page).getByTestId("surface-presentation-adaptive").click();
    await surface(page).getByTestId("surface-source").selectOption("reserved");
    await surface(page).getByTestId("surface-extract").click();
    await expect.poll(() => probe(page, "panels")).toContain("shared-counter");
    await expect(panel(page, "shared-counter")).not.toHaveAttribute(
      "data-spatialflex-placement",
    );
    await expect(
      page.getByTestId("surface-extraction-shared-counter"),
    ).toContainText("XR Adaptive, presentation-");
    let point: Point | null = null;
    await expect
      .poll(
        async () =>
          (point = await page.evaluate(
            () =>
              (window as Marked).__xrHostProbe?.locate(
                "shared-counter",
                "button:increment",
              ) ?? null,
          )),
      )
      .not.toBeNull();
    await page.mouse.click(point!.x, point!.y);
    await expect(page.getByTestId("increment-calls")).toHaveText("1");
    await expect(page.getByTestId("action-count")).toHaveText("1");
    await shot(page, "adaptive", capture);
    await surface(page).getByTestId("surface-restore").click();
    await expect.poll(() => probe(page, "panels")).toEqual([]);

    // Side by side: Counter as Native DOM, Image as XR Adaptive.
    await extractNative(page, "shared-counter");
    await select(page, "image-panel");
    await surface(page).getByTestId("surface-presentation-adaptive").click();
    await surface(page).getByTestId("surface-source").selectOption("visible");
    await surface(page).getByTestId("surface-extract").click();
    await expect.poll(() => probe(page, "panels")).toContain("image-panel");
    await expectPlaced(page, "shared-counter");
    await shot(page, "comparison", capture);
    await restore(page, "shared-counter");
    await select(page, "image-panel");
    await surface(page).getByTestId("surface-restore").click();
    await expect.poll(() => probe(page, "panels")).toEqual([]);

    expect(await sameNodes(page)).toBe(true);
    expect(await diagnostics(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test("Native DOM with Collapse reflows the source and restores the layout", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await open(page, "three");
  await mark(page);
  const chart = await layoutBox(page, "live-chart");
  const image = await layoutBox(page, "image-panel");
  await extractNative(page, "shared-counter", "collapsed");
  await expect(slot(page, "shared-counter")).toHaveCSS("display", "contents");
  // Neighbors take the released space.
  const reflowed = await layoutBox(page, "live-chart");
  expect(reflowed.left < chart.left || reflowed.top < chart.top).toBe(true);
  await expectPlaced(page, "shared-counter");
  await panel(page, "shared-counter").getByTestId("web-increment").click();
  await expect(page.getByTestId("increment-calls")).toHaveText("1");
  await restore(page, "shared-counter");
  expect(await layoutBox(page, "live-chart")).toEqual(chart);
  expect(await layoutBox(page, "image-panel")).toEqual(image);
  expect(await sameNodes(page)).toBe(true);
  expect(errors).toEqual([]);
});

test("Native DOM depth: in front of the page it receives input; behind it, the page covers it", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await open(page, "three");
  await extractNative(page, "shared-counter");
  const hit = async () => {
    const box = (await panel(page, "shared-counter").boundingBox())!;
    return page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x!, y!);
        return el?.closest('[data-spatialflex-item="shared-counter"]')
          ? "native"
          : el?.closest("[data-testid=web-surface]")
            ? "page"
            : el?.tagName.toLowerCase();
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
  };
  // Slide the page under the native panel: the panel is in front.
  for (let i = 0; i < 8; i++)
    await page.getByRole("button", { name: "Move surface right" }).click();
  await expect
    .poll(async () => {
      const c = await surfaceCorners(page);
      const b = (await panel(page, "shared-counter").boundingBox())!;
      return Math.max(...c.map((p) => p.x)) > b.x + b.width / 2;
    })
    .toBe(true);
  await expect.poll(hit).toBe("native");
  const note = panel(page, "shared-counter").getByTestId("counter-note");
  await note.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("over the page");
  await expect(note).toHaveValue("over the page");
  // Move the page in front of the panel: the page now covers it.
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "Move surface closer" }).click();
  await expect.poll(hit).toBe("page");
  await expect(panel(page, "shared-counter")).not.toHaveCSS(
    "clip-path",
    "none",
  );
  expect(errors).toEqual([]);
});

test("lifecycle: unmount, remount, repeated cycles and leaving the mode", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await open(page, "three");
  await mark(page);
  const textures = await probe(page, "liveTextures");

  // Unmounting a natively extracted component removes its presentation.
  await extractNative(page, "image-panel");
  await surface(page).getByTestId("image-mounted").click();
  await expect(slot(page, "image-panel")).toHaveCount(0);
  await expect(page.getByTestId("surface-extraction-image-panel")).toHaveCount(
    0,
  );
  await surface(page).getByTestId("image-mounted").click();
  await expect(slot(page, "image-panel")).toBeVisible();
  await expect(panel(page, "image-panel")).not.toHaveAttribute(
    "data-spatialflex-placement",
  );
  // The image's own store subscription was legitimately recreated; the
  // baseline for the cycles below starts here.
  const before = await diagnostics(page);

  // Repeated cycles: new presentation instances, no leaks.
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    await extractNative(
      page,
      "shared-counter",
      i === 1 ? "collapsed" : "reserved",
    );
    ids.push(
      (await page
        .getByTestId("surface-extraction-shared-counter")
        .textContent())!.match(/native-\d+/)![0],
    );
    await panel(page, "shared-counter").getByTestId("web-increment").click();
    await restore(page, "shared-counter");
  }
  expect(new Set(ids).size).toBe(3);
  await expect(page.getByTestId("increment-calls")).toHaveText("3");
  expect(await sameNodes(page)).toBe(true);
  expect(await diagnostics(page)).toEqual(before);
  expect(await probe(page, "liveTextures")).toBe(textures);

  // Leaving Spatial Website returns a native extraction to its place.
  await extractNative(page, "shared-counter");
  await page.getByTestId("surface-toggle").click();
  await expect(page.locator("[data-testid=web-surface]")).toHaveCount(0);
  await expect(panel(page, "shared-counter")).toHaveAttribute(
    "data-status",
    "attached",
  );
  expect(
    await panel(page, "shared-counter").evaluate(
      (el: HTMLElement) => el.style.transform + el.style.position,
    ),
  ).toBe("");
  expect(await sameNodes(page)).toBe(true);
  expect(await diagnostics(page)).toEqual(before);
  expect(errors).toEqual([]);
});
