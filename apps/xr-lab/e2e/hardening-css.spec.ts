import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  EVIDENCE,
  compositorResidue,
  drag,
  centerOf,
  expectPlaced,
  extract,
  handle,
  nativeHits,
  openSurface,
  orbit,
  cornerShift,
  surfaceCorners,
  panel,
  poseOf,
  projectedNative,
  hitsAt,
  select,
  slot,
  surface,
  target,
  type TestWindow,
} from "./hardening";
import { ENGINES, watchConsole } from "./lab";

/**
 * P1-07A CSS/DOM containment and layout stability of Native DOM
 * extraction, on the hardening fixture (`?fixture=hardening`). Every case is
 * extracted through the surface UI with the real mouse and checked in the
 * browser: placement against the renderer's projection, hit testing, real
 * clicks, DOM identity, preserved state and released styles.
 */

/** Cases whose ancestors keep the page as containing block, unclipped. */
const SUPPORTED = [
  "case-form",
  "case-plain",
  "case-scroll",
  "case-hidden",
  "case-clip",
  "case-positioned",
  "case-stacking",
  "case-opacity",
  "case-container",
] as const;
/** Cases refused with a diagnostic: ancestor class and property. */
const DIAGNOSED = {
  "case-transform": ["div.hz-wrap.hz-transform", "transform"],
  "case-filter": ["div.hz-wrap.hz-filter", "filter"],
  "case-will-change": ["div.hz-wrap.hz-will-change", "will-change"],
  "case-contain": ["div.hz-wrap.hz-contain", "contain"],
  "case-clip-path": ["div.hz-wrap.hz-clip-path", "clip-path"],
} as const;

const mounts = (page: Page) => page.getByTestId("fixture-mounts").textContent();
const wrapperOf = (page: Page, id: string) =>
  id === "case-form"
    ? page.locator(".hz-form-host")
    : page.locator(`[data-hz-case="${id}"] .hz-wrap`);
/** Application styling of a case's surroundings, to show it is untouched. */
const surroundings = (page: Page, id: string) =>
  wrapperOf(page, id).evaluate((el: HTMLElement) => {
    const s = getComputedStyle(el);
    const scroller = el.matches(".hz-scroll") ? el : null;
    return {
      inline: el.style.cssText,
      computed: [
        s.transform,
        s.filter,
        s.overflow,
        s.position,
        s.zIndex,
        s.opacity,
        s.contain,
        s.clipPath,
      ].join("|"),
      scrollTop: scroller?.scrollTop ?? null,
    };
  });

const evidence: Record<string, unknown> = {};

