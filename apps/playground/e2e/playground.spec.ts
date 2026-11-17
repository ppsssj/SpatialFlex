import { expect, test, type Locator, type Page } from "@playwright/test";

// Browser E2E for the Same-Host proof of concept, run against the production
// build (vite preview). Assertions are kept separate per concern:
// layout (real bounding boxes, registry status), local React state and
// component identity, shared domain state, and subscription/action counts.

const MIN_PANEL = { width: 160, height: 120 };

let consoleProblems: string[];

test.beforeEach(async ({ page }) => {
  consoleProblems = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error}`));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "SpatialFlex Playground" }),
  ).toBeVisible();
});

test.afterEach(() => {
  expect(consoleProblems, "browser console errors/warnings").toEqual([]);
});

// --- Page model ------------------------------------------------------------

const item = (page: Page, id: string) =>
  page.locator(`[data-spatialflex-item="${id}"]`);
const panel = (page: Page, id: string) =>
  item(page, id).locator("[data-spatialflex-panel]");
const panelBar = (page: Page, id: string) =>
  item(page, id).locator("[data-spatialflex-panel-bar]");
const resizeHandle = (page: Page, id: string) =>
  item(page, id).locator("[data-spatialflex-resize-handle]");
const registryField = (page: Page, id: string, field: string) =>
  page.getByTestId(`registry-${id}`).locator(`[data-field="${field}"]`);
const imageB = (page: Page) => item(page, "image-b");

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("element has no bounding box");
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
  };
}

async function detachB(page: Page) {
  await page.getByRole("button", { name: "Detach Image B" }).click();
  await expect(imageB(page)).toHaveAttribute("data-status", "detached");
  await expect(panel(page, "image-b")).toHaveCSS("position", "fixed");
}

async function attachB(page: Page) {
  await page.getByRole("button", { name: "Attach Image B" }).click();
  await expect(imageB(page)).toHaveAttribute("data-status", "attached");
}

/** Drags the panel by its title bar with real mouse input. */
async function dragB(page: Page, dx: number, dy: number) {
  const title = await box(panelBar(page, "image-b").locator("span"));
  const x = title.x + 5;
  const y = title.y + title.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

/**
 * Drags the panel so its top-left corner is at (x, y), leaving room on every
 * side, so later gestures stay inside the viewport and are not clamped.
 */
async function placeB(page: Page, x: number, y: number) {
  const start = await box(panel(page, "image-b"));
  await dragB(page, x - start.x, y - start.y);
  await expect
    .poll(async () => {
      const now = await box(panel(page, "image-b"));
      return { x: now.x, y: now.y };
    })
    .toEqual({ x, y });
}

/** Resizes the panel from its bottom-right handle with real mouse input. */
async function resizeB(page: Page, dx: number, dy: number) {
  const handle = await box(resizeHandle(page, "image-b"));
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

const sharedCountApp = (page: Page) => page.getByTestId("shared-count-app");
const sharedCountB = (page: Page) =>
  imageB(page).getByTestId("shared-count-image-b");
const incrementCalls = (page: Page) => page.getByTestId("increment-calls");
const activeSubscriptions = (page: Page) =>
  page.getByTestId("active-subscriptions");
const localCount = (page: Page) => imageB(page).getByTestId("count");
const localButton = (page: Page) =>
  imageB(page).getByTestId("live-counter").getByRole("button");

/** Marks a DOM node so a later check can tell if it was replaced. */
async function tag(locator: Locator, value: string) {
  await locator.evaluate((element, v) => {
    (element as HTMLElement).dataset.e2eTag = v;
  }, value);
}

// --- Tests -----------------------------------------------------------------

test("A. renders Images A, B and C", async ({ page }) => {
  for (const id of ["image-a", "image-b", "image-c"]) {
    await expect(item(page, id)).toHaveAttribute("data-status", "attached");
    const img = item(page, id).locator("img");
    await expect(img).toBeVisible();
    expect(
      await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    ).toBe(true);
  }
  await expect(page.locator("[data-spatialflex-item]")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Registry (3)" }),
  ).toBeVisible();
});

test("B. detaches Image B without moving Images A and C", async ({ page }) => {
  const before = {
    a: await box(item(page, "image-a")),
    c: await box(item(page, "image-c")),
    slot: await box(imageB(page)),
  };

  await detachB(page);

  expect(await box(item(page, "image-a"))).toEqual(before.a);
  expect(await box(item(page, "image-c"))).toEqual(before.c);
  // The panel opens over the original placement.
  const opened = await box(panel(page, "image-b"));
  expect({ x: opened.x, y: opened.y }).toEqual({
    x: before.slot.x,
    y: before.slot.y,
  });
  await expect(registryField(page, "image-b", "status")).toHaveText("detached");
});

test("C. drags Image B to a new position", async ({ page }) => {
  await detachB(page);
  await placeB(page, 200, 150);
  const start = await box(panel(page, "image-b"));

  await dragB(page, 180, 90);

  await expect
    .poll(async () => {
      const now = await box(panel(page, "image-b"));
      return { x: now.x - start.x, y: now.y - start.y };
    })
    .toEqual({ x: 180, y: 90 });
  await expect(registryField(page, "image-b", "position")).toHaveText(
    `${start.x + 180}, ${start.y + 90}`,
  );
});

test("C. keeps dragging upward when the image passes under the press point", async ({
  page,
}) => {
  // Regression: Chromium started a native image drag-and-drop here, which
  // cancelled the pointer stream and stopped the panel after one step.
  await detachB(page);
  const start = await box(panel(page, "image-b"));

  await dragB(page, -100, -250);

  await expect
    .poll(async () => {
      const now = await box(panel(page, "image-b"));
      return { x: now.x - start.x, y: now.y - start.y };
    })
    .toEqual({ x: -100, y: -250 });
});

test("D. resizes Image B to the dragged dimensions", async ({ page }) => {
  await detachB(page);
  await placeB(page, 200, 150);
  const start = await box(panel(page, "image-b"));

  await resizeB(page, 120, 60);

  await expect
    .poll(async () => {
      const now = await box(panel(page, "image-b"));
      return { width: now.width, height: now.height, x: now.x, y: now.y };
    })
    .toEqual({
      width: start.width + 120,
      height: start.height + 60,
      x: start.x,
      y: start.y,
    });
  await expect(registryField(page, "image-b", "size")).toHaveText(
    `${start.width + 120} × ${start.height + 60}`,
  );
  // Content follows the panel: the image fills the wider panel.
  const img = await box(panel(page, "image-b").locator("img"));
  expect(img.width).toBeGreaterThan(start.width);
});

test("E. keeps the original placeholder size while resizing", async ({
  page,
}) => {
  const original = await box(imageB(page));
  await detachB(page);
  await placeB(page, 600, 100);

  await resizeB(page, 150, 120);
  await expect(registryField(page, "image-b", "size")).not.toHaveText(
    "natural",
  );

  expect(await box(imageB(page))).toEqual(original);
  await resizeB(page, -100, -150);
  expect(await box(imageB(page))).toEqual(original);
});

test("F. updates detached Image B's variant and caption from the app", async ({
  page,
}) => {
  await detachB(page);
  const img = panel(page, "image-b").locator("img");
  await tag(img, "original-img");

  await page.getByTestId("image-b-variant").selectOption("night");
  await page.getByTestId("image-b-caption").fill("Night shift (E2E)");

  await expect(img).toHaveAttribute("alt", "Image B · night");
  await expect(panel(page, "image-b").locator("figcaption")).toHaveText(
    "Night shift (E2E)",
  );
  expect(decodeURIComponent((await img.getAttribute("src")) ?? "")).toContain(
    "#1e3a8a",
  );
  // Same <img> element, updated in place.
  await expect(img).toHaveAttribute("data-e2e-tag", "original-img");
  await expect(page.locator('img[alt^="Image B"]')).toHaveCount(1);
});

test("G. app increments reach detached Image B", async ({ page }) => {
  await detachB(page);

  await page.getByTestId("increment-app").click();
  await page.getByTestId("increment-app").click();

  await expect(sharedCountB(page)).toHaveText("2");
  await expect(sharedCountApp(page)).toHaveText("2");
});

test("H. detached Image B increments reach the app", async ({ page }) => {
  await detachB(page);

  await imageB(page).getByTestId("increment-image-b").click();

  await expect(sharedCountApp(page)).toHaveText("1");
  await expect(sharedCountB(page)).toHaveText("1");
});

test("I. one click runs exactly one domain action", async ({ page }) => {
  await page.getByTestId("increment-app").click();
  await expect(incrementCalls(page)).toHaveText("1");

  await detachB(page);
  await imageB(page).getByTestId("increment-image-b").click();
  await expect(incrementCalls(page)).toHaveText("2");

  await placeB(page, 600, 100);
  await resizeB(page, 40, 40);
  await expect(incrementCalls(page)).toHaveText("2");

  await page.getByTestId("increment-app").click();
  await attachB(page);
  await imageB(page).getByTestId("increment-image-b").click();

  await expect(incrementCalls(page)).toHaveText("4");
  await expect(sharedCountApp(page)).toHaveText("4");
  await expect(sharedCountB(page)).toHaveText("4");
});

test("J. keeps local React state and component identity through detach, resize, move and attach", async ({
  page,
}) => {
  const instance = await imageB(page).getByTestId("instance").textContent();
  const lifecycle = await imageB(page).getByTestId("lifecycle").textContent();
  await tag(imageB(page).getByTestId("live-counter"), "original-counter");

  for (let i = 0; i < 5; i++) await localButton(page).click();
  await expect(localCount(page)).toHaveText("5");

  await detachB(page);
  await expect(localCount(page)).toHaveText("5");
  await placeB(page, 600, 100);
  await resizeB(page, 80, 60);
  await dragB(page, -100, 50);
  await localButton(page).click();
  await expect(localCount(page)).toHaveText("6");
  await attachB(page);

  // Local state and identity, asserted separately from domain state.
  await expect(localCount(page)).toHaveText("6");
  await expect(imageB(page).getByTestId("instance")).toHaveText(instance!);
  await expect(imageB(page).getByTestId("lifecycle")).toHaveText(lifecycle!);
  await expect(imageB(page).getByTestId("live-counter")).toHaveAttribute(
    "data-e2e-tag",
    "original-counter",
  );
  // Local clicks are not domain actions.
  await expect(incrementCalls(page)).toHaveText("0");
  await expect(sharedCountApp(page)).toHaveText("0");
});

test("K. 20 detach/attach cycles add no elements, handlers or subscriptions", async ({
  page,
}) => {
  const subscriptions = await activeSubscriptions(page).textContent();
  const totals = await page.getByTestId("subscription-totals").textContent();
  const instance = await imageB(page).getByTestId("instance").textContent();

  for (let i = 0; i < 20; i++) {
    await detachB(page);
    await attachB(page);
  }

  await expect(activeSubscriptions(page)).toHaveText(subscriptions!);
  await expect(page.getByTestId("subscription-totals")).toHaveText(totals!);
  await expect(page.locator("[data-spatialflex-panel-bar]")).toHaveCount(0);
  await expect(page.locator("[data-spatialflex-resize-handle]")).toHaveCount(0);
  await expect(page.locator('[data-testid="live-counter"]')).toHaveCount(1);
  await expect(page.locator('img[alt^="Image B"]')).toHaveCount(1);
  await expect(imageB(page).getByTestId("instance")).toHaveText(instance!);

  await imageB(page).getByTestId("increment-image-b").click();
  await expect(incrementCalls(page)).toHaveText("1");
  await expect(sharedCountApp(page)).toHaveText("1");
});

test("L. Attach restores the original layout", async ({ page }) => {
  const before = {
    a: await box(item(page, "image-a")),
    b: await box(imageB(page)),
    c: await box(item(page, "image-c")),
  };
  await detachB(page);
  await placeB(page, 600, 100);
  await resizeB(page, 100, 80);

  await attachB(page);

  await expect(panel(page, "image-b")).toHaveCSS("position", "static");
  expect(await box(item(page, "image-a"))).toEqual(before.a);
  expect(await box(imageB(page))).toEqual(before.b);
  expect(await box(item(page, "image-c"))).toEqual(before.c);
  expect(await box(panel(page, "image-b"))).toEqual(before.b);
  await expect(panelBar(page, "image-b")).toHaveCount(0);
  await expect(resizeHandle(page, "image-b")).toHaveCount(0);
});

test("M. non-resizable items expose no resize control", async ({ page }) => {
  await page.getByRole("button", { name: "Detach Image C" }).click();
  await expect(item(page, "image-c")).toHaveAttribute(
    "data-status",
    "detached",
  );

  await expect(panelBar(page, "image-c")).toBeVisible();
  await expect(resizeHandle(page, "image-c")).toHaveCount(0);
  await expect(panelBar(page, "image-c")).toHaveAttribute(
    "data-movable",
    "false",
  );
  await expect(registryField(page, "image-c", "capabilities")).toHaveText(
    "detachable",
  );

  await detachB(page);
  await expect(resizeHandle(page, "image-b")).toHaveCount(1);
});

test.describe("N. boundaries and cleanup", () => {
  test("keeps the minimum panel size", async ({ page }) => {
    await detachB(page);
    await placeB(page, 600, 100);
    await resizeB(page, -500, -500);

    await expect
      .poll(async () => {
        const now = await box(panel(page, "image-b"));
        return { width: now.width, height: now.height };
      })
      .toEqual(MIN_PANEL);
  });

  test("keeps the panel inside the viewport", async ({ page }) => {
    await detachB(page);
    await dragB(page, 2000, 2000);
    await resizeB(page, 2000, 2000);

    const viewport = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }));
    const now = await box(panel(page, "image-b"));
    expect(now.x).toBeGreaterThanOrEqual(0);
    expect(now.y).toBeGreaterThanOrEqual(0);
    expect(now.x + now.width).toBeLessThanOrEqual(viewport.width);
    expect(now.y + now.height).toBeLessThanOrEqual(viewport.height);
  });

  test("restores the last panel size and position on the next detach", async ({
    page,
  }) => {
    await detachB(page);
    await placeB(page, 600, 100);
    await resizeB(page, 60, 30);
    const last = await box(panel(page, "image-b"));

    await attachB(page);
    await detachB(page);

    expect(await box(panel(page, "image-b"))).toEqual(last);
  });

  test("ends a resize on mouse release", async ({ page }) => {
    await detachB(page);
    await placeB(page, 600, 100);
    await resizeB(page, 50, 50);
    const after = await box(panel(page, "image-b"));

    // Moving the mouse after release must not keep resizing.
    await page.mouse.move(
      after.x + after.width + 200,
      after.y + after.height + 200,
      { steps: 4 },
    );

    expect(await box(panel(page, "image-b"))).toEqual(after);
  });
});

test("known limitation: a transformed, clipping ancestor offsets and clips the panel", async ({
  page,
}) => {
  await page.goto("/#containing-block-fixture");
  await page.reload();
  const ancestor = await box(page.getByTestId("problem-ancestor"));

  await page.getByRole("button", { name: "Detach fixture item" }).click();
  const fixture = item(page, "fixture-item");
  await expect(fixture).toHaveAttribute("data-status", "detached");

  // The registry position is in viewport coordinates, but the transformed
  // ancestor is the containing block, so the panel is shifted by its offset.
  const style = await panel(page, "fixture-item").evaluate((el) => ({
    left: parseFloat((el as HTMLElement).style.left),
    top: parseFloat((el as HTMLElement).style.top),
  }));
  const actual = await box(panel(page, "fixture-item"));
  expect(actual.x).not.toBe(style.left);
  expect(
    Math.abs(actual.x - (ancestor.x + 2 + style.left)),
  ).toBeLessThanOrEqual(1);

  // And overflow: hidden on the ancestor clips it.
  const panelBottom = actual.y + actual.height;
  const ancestorBottom = ancestor.y + ancestor.height;
  expect(panelBottom).toBeGreaterThan(ancestorBottom);
  const hit = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x!, y!)?.closest("[data-spatialflex-panel]") !==
      null,
    [actual.x + 10, ancestorBottom + 5],
  );
  expect(hit).toBe(false);
});
