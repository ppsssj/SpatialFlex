import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  EVIDENCE,
  activeSession,
  centerOf,
  compositorResidue,
  distance,
  drag,
  expectCameraResponds,
  expectPlaced,
  extract,
  grabPoint,
  handle,
  hitsAt,
  liveListeners,
  nativeHits,
  openSurface,
  panel,
  poseOf,
  projectedNative,
  select,
  slot,
  subscriptions,
  surface,
  target,
  windowListeners,
  yaw,
  type Point,
  type TestWindow,
  type Vec3,
} from "./hardening";
import { ENGINES, probe, watchConsole } from "./lab";

/**
 * P1-07A input, focus, occlusion and lifecycle hardening. Pointer and
 * keyboard input is real (Playwright mouse and keyboard). Hit testing is the
 * browser's (`elementFromPoint`) and the renderer's own picking (real
 * clicks on 3D parts). No synthetic events are used in this file.
 */

const FORM = "case-form";
const COUNTER = "shared-counter";
const IMAGE = "image-panel";
const PANEL_SELECTOR = (id: string) =>
  `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`;

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
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return (
      el?.dataset.testid ??
      (el?.dataset.spatialflexHandle &&
        `handle:${el.dataset.spatialflexHandle}`) ??
      el?.textContent?.trim() ??
      el?.tagName
    );
  });
const mark = (page: Page, id: string) =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector)!;
    (window as TestWindow).__marked = Object.fromEntries(
      [
        ...root.querySelectorAll("article, button, input, textarea, select"),
      ].map((el, i) => [String(i), el]),
    );
  }, PANEL_SELECTOR(id));
const sameNodes = (page: Page, id: string) =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector)!;
    const now = [
      ...root.querySelectorAll("article, button, input, textarea, select"),
    ];
    return Object.values((window as TestWindow).__marked!).every((el) =>
      now.includes(el),
    );
  }, PANEL_SELECTOR(id));

/** Screen point of a fixed world point: changes only when the camera does. */
const cameraMark = (page: Page) =>
  page.evaluate(() =>
    (
      [
        [1, 2, -1.2],
        [-1, 1, -2],
      ] as const
    ).map((p) => (window as TestWindow).__xrHostProbe!.project([...p])!),
  );
async function expectCameraStill(page: Page, start: Point[], step: string) {
  const now = await cameraMark(page);
  expect(
    Math.max(
      ...now.map((p, i) => Math.hypot(p.x - start[i]!.x, p.y - start[i]!.y)),
    ),
    `camera moved during: ${step}`,
  ).toBeLessThan(0.5);
}

const evidence: Record<string, unknown> = {};