for (const engine of ENGINES) {
  test(`${engine}: CSS/DOM containment matrix (supported cases composited, others diagnosed)`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await openSurface(page, engine, "hardening");
    const startMounts = await mounts(page);
    const matrix: Record<string, unknown> = {};

    for (const id of SUPPORTED) {
      const article = slot(page, id).locator("article");
      const button = article.locator("button").first();
      await article.evaluate((el) => {
        (window as TestWindow).__marked = { [el.ariaLabel ?? ""]: el };
      });
      const before = {
        surroundings: await surroundings(page, id),
        slot: await slot(page, id).evaluate((el: HTMLElement) => [
          el.offsetWidth,
          el.offsetHeight,
        ]),
        width: await article.evaluate((el: HTMLElement) => el.offsetWidth),
        label: await button.textContent(),
      };
      await extract(page, id, "native");
      await expectPlaced(page, id);
      const hits = await nativeHits(page, id);
      expect(hits, id).toEqual(Array(5).fill("native"));
      // The source keeps its footprint; the content keeps its CSS width.
      expect(
        await slot(page, id).evaluate((el: HTMLElement) => [
          el.offsetWidth,
          el.offsetHeight,
        ]),
      ).toEqual(before.slot);
      expect(await article.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(
        before.width,
      );
      // A real click in space reaches the original control exactly once.
      const clicks = Number((before.label ?? "").match(/\d+/)![0]);
      await button.click();
      await expect(button).toHaveText(
        new RegExp(`(Clicks|Button): ${clicks + 1}$`),
      );
      await surface(page).getByTestId("surface-restore").click();
      await expect(panel(page, id)).not.toHaveAttribute(
        "data-spatialflex-placement",
      );
      expect(await compositorResidue(panel(page, id))).toEqual([]);
      expect(await surroundings(page, id)).toEqual(before.surroundings);
      expect(
        await article.evaluate(
          (el) => Object.values((window as TestWindow).__marked!)[0] === el,
        ),
      ).toBe(true);
      await expect(button).toHaveText(
        new RegExp(`(Clicks|Button): ${clicks + 1}$`),
      );
      matrix[id] = { classification: "SUPPORTED", hits: hits.length };
    }

    for (const [id, [element, property]] of Object.entries(DIAGNOSED)) {
      const before = await surroundings(page, id);
      await select(page, id);
      await expect(
        surface(page).getByTestId("surface-presentation-native"),
      ).toBeDisabled();
      const diagnostic = surface(page).getByTestId("surface-native-diagnostic");
      await expect(diagnostic).toContainText(
        `ancestor ${element} has ${property}:`,
      );
      await expect(diagnostic).toContainText("Use XR Adaptive");
      // These components declare no XR view either: nothing can be extracted.
      await expect(surface(page).getByTestId("surface-extract")).toBeDisabled();
      expect(await target(page, id)).toBeUndefined();
      expect(await compositorResidue(panel(page, id))).toEqual([]);
      expect(await surroundings(page, id)).toEqual(before);
      matrix[id] = {
        classification: "UNSUPPORTED (diagnosed)",
        diagnostic: await diagnostic.textContent(),
      };
    }

    expect(await mounts(page)).toBe(startMounts);
    expect(errors).toEqual([]);
    evidence[`${engine}-${testInfo.project.name}`] = matrix;
  });

  test(`${engine}: an ancestor style that changes after extraction is detected at runtime`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = watchConsole(page);
    await openSurface(page, engine, "hardening");
    const id = "case-plain";
    await extract(page, id, "native");
    await expectPlaced(page, id);
    const placed = (await projectedNative(page, id, [[0, 0]]))!.samples;

    // The application starts transforming an ancestor (for example an
    // animation): the page is no longer the element's containing block.
    await wrapperOf(page, id).evaluate((el: HTMLElement) => {
      el.style.transform = "translateX(4px)";
    });
    await expect(panel(page, id)).toHaveAttribute(
      "data-spatial-issue",
      "containing-block",
    );
    await expect(panel(page, id)).not.toHaveAttribute("data-spatial-placed");
    await expect(panel(page, id)).toHaveCSS("visibility", "hidden");
    const issue = surface(page).getByTestId("surface-native-issue");
    await expect(issue).toContainText("hidden until restored");
    await expect(issue).toContainText("div.hz-wrap.hz-plain has transform:");
    // Hidden, so it takes no input where it used to be.
    expect(await hitsAt(page, id, placed)).not.toContain("native");
    // Still the same Native DOM extraction: never switched to XR Adaptive.
    expect((await target(page, id))!.kind).toBe("native");

    await wrapperOf(page, id).evaluate((el: HTMLElement) => {
      el.style.removeProperty("transform");
    });
    await expect(panel(page, id)).not.toHaveAttribute("data-spatial-issue");
    await expect(panel(page, id)).toHaveAttribute("data-spatial-placed", "");
    await expect(issue).toHaveCount(0);
    await expectPlaced(page, id);
    expect(await nativeHits(page, id)).toEqual(Array(5).fill("native"));

    await surface(page).getByTestId("surface-restore").click();
    await expect(panel(page, id)).not.toHaveAttribute(
      "data-spatialflex-placement",
    );
    expect(await compositorResidue(panel(page, id))).toEqual([]);
    expect(await wrapperOf(page, id).getAttribute("style")).toBe("");
    expect(errors).toEqual([]);
  });

  test(`${engine}: pose and CSS layout stay stable across viewport, scroll, content size and camera changes`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await openSurface(page, engine, "hardening");
    const id = "case-form";
    const article = slot(page, id).locator("article");
    await extract(page, id, "native");
    const grab = await centerOf(handle(page, id, "translate"));
    await drag(page, grab, { x: grab.x - 40, y: grab.y + 30 });
    const pose = await poseOf(page, id);
    expect(pose).not.toEqual((await target(page, id))!.initial);
    await expectPlaced(page, id);
    const layout = () =>
      article.evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight]);
    const css = await layout();

    // Browser viewport resize: the canvas and camera frame change.
    await page.setViewportSize({ width: 1024, height: 760 });
    await expect
      .poll(
        async () => (await page.getByTestId("xr-canvas").boundingBox())!.width,
      )
      .toBeLessThan(800);
    expect(await poseOf(page, id)).toEqual(pose);
    await expectPlaced(page, id);
    expect(await layout()).toEqual(css);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectPlaced(page, id);
    expect(await poseOf(page, id)).toEqual(pose);

    // Scrolling the source page (and a scroller inside it).
    const scrolled = await page.evaluate(() => {
      const viewport = document.querySelector(".web-surface-viewport")!;
      viewport.scrollTop = 160;
      document.querySelector<HTMLElement>(
        "[data-testid=hz-scroller]",
      )!.scrollTop = 0;
      return viewport.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await expectPlaced(page, id);
    expect(await poseOf(page, id)).toEqual(pose);
    expect(await nativeHits(page, id)).toEqual(Array(5).fill("native"));
    await page.evaluate(() => {
      document.querySelector(".web-surface-viewport")!.scrollTop = 0;
    });

    // The component changes its own size (real click in space): the pose
    // is unchanged, the width too; the element grows about its center.
    await panel(page, id).getByTestId("form-grow").click();
    await panel(page, id).getByTestId("form-grow").click();
    await expect(panel(page, id).getByTestId("form-extra")).toHaveCount(2);
    const grown = await layout();
    expect(grown[0]).toBe(css[0]);
    expect(grown[1]).toBeGreaterThan(css[1]!);
    expect(await poseOf(page, id)).toEqual(pose);
    await expectPlaced(page, id);
    const written = JSON.parse(
      (await panel(page, id).getAttribute("data-spatial-pose"))!,
    ) as { resolution: { height: number } };
    expect(written.resolution.height).toBe(
      await panel(page, id).evaluate((el: HTMLElement) => el.offsetHeight),
    );

    // Spatial resize: world scale only, no CSS reflow of the component.
    await article.evaluate((el) => {
      const w = window as TestWindow & { __resized?: number };
      w.__resized = 0;
      new ResizeObserver(() => {
        w.__resized!++;
      }).observe(el);
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as TestWindow & { __resized?: number }).__resized,
        ),
      )
      .toBe(1); // The observer's initial notification.
    const resizeFrom = await centerOf(handle(page, id, "resize"));
    await drag(page, resizeFrom, {
      x: resizeFrom.x + 40,
      y: resizeFrom.y + 30,
    });
    const scaled = await poseOf(page, id);
    expect(scaled.scale).toBeGreaterThan(1.1);
    expect(scaled.position).toEqual(pose.position);
    await expectPlaced(page, id);
    expect(await layout()).toEqual(grown);
    expect(
      await page.evaluate(
        () => (window as TestWindow & { __resized?: number }).__resized,
      ),
    ).toBe(1);

    // Camera orbit and reset keep the world pose.
    const corners = await surfaceCorners(page);
    await orbit(page, engine);
    await expect.poll(() => cornerShift(page, corners)).toBeGreaterThan(5);
    expect(await poseOf(page, id)).toEqual(scaled);
    await expectPlaced(page, id);
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect.poll(() => cornerShift(page, corners)).toBeLessThan(0.5);
    await expectPlaced(page, id);
    expect(await poseOf(page, id)).toEqual(scaled);
    expect(errors).toEqual([]);
  });
}

