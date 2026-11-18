import { expect, test, type Frame, type Page } from "@playwright/test";
import { COMBINATIONS, openLab, type Probe } from "./lab";

type Surface = Page | Frame;
const viewports = [
  { width: 1280, height: 900 },
  { width: 1100, height: 760 },
  { width: 1600, height: 1050 },
];

async function canvasGeometry(surface: Surface) {
  return surface.evaluate(() => {
    const host = document.querySelector(".xr-host")!.getBoundingClientRect();
    const toolbar = document
      .querySelector(".xr-host-bar")!
      .getBoundingClientRect();
    const canvas = document.querySelector("canvas")!;
    const box = canvas.getBoundingClientRect();
    return {
      host: { top: host.top, bottom: host.bottom, height: host.height },
      available: host.height - toolbar.height,
      canvas: { width: box.width, height: box.height, bottom: box.bottom },
      buffer: { width: canvas.width, height: canvas.height },
      viewport: innerHeight,
      scroll: document.documentElement.scrollHeight,
    };
  });
}

async function assertCanvasFillsHost(surface: Surface) {
  await expect
    .poll(async () => {
      const geometry = await canvasGeometry(surface);
      return geometry.canvas.height / geometry.available;
    })
    .toBeCloseTo(1, 2);
  const geometry = await canvasGeometry(surface);
  expect(geometry.canvas.width).toBeGreaterThan(0);
  expect(geometry.canvas.height).toBeGreaterThan(geometry.viewport * 0.65);
  expect(geometry.canvas.bottom).toBeCloseTo(geometry.host.bottom, 0);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport + 1);
  return geometry;
}

async function clickCounter(page: Page, surface: Surface, iframe: boolean) {
  await expect
    .poll(() =>
      surface.evaluate(
        () =>
          (window as unknown as { __xrHostProbe?: Probe }).__xrHostProbe?.drawn[
            "shared-counter"
          ],
      ),
    )
    .toBeTruthy();
  const point = await surface.evaluate(() =>
    (window as unknown as { __xrHostProbe?: Probe }).__xrHostProbe?.locate(
      "shared-counter",
      "button:increment",
    ),
  );
  expect(point).toBeTruthy();
  const offset = iframe
    ? await page.locator(".bridge-frame").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x + element.clientLeft, y: box.y + element.clientTop };
      })
    : { x: 0, y: 0 };
  await page.mouse.click(offset.x + point!.x, offset.y + point!.y);
}

for (const { engine, mode } of COMBINATIONS) {
  test(`${engine}/${mode}: iframe fills workspace and resizes with working canvas pointer input`, async ({
    page,
  }, testInfo) => {
    await page.goto(
      `/?bridge=iframe&engine=${engine}&integration=${mode}&xr-emulator=off`,
    );
    await expect(page.getByTestId("bridge-status")).toHaveText("connected");
    const frame = page.frames().find((f) => f.url().includes("/host.html"))!;
    await expect(frame.getByTestId("view-status")).toContainText("connected");
    await page
      .getByTestId("xr-item-shared-counter")
      .getByRole("button", { name: "Show in XR", exact: true })
      .click();
    const observations = [];
    for (const [index, viewport] of viewports.entries()) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.locator(".bridge-frame").evaluate((element) => {
            const frame = element.getBoundingClientRect();
            const bridge = element.parentElement!.getBoundingClientRect();
            const bar = element.previousElementSibling!.getBoundingClientRect();
            return frame.height / (bridge.height - bar.height);
          }),
        )
        .toBeCloseTo(1, 2);
      const parent = await page.evaluate(() => {
        const workspace = document
          .querySelector(".lab-right")!
          .getBoundingClientRect();
        const frame = document
          .querySelector(".bridge-frame")!
          .getBoundingClientRect();
        return {
          unused: (workspace.bottom - frame.bottom) / workspace.height,
          scroll: document.documentElement.scrollHeight,
          viewport: innerHeight,
        };
      });
      expect(Math.abs(parent.unused)).toBeLessThan(0.01);
      expect(parent.scroll).toBeLessThanOrEqual(parent.viewport + 1);
      const child = await frame.evaluate(() => {
        const root = document.querySelector("#root")!.getBoundingClientRect();
        const restore = document
          .querySelector("#root > button")!
          .getBoundingClientRect();
        return {
          rootHeight: root.height,
          viewport: innerHeight,
          restoreWidthRatio: restore.width / root.width,
        };
      });
      expect(child.rootHeight / child.viewport).toBeCloseTo(1, 2);
      expect(child.restoreWidthRatio).toBeLessThan(0.7);
      const geometry = await assertCanvasFillsHost(frame);
      // The backing buffer must follow CSS resize, not just stretch old pixels.
      expect(geometry.buffer.width / geometry.canvas.width).toBeCloseTo(1, 1);
      expect(geometry.buffer.height / geometry.canvas.height).toBeCloseTo(1, 1);
      observations.push({ viewport, parent, child, geometry });
      await clickCounter(page, frame, true);
      await expect(page.getByTestId("web-count")).toHaveText(String(index + 1));
      await expect(page.getByTestId("increment-calls")).toHaveText(
        String(index + 1),
      );
    }
    await testInfo.attach("geometry", {
      body: JSON.stringify(observations, null, 2),
      contentType: "application/json",
    });
  });

  test(`${engine}/${mode}: same-context host retains full-height layout after resize`, async ({
    page,
  }) => {
    await openLab(page, engine, mode);
    await page
      .getByTestId("xr-item-shared-counter")
      .getByRole("button", { name: "Show in XR", exact: true })
      .click();
    for (const [index, viewport] of viewports.entries()) {
      await page.setViewportSize(viewport);
      await assertCanvasFillsHost(page);
      const gap = await page.evaluate(() => {
        const workspace = document
          .querySelector(".lab-right")!
          .getBoundingClientRect();
        const host = document
          .querySelector(".xr-host")!
          .getBoundingClientRect();
        return (workspace.bottom - host.bottom) / workspace.height;
      });
      expect(Math.abs(gap)).toBeLessThan(0.01);
      await clickCounter(page, page, false);
      await expect(page.getByTestId("web-count")).toHaveText(String(index + 1));
    }
  });
}
