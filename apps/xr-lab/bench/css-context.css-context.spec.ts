import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/research-css-context.html");
  await expect(page.getByTestId("card")).toBeVisible();
});

test("direct move characterizes CSS, React identity and restoration", async ({
  page,
}) => {
  const card = page.getByTestId("card"),
    counter = page.getByTestId("counter"),
    input = page.getByTestId("input"),
    query = page.getByTestId("query");
  await counter.click();
  await input.fill("edited");
  const before = await card.evaluate((el) => {
    (window as unknown as { reference: Element }).reference = el;
    return {
      background: getComputedStyle(el).backgroundColor,
      border: getComputedStyle(el).borderTopColor,
    };
  });
  const buttonColor = await counter.evaluate(
    (el) => getComputedStyle(el).color,
  );
  const querySize = await query.evaluate((el) => getComputedStyle(el).fontSize);
  await page.locator("#direct").click();
  expect(
    await card.evaluate(
      (el) => el === (window as unknown as { reference: Element }).reference,
    ),
  ).toBe(true);
  expect(
    await card.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe(before.background);
  expect(await counter.evaluate((el) => getComputedStyle(el).color)).not.toBe(
    buttonColor,
  );
  expect(await query.evaluate((el) => getComputedStyle(el).fontSize)).not.toBe(
    querySize,
  );
  await expect(counter).toHaveText("Count: 1");
  await expect(input).toHaveValue("edited");
  await page.locator("#original").click();
  await expect(card).toHaveCSS("background-color", before.background);
  await counter.click();
  await expect(counter).toHaveText("Count: 2");
  await input.fill("restored");
  await expect(input).toHaveValue("restored");
  await page.locator("#unmount").click();
  await expect(card).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-card-mounted", "no");
});

test("computed snapshot is static across theme changes", async ({ page }) => {
  const card = page.getByTestId("card"),
    counter = page.getByTestId("counter");
  const before = await counter.evaluate((el) => getComputedStyle(el).color);
  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.locator("#snapshot").click();
  await expect(counter).toHaveCSS("color", before);
  await expect(card).toHaveCSS("background-color", bg);
  await page.locator("#theme").click();
  await expect(counter).toHaveCSS("color", before);
  await page.locator("#original").click();
  await expect(counter).not.toHaveCSS("color", before);
});

test("transform preserves ancestry and layout slot", async ({ page }) => {
  const card = page.getByTestId("card");
  const before = await card.evaluate((el) => ({
    parent: el.parentElement?.className,
    width: (el as HTMLElement).offsetWidth,
    left: el.getBoundingClientRect().left,
  }));
  await page.locator("#transform").click();
  const after = await card.evaluate((el) => ({
    parent: el.parentElement?.className,
    width: (el as HTMLElement).offsetWidth,
    left: el.getBoundingClientRect().left,
  }));
  expect(after.parent).toBe(before.parent);
  expect(after.width).toBe(before.width);
  expect(after.left).not.toBe(before.left);
  await page.getByTestId("counter").click();
  await expect(page.getByTestId("counter")).toHaveText("Count: 1");
});

test("move characterizes focus and delegated events outside the React root", async ({
  page,
}, testInfo) => {
  const counter = page.getByTestId("counter"),
    input = page.getByTestId("input");
  await input.focus();
  const observations = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="input"]',
    )!;
    document.querySelector<HTMLButtonElement>("#direct")!.click();
    return {
      focusRetained: document.activeElement === input,
      moveBeforeAvailable: "moveBefore" in Element.prototype,
    };
  });
  await counter.click();
  const countAfterClick = await counter.textContent();
  await input.fill("outside");
  await page.locator("#original").click();
  await counter.click();
  await expect(counter).toHaveText("Count: 1");
  await expect(input).toHaveValue("initial");
  await testInfo.attach("observations.json", {
    body: JSON.stringify({ ...observations, countAfterClick }),
    contentType: "application/json",
  });
  expect(observations.focusRetained).toBe(false);
  expect(countAfterClick).toBe("Count: 0");
});

test("React rerender retains moved node and state", async ({ page }) => {
  const card = page.getByTestId("card"),
    counter = page.getByTestId("counter");
  await counter.click();
  await card.evaluate((el) => {
    (window as unknown as { reference: Element }).reference = el;
  });
  await page.locator("#direct").click();
  await page.getByTestId("rerender").click();
  expect(
    await card.evaluate(
      (el) => el === (window as unknown as { reference: Element }).reference,
    ),
  ).toBe(true);
  await expect(counter).toHaveText("Count: 1");
  await page.locator("#original").click();
  await counter.click();
  await expect(counter).toHaveText("Count: 2");
});