/**
 * Browser truth of the containment rules (engine-independent): the same
 * property table as nativeContainment.ts, checked against what the browser
 * does with a fixed-position descendant of a transformed page.
 */
const RULES: readonly [string, string, "containing-block" | "clip" | "none"][] =
  [
    ["transform", "translate(1px, 1px)", "containing-block"],
    ["translate", "1px 1px", "containing-block"],
    ["rotate", "1deg", "containing-block"],
    ["scale", "1.01", "containing-block"],
    ["perspective", "800px", "containing-block"],
    ["transform-style", "preserve-3d", "containing-block"],
    ["filter", "blur(0.5px)", "containing-block"],
    ["backdrop-filter", "blur(1px)", "containing-block"],
    ["will-change", "transform", "containing-block"],
    ["will-change", "filter", "containing-block"],
    ["contain", "paint", "containing-block"],
    ["contain", "layout", "containing-block"],
    ["contain", "strict", "containing-block"],
    ["contain", "content", "containing-block"],
    ["content-visibility", "auto", "containing-block"],
    ["clip-path", "inset(0)", "clip"],
    ["mask-image", "linear-gradient(black, black)", "clip"],
    ["will-change", "opacity", "none"],
    ["contain", "style", "none"],
    ["container-type", "inline-size", "none"],
    ["container-type", "size", "none"],
    ["opacity", "0.85", "none"],
    ["isolation", "isolate", "none"],
    ["overflow", "hidden", "none"],
    ["overflow", "clip", "none"],
    ["position", "relative; z-index: 1", "none"],
    ["position", "sticky", "none"],
  ];

test("containment rules match the browser", async ({ page }, testInfo) => {
  await page.goto("about:blank");
  const results = await page.evaluate((rules) => {
    return rules.map(([property, value]) => {
      const pageEl = document.createElement("div");
      pageEl.style.cssText =
        "position:absolute;left:0;top:0;width:400px;height:300px;transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,10,0,1);";
      const ancestor = document.createElement("div");
      ancestor.style.cssText = `margin:40px;width:100px;height:60px;${property}:${value};`;
      const child = document.createElement("div");
      child.style.cssText =
        "position:fixed;left:0;top:0;width:20px;height:20px;transform:translate(250px,200px);background:red;";
      ancestor.append(child);
      pageEl.append(ancestor);
      document.body.append(pageEl);
      const captured = child.offsetParent === ancestor;
      const onPage = child.offsetParent === pageEl;
      const r = child.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      pageEl.remove();
      return {
        rule: `${property}: ${value}`,
        effect: captured
          ? "containing-block"
          : onPage && hit !== child
            ? "clip"
            : onPage
              ? "none"
              : "unknown",
      };
    });
  }, RULES);
  expect(results.map((r) => `${r.rule} → ${r.effect}`)).toEqual(
    RULES.map(([p, v, e]) => `${p}: ${v} → ${e}`),
  );
  evidence[`rules-${testInfo.project.name}`] = results;
});

test.afterAll(async ({ browserName }) => {
  if (Object.keys(evidence).length === 0) return;
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(
    `${EVIDENCE}/css-matrix-${browserName}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
});