for (const engine of ENGINES) {
  test(`${engine}: real controls keep working, keep focus and never start a manipulation`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = watchConsole(page);
    await openSurface(page, engine, "hardening");
    const p = panel(page, FORM);
    await p.getByTestId("form-uncontrolled").fill("typed before");
    await mark(page, FORM);
    const subs = await subscriptions(page);
    const mounts = await page.getByTestId("fixture-mounts").textContent();
    const moveListeners = await windowListeners(page, "pointermove");
    expect(await liveListeners(page, PANEL_SELECTOR(FORM), "pointerdown")).toBe(
      0,
    );

    await extract(page, FORM, "native");
    // One delegated listener per type on the extracted element.
    for (const type of ["pointerdown", "keydown", "focusout"])
      expect(await liveListeners(page, PANEL_SELECTOR(FORM), type), type).toBe(
        1,
      );

    // Move, rotate and resize with the real mouse.
    const grab = await centerOf(handle(page, FORM, "translate"));
    await drag(page, grab, { x: grab.x - 60, y: grab.y + 20 });
    // Focus stays in the panel, on the handle that was used.
    expect(await focused(page)).toBe("handle:translate");
    const rotateFrom = await centerOf(handle(page, FORM, "rotate"));
    await drag(page, rotateFrom, { x: rotateFrom.x + 30, y: rotateFrom.y });
    const resizeFrom = await centerOf(handle(page, FORM, "resize"));
    await drag(page, resizeFrom, {
      x: resizeFrom.x + 16,
      y: resizeFrom.y + 12,
    });
    const pose = await poseOf(page, FORM);
    expect(Math.abs(yaw(pose.rotation))).toBeGreaterThan(0.05);
    expect(pose.scale).toBeGreaterThan(1.02);
    await expectPlaced(page, FORM);

    // Values are unchanged by manipulation.
    await expect(p.getByTestId("form-controlled")).toHaveValue(
      "controlled start",
    );
    await expect(p.getByTestId("form-uncontrolled")).toHaveValue(
      "typed before",
    );
    await expect(p.getByTestId("form-textarea")).toHaveValue("multi-line");
    await expect(p.getByTestId("form-select")).toHaveValue("beta");

    // Buttons fire exactly once; nested targets each run once (bubbling).
    await p.getByTestId("form-button").click();
    await expect(p.getByTestId("form-button")).toHaveText("Button: 1");
    await p.getByTestId("form-inner").click();
    await expect(p.getByTestId("form-inner")).toHaveText("Inner: 1");
    await expect(p.getByTestId("form-outer")).toHaveText("1");
    await p.getByTestId("form-outer").click();
    await expect(p.getByTestId("form-outer")).toHaveText("2");
    await expect(p.getByTestId("form-inner")).toHaveText("Inner: 1");
    // The active store subscription still drives the component.
    await p.getByTestId("form-increment").click();
    await expect(p.getByTestId("form-shared")).toHaveText("1");
    await expect(page.getByTestId("action-count")).toHaveText("1");

    // Typing and caret keys in fields edit the field, never the panel.
    const keysBefore = Number(
      (await p.getByTestId("form-keys").textContent())!.match(/\d+/)![0],
    );
    await p.getByTestId("form-controlled").click();
    expect(await focused(page)).toBe("form-controlled");
    await page.keyboard.press("End");
    await page.keyboard.type(" X");
    for (const key of [
      "ArrowLeft",
      "ArrowLeft",
      "ArrowRight",
      "Shift+ArrowLeft",
    ])
      await page.keyboard.press(key);
    await expect(p.getByTestId("form-controlled-echo")).toHaveText(
      "controlled start X",
    );
    await p.getByTestId("form-textarea").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("line 2");
    await expect(p.getByTestId("form-textarea")).toHaveValue(
      "multi-line\nline 2",
    );
    await p.getByTestId("form-select").selectOption("gamma");
    await expect(p.getByTestId("form-select")).toHaveValue("gamma");
    expect(await poseOf(page, FORM)).toEqual(pose);
    expect(await activeSession(page)).toBeNull();
    // Key events reached the component itself.
    expect(
      Number(
        (await p.getByTestId("form-keys").textContent())!.match(/\d+/)![0],
      ),
    ).toBeGreaterThan(keysBefore + 8);

    // Pressing a control inside the panel never starts a manipulation.
    const field = await centerOf(p.getByTestId("form-uncontrolled"));
    await page.mouse.move(field.x, field.y);
    await page.mouse.down();
    expect(await activeSession(page)).toBeNull();
    await page.mouse.move(field.x - 40, field.y, { steps: 3 });
    await page.mouse.up();
    expect(await poseOf(page, FORM)).toEqual(pose);

    // Tab order through the extracted panel: handles, Attach, the content.
    await handle(page, FORM, "translate").focus();
    const order = [await focused(page)];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
    }
    expect(order).toEqual([
      "handle:translate",
      "handle:rotate",
      "Attach",
      "form-button",
      "form-increment",
      "form-controlled",
      "form-uncontrolled",
      "form-textarea",
      "form-select",
      "form-inner",
      "form-grow",
    ]);
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("handle:resize");
    await page.keyboard.press("Shift+Tab");
    expect(await focused(page)).toBe("form-grow");

    // Keyboard manipulation: Escape cancels, Enter commits.
    await handle(page, FORM, "rotate").focus();
    await page.keyboard.press("Shift+ArrowRight");
    const turned = await poseOf(page, FORM);
    expect(Math.abs(yaw(turned.rotation) - yaw(pose.rotation))).toBeCloseTo(
      Math.PI / 12,
      6,
    );
    await page.keyboard.press("Escape");
    expect(await poseOf(page, FORM)).toEqual(pose);
    await handle(page, FORM, "translate").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    const nudged = await poseOf(page, FORM);
    expect(distance(nudged.position, pose.position)).toBeCloseTo(0.04, 6);
    expect(await activeSession(page)).toBeNull();

    // Escape during a pointer drag cancels it; the release moves nothing.
    const escFrom = await centerOf(handle(page, FORM, "translate"));
    await drag(page, escFrom, { x: escFrom.x + 50, y: escFrom.y }, true);
    expect(await activeSession(page)).not.toBeNull();
    await page.keyboard.press("Escape");
    await page.mouse.move(escFrom.x + 80, escFrom.y, { steps: 3 });
    await page.mouse.up();
    expect(await poseOf(page, FORM)).toEqual(nudged);
    expect(await windowListeners(page, "pointermove")).toBe(moveListeners);

    // Restore: same nodes, values and state; no listener left behind.
    await surface(page).getByTestId("surface-restore").click();
    await expect(p).not.toHaveAttribute("data-spatialflex-placement");
    for (const type of ["pointerdown", "keydown", "focusout"])
      expect(await liveListeners(page, PANEL_SELECTOR(FORM), type), type).toBe(
        0,
      );
    expect(await compositorResidue(p)).toEqual([]);
    expect(await sameNodes(page, FORM)).toBe(true);
    await expect(p.getByTestId("form-controlled")).toHaveValue(
      "controlled start X",
    );
    await expect(p.getByTestId("form-uncontrolled")).toHaveValue(
      "typed before",
    );
    await expect(p.getByTestId("form-select")).toHaveValue("gamma");
    await expect(p.getByTestId("form-button")).toHaveText("Button: 1");
    expect(await page.getByTestId("fixture-mounts").textContent()).toBe(mounts);
    // One more state subscriber than before? No: the same component.
    expect((await subscriptions(page)).active).toBe(subs.active);
    expect((await subscriptions(page)).subscribes).toBe(subs.subscribes);
    expect(await windowListeners(page, "pointermove")).toBe(moveListeners);
    expect(errors).toEqual([]);
  });

  test(`${engine}: occlusion and hit testing between the page, XR panels and native panels`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const errors = watchConsole(page);
    await openSurface(page, engine);
    const record: Record<string, unknown> = {};

    const camera = await cameraMark(page);
    // --- Native in front of the page, over the page: it takes the input.
    await extract(page, COUNTER, "native");
    const grab = await centerOf(handle(page, COUNTER, "translate"));
    await drag(page, grab, { x: grab.x - 320, y: grab.y + 100 });
    await expectPlaced(page, COUNTER);
    expect(await nativeHits(page, COUNTER)).toEqual(Array(5).fill("native"));
    const calls = Number(
      await page.getByTestId("increment-calls").textContent(),
    );
    await panel(page, COUNTER).getByTestId("web-increment").click();
    await expect(page.getByTestId("increment-calls")).toHaveText(
      String(calls + 1),
    );

    await expectCameraStill(
      page,
      camera,
      "before: The page moved in front of it: the page ",
    );
    // --- The page moved in front of it: the page covers it and takes input.
    const closer = page.getByRole("button", { name: "Closer" });
    for (let i = 0; i < 5; i++) await closer.click();
    await expect
      .poll(() => panel(page, COUNTER).evaluate((el) => el.style.clipPath))
      .not.toBe("none");
    const behind = await nativeHits(page, COUNTER);
    expect(behind).not.toContain("native");
    expect(behind.every((h) => h === "page")).toBe(true);
    record.behindPage = behind;
    await page.getByRole("button", { name: "Reset surface" }).click();
    await expect
      .poll(() => nativeHits(page, COUNTER))
      .toEqual(Array(5).fill("native"));
    await surface(page).getByTestId("surface-restore").click();

    await expectCameraStill(
      page,
      camera,
      "before: XR panel in front of a native panel (nat",
    );
    // --- XR panel in front of a native panel (native extracted while the
    // surface was farther away): the XR panel is cut out of it, and that
    // area reaches the renderer, which picks the XR button.
    await extract(page, IMAGE, "adaptive");
    // Out of the way of the native panel's start position (its own handle).
    const xrMove = await locate(page, IMAGE, "handle:translate");
    await drag(page, xrMove, { x: xrMove.x, y: xrMove.y - 140 });
    await expectCameraStill(page, camera, "adaptive extraction and move");
    // Chosen before moving the surface away (its controls shrink with it);
    // Extract is then activated from the keyboard.
    await select(page, COUNTER);
    await expectCameraStill(page, camera, "selection");
    await surface(page).getByTestId("surface-presentation-native").click();
    await surface(page).getByTestId("surface-source").selectOption("reserved");
    const farther = page.getByRole("button", { name: "Farther" });
    for (let i = 0; i < 2; i++) await farther.click();
    await surface(page).getByTestId("surface-extract").focus();
    await page.keyboard.press("Enter");
    await expect(panel(page, COUNTER)).toHaveAttribute(
      "data-spatial-placed",
      "",
    );
    await expect
      .poll(async () => (await target(page, COUNTER))?.kind)
      .toBe("native");
    await expectCameraStill(page, camera, "keyboard extraction");
    const xrCenter = (await worldPosition(page, IMAGE, "background"))!;
    const nativePose = await poseOf(page, COUNTER);
    // Plane order, as the compositor decides it (plane level, not per pixel).
    const normal = (q: number[]) => [
      2 * (q[0]! * q[2]! + q[1]! * q[3]!),
      2 * (q[1]! * q[2]! - q[0]! * q[3]!),
      1 - 2 * (q[0]! * q[0]! + q[1]! * q[1]!),
    ];
    const n = normal(nativePose.rotation);
    expect(
      n.reduce(
        (s, v, i) => s + v * (xrCenter[i]! - nativePose.position[i]!),
        0,
      ),
    ).toBeGreaterThan(0.005);
    // Drag the native panel so that the XR "Next" button lies over it.
    const next = await locate(page, IMAGE, "button:next-variant");
    const bar = await grabPoint(handle(page, COUNTER, "translate"));
    // The XR button over the native panel's upper-left quarter: its lower
    // right part stays uncovered.
    const nativeCenter = (await projectedNative(page, COUNTER, [
      [-0.25, 0.25],
    ]))!.samples[0]!;
    await drag(page, bar, {
      x: bar.x + next.x - nativeCenter.x,
      y: bar.y + next.y - nativeCenter.y,
    });
    await expectCameraStill(page, camera, "native drag onto the XR panel");
    await expect
      .poll(() => panel(page, COUNTER).evaluate((el) => el.style.clipPath))
      .toMatch(/^polygon/);
    const nextNow = await locate(page, IMAGE, "button:next-variant");
    expect(await hitsAt(page, COUNTER, [nextNow])).toEqual(["canvas"]);
    const variant = await page.getByTestId("image-variant").inputValue();
    await page.mouse.click(nextNow.x, nextNow.y);
    await expect(page.getByTestId("image-variant")).not.toHaveValue(variant);
    await expectCameraStill(page, camera, "click on the XR button");
    // Elsewhere the native panel still takes its own input.
    const corners = (await projectedNative(page, COUNTER, [
      [0.4, -0.4],
      [0.3, -0.45],
      [0.45, -0.3],
    ]))!.samples;
    const away = await hitsAt(page, COUNTER, corners);
    expect(away).toContain("native");
    record.xrInFront = { overNext: "canvas", corners: away };
    await expectCameraStill(page, camera, "hit sampling");
    await surface(page).getByTestId("surface-select-mode").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Restore Shared counter" }).click();
    await page.getByRole("button", { name: "Reset surface" }).click();

    await expectCameraStill(
      page,
      camera,
      "before: Native panel in front of the XR panel: i",
    );
    // --- Native panel in front of the XR panel: it covers and takes input.
    await extract(page, COUNTER, "native");
    const next2 = await locate(page, IMAGE, "button:next-variant");
    const bar2 = await grabPoint(handle(page, COUNTER, "translate"));
    const c2 = (await projectedNative(page, COUNTER, [[0, 0]]))!.samples[0]!;
    await drag(page, bar2, {
      x: bar2.x + next2.x - c2.x,
      y: bar2.y + next2.y - c2.y,
    });
    await expectPlaced(page, COUNTER);
    const over = await locate(page, IMAGE, "button:next-variant");
    expect(await hitsAt(page, COUNTER, [over])).toEqual(["native"]);
    expect(await panel(page, COUNTER).evaluate((el) => el.style.clipPath)).toBe(
      "none",
    );
    const variant2 = await page.getByTestId("image-variant").inputValue();
    await page.mouse.click(over.x, over.y);
    await expect(page.getByTestId("image-variant")).toHaveValue(variant2);
    record.nativeInFront = { overNext: "native" };

    await expectCameraStill(
      page,
      camera,
      "before: Rotating toward the back-facing boundary",
    );
    // --- Rotating toward the back-facing boundary: visible and hit-tested
    // until it faces away, then hidden and taking no input.
    // No XR panel near it now: the facing boundary alone decides.
    await page.getByRole("button", { name: "Restore Image" }).click();
    await expect.poll(() => probe(page, "panels")).not.toContain(IMAGE);
    // Room to turn it with a drag that stays inside the viewport (pointer
    // moves outside the window are not delivered everywhere).
    const before = await centerOf(handle(page, COUNTER, "rotate"));
    const grabBar = await grabPoint(handle(page, COUNTER, "translate"));
    await drag(page, grabBar, { x: grabBar.x + 600 - before.x, y: grabBar.y });
    const rot = await centerOf(handle(page, COUNTER, "rotate"));
    expect(rot.x).toBeLessThan(700);
    await page.mouse.move(rot.x, rot.y);
    await page.mouse.down();
    const states: string[] = [];
    let near: Point[] = [];
    const room = page.viewportSize()!.width - 10 - rot.x;
    for (let dx = 20; dx <= room && !states.includes("hidden"); dx += 20) {
      await page.mouse.move(rot.x + dx, rot.y, { steps: 2 });
      // The compositor writes on the next rendered frames.
      const frames = await probe(page, "frames");
      await expect
        .poll(() => probe(page, "frames"))
        .toBeGreaterThan(frames + 1);
      const state = (await panel(page, COUNTER).getAttribute(
        "data-spatial-visibility",
      ))!;
      if (state === "visible") {
        // Still facing the camera: placed and hit-tested at its center.
        await expectPlaced(page, COUNTER);
        near = (await projectedNative(page, COUNTER, [[0, 0]]))!.samples;
        expect(await hitsAt(page, COUNTER, near)).toEqual(["native"]);
      }
      states.push(state);
    }
    await page.mouse.up();
    // Visible while approaching the boundary, then hidden past it.
    expect(states.filter((s) => s === "visible").length).toBeGreaterThan(1);
    expect(states.at(-1)).toBe("hidden");
    const away2 = (await poseOf(page, COUNTER)).rotation;
    expect(Math.abs(yaw(away2))).toBeGreaterThan(1);
    expect(await hitsAt(page, COUNTER, near)).not.toContain("native");
    // Reset from the inspector brings it back.
    await page
      .getByRole("button", { name: "Reset transform of Shared counter" })
      .click();
    await expect(panel(page, COUNTER)).toHaveAttribute(
      "data-spatial-visibility",
      "visible",
    );
    expect(await nativeHits(page, COUNTER)).toEqual(Array(5).fill("native"));

    await expectCameraStill(
      page,
      camera,
      "before: Two native panels and an XR panel are in",
    );
    // --- Two native panels and an XR panel are independent.
    await extract(page, IMAGE, "native");
    const imagePose = await poseOf(page, IMAGE);
    const counterPose = await poseOf(page, COUNTER);
    const cbar = await centerOf(handle(page, COUNTER, "translate"));
    await drag(page, cbar, { x: cbar.x - 120, y: cbar.y - 40 });
    expect(await poseOf(page, IMAGE)).toEqual(imagePose);
    expect(await poseOf(page, COUNTER)).not.toEqual(counterPose);
    await expectPlaced(page, IMAGE);
    await expectPlaced(page, COUNTER);
    await page.getByRole("button", { name: "Restore Shared counter" }).click();
    await expect(panel(page, COUNTER)).not.toHaveAttribute(
      "data-spatialflex-placement",
    );
    expect(await compositorResidue(panel(page, COUNTER))).toEqual([]);
    // The remaining panel still works with its own handles.
    const ibar = await centerOf(handle(page, IMAGE, "translate"));
    await drag(page, ibar, { x: ibar.x - 80, y: ibar.y });
    expect(await poseOf(page, IMAGE)).not.toEqual(imagePose);
    await expectPlaced(page, IMAGE);
    expect(await nativeHits(page, IMAGE)).toEqual(Array(5).fill("native"));
    await expectCameraStill(page, camera, "end");
    expect(errors).toEqual([]);
    evidence[`occlusion-${engine}-${testInfo.project.name}`] = record;
  });

  test(`${engine}: repeated extraction cycles and interrupted drags leave no stale state`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const errors = watchConsole(page);
    await openSurface(page, engine);
    await mark(page, COUNTER);
    const baseline = {
      move: await windowListeners(page, "pointermove"),
      up: await windowListeners(page, "pointerup"),
      key: await windowListeners(page, "keydown"),
      blur: await windowListeners(page, "blur"),
      subs: await subscriptions(page),
      mounts: await page.getByTestId("counter-mounts").textContent(),
      instances: await page.getByTestId("counter-instances").textContent(),
      textures: await probe(page, "liveTextures"),
    };
    const expectBaseline = async () => {
      expect(await windowListeners(page, "pointermove")).toBe(baseline.move);
      expect(await windowListeners(page, "pointerup")).toBe(baseline.up);
      expect(await windowListeners(page, "keydown")).toBe(baseline.key);
      expect(await windowListeners(page, "blur")).toBe(baseline.blur);
      expect(await subscriptions(page)).toEqual(baseline.subs);
      await expect(page.getByTestId("counter-mounts")).toHaveText(
        baseline.mounts!,
      );
      await expect(page.getByTestId("counter-instances")).toHaveText(
        baseline.instances!,
      );
      expect(await sameNodes(page, COUNTER)).toBe(true);
    };
    const seen = new Set<string>();
    const CYCLES = 4;

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      // Native: commit one drag, cancel another, restore.
      await extract(page, COUNTER, "native");
      const native = (await target(page, COUNTER))!;
      expect(seen.has(native.presentationId)).toBe(false);
      seen.add(native.presentationId);
      expect(native.transform).toEqual(native.initial);
      const from = await centerOf(handle(page, COUNTER, "translate"));
      await drag(page, from, { x: from.x - 50, y: from.y + 25 });
      const committed = await poseOf(page, COUNTER);
      expect(committed).not.toEqual(native.initial);
      const again = await centerOf(handle(page, COUNTER, "translate"));
      await drag(page, again, { x: again.x + 70, y: again.y }, true);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(await poseOf(page, COUNTER)).toEqual(committed);
      await page
        .getByRole("button", { name: "Restore Shared counter" })
        .click();
      expect(await target(page, COUNTER)).toBeUndefined();
      expect(await compositorResidue(panel(page, COUNTER))).toEqual([]);
      expect(
        await liveListeners(page, PANEL_SELECTOR(COUNTER), "pointerdown"),
      ).toBe(0);

      // Adaptive: a new instance at its default pose; drag; restore.
      await extract(page, COUNTER, "adaptive");
      const adaptive = (await target(page, COUNTER))!;
      expect(seen.has(adaptive.presentationId)).toBe(false);
      seen.add(adaptive.presentationId);
      expect(adaptive.transform).toEqual(adaptive.initial);
      const h = await locate(page, COUNTER, "handle:translate");
      await drag(page, h, { x: h.x - 40, y: h.y - 20 });
      expect(await poseOf(page, COUNTER)).not.toEqual(adaptive.initial);
      await page
        .getByRole("button", { name: "Restore Shared counter" })
        .click();
      await expect.poll(() => probe(page, "panels")).not.toContain(COUNTER);
      await expectBaseline();
    }
    await expectCameraResponds(page, engine);

    // --- Interrupted while dragging (the button stays pressed; the
    // interruption comes from the keyboard).
    // 1. Presentation switch: Restore, then extract as XR Adaptive.
    await extract(page, COUNTER, "native");
    const n1 = await centerOf(handle(page, COUNTER, "translate"));
    await drag(page, n1, { x: n1.x - 40, y: n1.y }, true);
    await surface(page).getByTestId("surface-restore").focus();
    await page.keyboard.press("Enter");
    await expect(panel(page, COUNTER)).not.toHaveAttribute(
      "data-spatialflex-placement",
    );
    await surface(page).getByTestId("surface-presentation-adaptive").focus();
    await page.keyboard.press("Space");
    await surface(page).getByTestId("surface-extract").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => probe(page, "panels")).toContain(COUNTER);
    await page.mouse.move(n1.x - 160, n1.y + 40, { steps: 5 });
    await page.mouse.up();
    const switched = (await target(page, COUNTER))!;
    expect(switched.kind).toBe("adaptive");
    expect(switched.transform).toEqual(switched.initial);
    await page.getByRole("button", { name: "Restore Shared counter" }).click();
    await expect.poll(() => probe(page, "panels")).not.toContain(COUNTER);
    await expectBaseline();

    // 2. Component unmount during a native drag.
    await extract(page, IMAGE, "native");
    const i1 = await centerOf(handle(page, IMAGE, "translate"));
    await drag(page, i1, { x: i1.x - 40, y: i1.y }, true);
    await page.getByTestId("image-mounted").focus();
    await page.keyboard.press("Space");
    await expect(slot(page, IMAGE)).toHaveCount(0);
    await page.mouse.move(i1.x - 120, i1.y, { steps: 3 });
    await page.mouse.up();
    expect(await target(page, IMAGE)).toBeUndefined();
    await page.getByTestId("image-mounted").focus();
    await page.keyboard.press("Space");
    await expect(slot(page, IMAGE)).toHaveCount(1);
    await expect(panel(page, IMAGE)).not.toHaveAttribute(
      "data-spatialflex-placement",
    );
    expect(await windowListeners(page, "pointermove")).toBe(baseline.move);
    // The remounted Image is a new component instance: exactly one more
    // subscribe in total, and the same number of active subscriptions.
    baseline.subs = {
      active: baseline.subs.active,
      subscribes: String(Number(baseline.subs.subscribes) + 1),
    };
    expect(await subscriptions(page)).toEqual(baseline.subs);

    // 3. Host disposal during an XR Adaptive drag (camera input suspended).
    await extract(page, COUNTER, "adaptive");
    const shownTextures = await probe(page, "liveTextures");
    const a1 = await locate(page, COUNTER, "handle:translate");
    await drag(page, a1, { x: a1.x - 30, y: a1.y }, true);
    expect(await activeSession(page)).not.toBeNull();
    const unmount = page.getByRole("button", { name: "Unmount workspace" });
    await unmount.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => probe(page, "activeHosts")).toBe(0);
    expect(await activeSession(page)).toBeNull();
    await page.mouse.up();
    await page.getByRole("button", { name: "Mount workspace" }).click();
    await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
    await expect(page.getByTestId("surface-status")).toHaveAttribute(
      "data-value",
      "visible",
    );
    // Camera input is back in its normal state with the new host.
    await expectCameraResponds(page, engine);
    await expect.poll(() => probe(page, "liveTextures")).toBe(shownTextures);
    await page.getByRole("button", { name: "Restore Shared counter" }).click();
    await expect.poll(() => probe(page, "panels")).not.toContain(COUNTER);
    await expectBaseline();
    // Releasing the GL context on the intentional host disposal is the
    // expected cleanup; some browsers report it as a warning (as in
    // desktop.spec.ts and surface.spec.ts).
    expect(errors.filter((e) => !/WebGL context was lost/.test(e))).toEqual([]);
    evidence[`lifecycle-${engine}-${testInfo.project.name}`] = {
      cycles: CYCLES,
      presentationInstances: [...seen],
      listeners: baseline,
    };
  });
}

test.afterAll(async ({ browserName }) => {
  if (Object.keys(evidence).length === 0) return;
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(
    `${EVIDENCE}/interaction-${browserName}.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
});
