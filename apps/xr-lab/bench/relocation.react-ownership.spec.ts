import { test, expect } from "@playwright/test";
type Probe = {
  move: (destination: string, method: string) => string;
  restore: () => void;
  log: string[];
  unmount: () => void;
  supported: () => boolean;
  parentClicks: () => number;
};
test.beforeEach(async ({ page }) => {
  await page.goto("/research-react-ownership.html");
  await expect(page.getByTestId("card")).toBeVisible();
});

test("same-root append preserves React events while restore permits cleanup", async ({
  page,
}) => {
  const card = page.getByTestId("card"),
    counter = page.getByTestId("counter"),
    input = page.getByTestId("input");
  await counter.click();
  await input.fill("edited");
  await card.evaluate((el) => {
    (window as unknown as { saved: Element }).saved = el;
  });
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "same",
      "append",
    ),
  );
  expect(
    await card.evaluate(
      (el) => el === (window as unknown as { saved: Element }).saved,
    ),
  ).toBe(true);
  await counter.click();
  await expect(counter).toHaveText("Count: 2");
  await input.fill("next");
  await page.getByTestId("rerender").click();
  await expect(input).toHaveValue("next");
  await expect(page.getByTestId("context")).toHaveText("ocean");
  const clicks = await page.evaluate(() =>
    (
      window as unknown as { ownershipProbe: Probe }
    ).ownershipProbe.parentClicks(),
  );
  expect(clicks).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.restore();
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.unmount();
  });
  await expect(card).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { ownershipProbe: Probe }
        ).ownershipProbe.log.filter((x) => x === "cleanup").length,
    ),
  ).toBe(1);
});

test("outside-root append retains node but not delegated React events", async ({
  page,
}) => {
  const counter = page.getByTestId("counter");
  await counter.click();
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "outside",
      "append",
    ),
  );
  await counter.click();
  await expect(counter).toHaveText("Count: 1");
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.restore(),
  );
  await counter.click();
  await expect(counter).toHaveText("Count: 2");
});

test("stable portal keeps context and event bubbling; retarget remounts", async ({
  page,
}) => {
  await page.goto("/research-react-ownership.html?mode=portal");
  const card = page.getByTestId("card"),
    counter = page.getByTestId("counter"),
    input = page.getByTestId("input");
  await expect(card).toBeVisible();
  const beforeClicks = await page.evaluate(() =>
    (
      window as unknown as { ownershipProbe: Probe }
    ).ownershipProbe.parentClicks(),
  );
  await counter.click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { ownershipProbe: Probe }
      ).ownershipProbe.parentClicks(),
    ),
  ).toBe(beforeClicks + 1);
  await input.fill("edited");
  await card.evaluate((el) => {
    (window as unknown as { saved: Element }).saved = el;
  });
  await page.getByTestId("rerender").click();
  await expect(counter).toHaveText("Count: 1");
  await expect(input).toHaveValue("edited");
  expect(
    await card.evaluate(
      (el) => el === (window as unknown as { saved: Element }).saved,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { ownershipProbe: Probe }
      ).ownershipProbe.parentClicks(),
    ),
  ).toBeGreaterThan(0);
  await expect(page.getByTestId("context")).toHaveText("ocean");
  await page.getByTestId("switch-portal").click();
  await expect(counter).toHaveText("Count: 0");
  await expect(input).toHaveValue("initial");
  expect(
    await card.evaluate(
      (el) => el === (window as unknown as { saved: Element }).saved,
    ),
  ).toBe(false);
  const log = await page.evaluate(
    () => (window as unknown as { ownershipProbe: Probe }).ownershipProbe.log,
  );
  expect(log.filter((x) => x === "mount")).toHaveLength(2);
  expect(log.filter((x) => x === "cleanup")).toHaveLength(1);
  await counter.click();
  await expect(counter).toHaveText("Count: 1");
});

test("turning an already-mounted child into a portal remounts", async ({
  page,
}) => {
  await page.getByTestId("counter").click();
  await page.getByTestId("toggle-portal").click();
  await expect(page.getByTestId("counter")).toHaveText("Count: 0");
  const log = await page.evaluate(
    () => (window as unknown as { ownershipProbe: Probe }).ownershipProbe.log,
  );
  expect(log.filter((x) => x === "mount")).toHaveLength(2);
  expect(log.filter((x) => x === "cleanup")).toHaveLength(1);
});

test("repeat relocation twenty times then restore and unmount", async ({
  page,
}) => {
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
        "same",
        "append",
      );
      (window as unknown as { ownershipProbe: Probe }).ownershipProbe.restore();
    }
  });
  await page.getByTestId("counter").click();
  await expect(page.getByTestId("counter")).toHaveText("Count: 1");
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.unmount(),
  );
  await expect(page.getByTestId("card")).toHaveCount(0);
});

test("unmount while moved leaves orphan under destination", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "same",
      "append",
    );
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.unmount();
  });
  await expect(page.getByTestId("card")).toHaveCount(0);
  // Both source and target belong to the same removed React root.
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { ownershipProbe: Probe }
        ).ownershipProbe.log.filter((x) => x === "cleanup").length,
    ),
  ).toBe(1);
});