test("measure style, geometry, pixels and synchronous move cost", async ({
  page,
  browserName,
}) => {
  for (const mode of ["direct", "snapshot", "transform"] as const) {
    await page.reload();
    await expect(page.getByTestId("card")).toBeVisible();
    const card = page.getByTestId("card");
    const values = async () =>
      card.evaluate((el) => {
        const style = getComputedStyle(el),
          rect = el.getBoundingClientRect();
        const button = getComputedStyle(el.querySelector("button")!);
        return {
          styles: [
            style.backgroundColor,
            style.color,
            style.paddingTop,
            style.borderTopColor,
            button.color,
            getComputedStyle(el.querySelector(".query")!).fontSize,
          ],
          width: rect.width,
          height: rect.height,
        };
      });
    const capture = async () => {
      const box = await card.boundingBox();
      if (!box) throw new Error("Missing card bounds");
      return page.screenshot({
        clip: { x: box.x, y: box.y, width: 280, height: 140 },
      });
    };
    const before = await values();
    const original = await capture();
    await page.locator(`#${mode}`).click();
    const after = await values();
    const moved = await capture();
    const pixel = await page.evaluate(
      async ({ a, b }) => {
        const image = (src: string) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
          });
        const [first, second] = await Promise.all([image(a), image(b)]);
        const width = Math.min(first.naturalWidth, second.naturalWidth),
          height = Math.min(first.naturalHeight, second.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(first, 0, 0);
        const x = ctx.getImageData(0, 0, width, height).data;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(second, 0, 0);
        const y = ctx.getImageData(0, 0, width, height).data;
        let changed = 0;
        for (let i = 0; i < x.length; i += 4)
          if (
            x[i] !== y[i] ||
            x[i + 1] !== y[i + 1] ||
            x[i + 2] !== y[i + 2] ||
            x[i + 3] !== y[i + 3]
          )
            changed++;
        return { changed, total: width * height };
      },
      {
        a: `data:image/png;base64,${original.toString("base64")}`,
        b: `data:image/png;base64,${moved.toString("base64")}`,
      },
    );
    const timing = await page.evaluate((id) => {
      const times: number[] = [];
      const action = document.querySelector<HTMLButtonElement>(`#${id}`)!;
      const restore = document.querySelector<HTMLButtonElement>("#original")!;
      for (let i = 0; i < 30; i++) {
        const t = performance.now();
        action.click();
        document.body.getBoundingClientRect();
        restore.click();
        document.body.getBoundingClientRect();
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      return { median: times[15], p95: times[28] };
    }, mode);
    console.log(
      JSON.stringify({
        browserName,
        mode,
        before,
        after,
        matching: before.styles.filter((s, i) => s === after.styles[i]).length,
        pixel,
        timing,
      }),
    );
  }
});

test("snapshot freezes container query values on resize", async ({ page }) => {
  const query = page.getByTestId("query");
  await expect(query).toHaveCSS("font-size", "24px");
  await page.locator("#resize").click();
  await expect(query).toHaveCSS("font-size", "12px");
  await page.locator("#resize").click();
  await expect(query).toHaveCSS("font-size", "24px");
  await page.locator("#snapshot").click();
  await page.locator("#resize").click();
  await expect(query).toHaveCSS("font-size", "24px");
  await page.locator("#original").click();
  await expect(query).toHaveCSS("font-size", "12px");
});

test("unmount while moved characterizes orphan DOM", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#direct").click();
  await page.locator("#unsafe-unmount").click();
  await expect(page.locator("html")).toHaveAttribute("data-card-mounted", "no");
  await expect(page.getByTestId("card")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("ancestor overflow clips transformed content and hit testing", async ({
  page,
}) => {
  await page.locator("#resize").click();
  await page.locator("#transform").click();
  const observation = await page.getByTestId("card").evaluate((card) => {
    const parent = card.parentElement!;
    const a = card.getBoundingClientRect(),
      b = parent.getBoundingClientRect();
    const x = b.right + 2,
      y = Math.max(a.top, b.top) + 20;
    return {
      extendsOutside: a.right > x,
      clippedHit: !card.contains(document.elementFromPoint(x, y)),
    };
  });
  expect(observation.extendsOutside).toBe(true);
  expect(observation.clippedHit).toBe(true);
});

test("normal restore and unmount produce no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      errors.push(message.text());
  });
  await page.locator("#direct").click();
  await page.locator("#original").click();
  await page.getByTestId("counter").click();
  await page.locator("#unmount").click();
  expect(errors).toEqual([]);
});
