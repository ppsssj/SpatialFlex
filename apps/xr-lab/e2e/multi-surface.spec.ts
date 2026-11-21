import { expect, test, type Page } from "@playwright/test";

/**
 * P1-08B1 Multi-Surface runtime fixture (`multi-surface.html`): two
 * independent React Surfaces, each with its own <SpatialWorkspace>,
 * SpatialRegistry and PresentationRuntime, in one WorkspaceCoordinator.
 * Real clicks and typing only; `__multiSurfaceLab` is a read-only probe.
 */

interface Probe {
  surfaces(): {
    id: string;
    epoch: number;
    registration: string | null;
    presentations: number;
    x: number;
  }[];
  presentations(): string[];
}
const probe = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __multiSurfaceLab: Probe }
    ).__multiSurfaceLab.surfaces(),
  );
const live = (page: Page) => page.getByTestId("live-surfaces");
const log = (page: Page) => page.getByTestId("log").locator("li");

async function open(page: Page) {
  await page.goto("/multi-surface.html");
  await page.waitForFunction(
    () =>
      "__multiSurfaceLab" in window &&
      document.querySelectorAll(
        ".multi-surface[data-epoch]:not([data-epoch=''])",
      ).length === 2,
  );
}

test("two Surfaces register independently with the same item id", async ({
  page,
}) => {
  await open(page);
  const s = await probe(page);
  expect(s.map((x) => x.id)).toEqual(["A", "B"]);
  expect(s[0]!.epoch).not.toBe(s[1]!.epoch);
  expect(s[0]!.registration).not.toBeNull();
  expect(s[1]!.registration).not.toBeNull();
  expect(s[0]!.registration).not.toBe(s[1]!.registration);
  await expect(live(page)).toHaveText(
    `live: A@${s[0]!.epoch}, B@${s[1]!.epoch}`,
  );
});

test("state, input and XR actions stay within their Surface", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("A-counter").click();
  await page.getByTestId("A-counter").click();
  await page.getByTestId("B-counter").click();
  await page.getByTestId("A-input").fill("");
  await page.getByTestId("A-input").pressSequentially("alpha");
  await page.getByTestId("B-input").pressSequentially("beta");
  await expect(page.getByTestId("A-counter")).toHaveText("A count 2");
  await expect(page.getByTestId("B-counter")).toHaveText("B count 1");
  await expect(page.getByTestId("A-input")).toHaveValue("alpha");
  await expect(page.getByTestId("B-input")).toHaveValue("beta");

  await page.getByTestId("A-present").click();
  await page.getByTestId("B-present").click();
  // Per-runtime instance ids: the same string on both Surfaces.
  await expect(page.getByTestId("A-presentations")).toHaveText(
    "presentations: adaptive:adaptive-1",
  );
  await expect(page.getByTestId("B-presentations")).toHaveText(
    "presentations: adaptive:adaptive-1",
  );
  await page.getByTestId("A-run").click();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 3");
  await expect(page.getByTestId("B-counter")).toHaveText("B count 1");
  await page.getByTestId("B-run").click();
  await expect(page.getByTestId("B-counter")).toHaveText("B count 2");
  await expect(page.getByTestId("A-counter")).toHaveText("A count 3");
  await expect(log(page)).toHaveText([
    /^present A@\d+\/chart\/adaptive-1$/,
    /^present B@\d+\/chart\/adaptive-1$/,
    /^invoke A@\d+\/chart\/adaptive-1 → accepted$/,
    /^invoke B@\d+\/chart\/adaptive-1 → accepted$/,
  ]);
});