test("StrictMode logs development mount and cleanup", async ({ page }) => {
  await page.goto("/research-react-ownership.html?strict=1");
  await expect(page.getByTestId("card")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { ownershipProbe: Probe }
          ).ownershipProbe.log.filter((x) => x === "mount").length,
      ),
    )
    .toBe(2);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { ownershipProbe: Probe }
        ).ownershipProbe.log.filter((x) => x === "cleanup").length,
    ),
  ).toBe(1);
});

for (const method of ["append", "insertBefore", "moveBefore"] as const)
  test(`${method} browser state and lifecycle`, async ({ page }, testInfo) => {
    if (method === "moveBefore")
      test.skip(
        !(await page.evaluate(() =>
          (
            window as unknown as { ownershipProbe: Probe }
          ).ownershipProbe.supported(),
        )),
        "Element.moveBefore unavailable",
      );
    const result = await page.evaluate((method) => {
      const input = document.querySelector<HTMLInputElement>(
        "[data-testid=input]",
      )!;
      input.focus();
      input.setSelectionRange(1, 4);
      const card = document.querySelector("[data-testid=card]")!;
      const animation = card.getAnimations()[0];
      const before = animation?.currentTime;
      const logStart = (window as unknown as { ownershipProbe: Probe })
        .ownershipProbe.log.length;
      const result = (
        window as unknown as { ownershipProbe: Probe }
      ).ownershipProbe.move("same", method);
      return {
        result,
        focus: document.activeElement === input,
        selection: [input.selectionStart, input.selectionEnd],
        sameAnimation: card.getAnimations()[0] === animation,
        before,
        after: animation?.currentTime,
        log: (
          window as unknown as { ownershipProbe: Probe }
        ).ownershipProbe.log.slice(logStart),
      };
    }, method);
    console.log(
      JSON.stringify({ browser: testInfo.project.name, method, ...result }),
    );
    expect(result.selection).toEqual([1, 4]);
    expect(result.focus).toBe(method === "moveBefore");
    expect(result.sameAnimation).toBe(method === "moveBefore");
    expect(result.log).toEqual(
      method === "moveBefore" ? ["moved"] : ["disconnected", "connected"],
    );
    await page.getByTestId("counter").click();
    await expect(page.getByTestId("counter")).toHaveText("Count: 1");
    await page.evaluate(() =>
      (window as unknown as { ownershipProbe: Probe }).ownershipProbe.restore(),
    );
    await page.getByTestId("counter").click();
    await expect(page.getByTestId("counter")).toHaveText("Count: 2");
  });

test("CSS ancestry differs from React context after relocation and portal", async ({
  page,
}) => {
  const card = page.getByTestId("card");
  await expect(card).toHaveCSS("color", "rgb(0, 60, 220)");
  await expect(page.getByTestId("query")).toHaveCSS("font-size", "24px");
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "same",
      "append",
    ),
  );
  await page.getByTestId("theme").click();
  await expect(card).toHaveCSS("color", "rgb(210, 40, 45)");
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "outside",
      "append",
    ),
  );
  await expect(card).not.toHaveCSS("color", "rgb(210, 40, 45)");
  await expect(page.getByTestId("query")).toHaveCSS("font-size", "12px");
  await expect(page.getByTestId("context")).toHaveText("ocean");
  await page.goto("/research-react-ownership.html?mode=portal");
  await expect(page.getByTestId("context")).toHaveText("ocean");
  await expect(page.getByTestId("query")).toHaveCSS("font-size", "12px");
});

test("moveBefore outside root preserves browser focus but not React delegation", async ({
  page,
}) => {
  test.skip(
    !(await page.evaluate(() =>
      (
        window as unknown as { ownershipProbe: Probe }
      ).ownershipProbe.supported(),
    )),
    "Element.moveBefore unavailable",
  );
  const observation = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      "[data-testid=input]",
    )!;
    input.focus();
    input.setSelectionRange(1, 4);
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "outside",
      "moveBefore",
    );
    return {
      focus: document.activeElement === input,
      selection: [input.selectionStart, input.selectionEnd],
    };
  });
  expect(observation.focus).toBe(true);
  expect(observation.selection).toEqual([1, 4]);
  await expect(page.getByTestId("card")).not.toHaveCSS(
    "color",
    "rgb(0, 60, 220)",
  );
  await expect(page.getByTestId("query")).toHaveCSS("font-size", "12px");
  await page.getByTestId("counter").click();
  await expect(page.getByTestId("counter")).toHaveText("Count: 0");
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.restore(),
  );
  await page.getByTestId("counter").click();
  await expect(page.getByTestId("counter")).toHaveText("Count: 1");
});

test("direct cross-root relocation is characterized independently", async ({
  page,
}, testInfo) => {
  const before = await page.getByTestId("counter").textContent();
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "second-target",
      "append",
    ),
  );
  await page.getByTestId("counter").click();
  const after = await page.getByTestId("counter").textContent();
  console.log(
    JSON.stringify({
      browser: testInfo.project.name,
      case: "cross-root-append",
      before,
      after,
    }),
  );
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.restore(),
  );
  await expect(page.getByTestId("counter")).toHaveText("Count: 0");
});