test("removing A keeps B; re-adding A gets a new epoch and refuses old refs", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("B-counter").click();
  await page.getByTestId("B-input").pressSequentially("kept");
  await page.getByTestId("A-present").click();
  await page.getByTestId("B-present").click();
  const before = await probe(page);
  const oldA = before.find((s) => s.id === "A")!.epoch;
  await page.evaluate(() => {
    (window as unknown as { __bNode: Element }).__bNode =
      document.querySelector('[data-testid="B-counter"]')!;
  });

  await page.getByTestId("toggle-A").click();
  await expect(live(page)).toHaveText(/^live: B@\d+$/);
  await expect(page.locator('[data-surface="A"]')).toHaveCount(0);
  // B: same DOM node, same state, its presentation still live.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __bNode: Element }).__bNode ===
        document.querySelector('[data-testid="B-counter"]'),
    ),
  ).toBe(true);
  await expect(page.getByTestId("B-counter")).toHaveText("B count 1");
  await expect(page.getByTestId("B-input")).toHaveValue("kept");
  await expect(page.getByTestId("B-presentations")).toHaveText(
    "presentations: adaptive:adaptive-1",
  );
  // The saved A reference now designates a removed incarnation.
  await page.getByTestId("replay-A").click();
  await expect(log(page).last()).toHaveText(
    new RegExp(`^replay A@${oldA}/chart/adaptive-1 → refused$`),
  );
  await page.getByTestId("B-run").click();
  await expect(page.getByTestId("B-counter")).toHaveText("B count 2");

  await page.getByTestId("toggle-A").click();
  await expect(live(page)).toHaveText(/^live: B@\d+, A@\d+$/);
  const after = await probe(page);
  const newA = after.find((s) => s.id === "A")!.epoch;
  expect(newA).toBeGreaterThan(oldA);
  await expect(page.getByTestId("A-counter")).toHaveText("A count 0");
  // Same item id, new Surface epoch: the old ref stays refused, even after
  // the new incarnation presents an instance with the same instance id.
  await page.getByTestId("A-present").click();
  await expect(page.getByTestId("A-presentations")).toHaveText(
    "presentations: adaptive:adaptive-1",
  );
  // `replay-A` now holds the NEW ref (A-present saved it); the old one was
  // refused above. A new action through the new ref is accepted.
  await page.getByTestId("A-run").click();
  await expect(page.getByTestId("A-counter")).toHaveText("A count 1");
  await expect(log(page).last()).toHaveText(
    new RegExp(`^invoke A@${newA}/chart/adaptive-1 → accepted$`),
  );
});

test("Surface pose moves without re-registering", async ({ page }) => {
  await open(page);
  const before = await probe(page);
  await page.getByTestId("A-move").click();
  await page.getByTestId("A-move").click();
  const after = await probe(page);
  const a0 = before.find((s) => s.id === "A")!;
  const a1 = after.find((s) => s.id === "A")!;
  expect(a1.epoch).toBe(a0.epoch);
  expect(a1.x).toBeCloseTo(a0.x + 0.2, 6);
  expect(after.find((s) => s.id === "B")!.x).toBe(
    before.find((s) => s.id === "B")!.x,
  );
});

test("repeated remove/re-add leaves exactly two Surfaces and no stale presentations", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("B-present").click();
  let lastEpoch = 0;
  for (let i = 0; i < 10; i++) {
    await page.getByTestId("A-present").click();
    await page.getByTestId("toggle-A").click();
    await expect(live(page)).toHaveText(/^live: B@\d+$/);
    await page.getByTestId("toggle-A").click();
    await expect(live(page)).toHaveText(/^live: B@\d+, A@\d+$/);
    const a = (await probe(page)).find((s) => s.id === "A")!;
    expect(a.epoch).toBeGreaterThan(lastEpoch);
    lastEpoch = a.epoch;
  }
  const s = await probe(page);
  expect(s.map((x) => x.id)).toEqual(["B", "A"]);
  expect(s.find((x) => x.id === "A")!.presentations).toBe(0);
  expect(s.find((x) => x.id === "B")!.presentations).toBe(1);
  await expect(page.locator(".multi-surface")).toHaveCount(2);
  const presentations = await page.evaluate(() =>
    (
      window as unknown as { __multiSurfaceLab: Probe }
    ).__multiSurfaceLab.presentations(),
  );
  expect(presentations).toEqual([
    expect.stringMatching(/^B@\d+\/chart\/adaptive-1$/),
  ]);
});