test("portal target replacement loses focus", async ({ page }) => {
  await page.goto("/research-react-ownership.html?mode=portal");
  await page.getByTestId("input").focus();
  await page.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>("[data-testid=switch-portal]")!
      .click(),
  );
  await expect(page.getByTestId("input")).not.toBeFocused();
});

test("outside-root direct unmount leaves a cleaned-up orphan", async ({
  page,
}) => {
  await page.evaluate(() => {
    const p = (window as unknown as { ownershipProbe: Probe }).ownershipProbe;
    p.move("outside", "append");
    p.unmount();
  });
  await expect(page.getByTestId("card")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { ownershipProbe: Probe }
        ).ownershipProbe.log.filter((x) => x === "cleanup").length,
    ),
  ).toBe(1);
});

test("moving a managed child then removing it from React is unsafe", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "same",
      "append",
    ),
  );
  await page.getByTestId("remove").click();
  await page.waitForTimeout(100);
  const cardCount = await page.getByTestId("card").count();
  const log = await page.evaluate(
    () => (window as unknown as { ownershipProbe: Probe }).ownershipProbe.log,
  );
  console.log(
    JSON.stringify({
      browser: testInfo.project.name,
      case: "remove-while-moved",
      cardCount,
      errors,
      log,
    }),
  );
  expect(errors.length + cardCount).toBeGreaterThan(0);
});

test("moveBefore requires compatible connected same-document nodes", async ({
  page,
}, testInfo) => {
  test.skip(
    !(await page.evaluate(() =>
      (
        window as unknown as { ownershipProbe: Probe }
      ).ownershipProbe.supported(),
    )),
    "Element.moveBefore unavailable",
  );
  const result = await page.evaluate(() => {
    const node = document.querySelector("[data-testid=card]")!;
    const foreign = document.implementation.createHTMLDocument("foreign").body;
    const disconnected = document.createElement("div");
    const attempt = (target: Element) => {
      try {
        (
          target as Element & {
            moveBefore: (node: Node, before: Node | null) => void;
          }
        ).moveBefore(node, null);
        return "accepted";
      } catch (error) {
        return (error as Error).name;
      }
    };
    return { foreign: attempt(foreign), disconnected: attempt(disconnected) };
  });
  console.log(
    JSON.stringify({
      browser: testInfo.project.name,
      case: "moveBefore-constraints",
      ...result,
    }),
  );
  expect(result.foreign).not.toBe("accepted");
  expect(result.disconnected).not.toBe("accepted");
});

test("replacing React parent while child is moved", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "same",
      "append",
    ),
  );
  await page.getByTestId("replace-parent").click();
  const count = await page.getByTestId("card").count();
  const log = await page.evaluate(
    () => (window as unknown as { ownershipProbe: Probe }).ownershipProbe.log,
  );
  console.log(
    JSON.stringify({
      browser: testInfo.project.name,
      case: "replace-parent",
      count,
      errors,
      log,
    }),
  );
  expect(count).toBe(2);
  expect(errors).toEqual([]);
  expect(log.filter((x) => x === "cleanup").length).toBeGreaterThanOrEqual(1);
});

test("stable portal unmount cleans up its external node", async ({ page }) => {
  await page.goto("/research-react-ownership.html?mode=portal");
  await expect(page.getByTestId("card")).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.unmount(),
  );
  await expect(page.getByTestId("card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { ownershipProbe: Probe }
        ).ownershipProbe.log.filter((x) => x === "cleanup").length,
    ),
  ).toBe(1);
});

test("moveBefore outside root does not transfer React unmount ownership", async ({
  page,
}) => {
  test.skip(
    !(await page.evaluate(() =>
      (
        window as unknown as { ownershipProbe: Probe }
      ).ownershipProbe.supported(),
    )),
    "Element.moveBefore unavailable",
  );
  await page.evaluate(() => {
    const p = (window as unknown as { ownershipProbe: Probe }).ownershipProbe;
    p.move("outside", "moveBefore");
    p.unmount();
  });
  await expect(page.getByTestId("card")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { ownershipProbe: Probe }
        ).ownershipProbe.log.filter((x) => x === "cleanup").length,
    ),
  ).toBe(1);
});

test("measures card geometry before and after relocation and portal", async ({
  page,
}, testInfo) => {
  const card = page.getByTestId("card");
  const measure = async () =>
    card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
  const original = await measure();
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "same",
      "append",
    ),
  );
  const same = await measure();
  await page.evaluate(() =>
    (window as unknown as { ownershipProbe: Probe }).ownershipProbe.move(
      "outside",
      "append",
    ),
  );
  const outside = await measure();
  await page.goto("/research-react-ownership.html?mode=portal");
  await expect(card).toBeVisible();
  const portal = await measure();
  console.log(
    JSON.stringify({
      browser: testInfo.project.name,
      case: "geometry",
      original,
      same,
      outside,
      portal,
    }),
  );
  expect(same.width).toBe(original.width);
  expect(outside.width).not.toBe(original.width);
});
