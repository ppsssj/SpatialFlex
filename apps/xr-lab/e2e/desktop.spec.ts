import { expect, test, type Page } from "@playwright/test";
import {
  actionCount,
  activeSubscriptions,
  clickPart,
  COMBINATIONS,
  drawnText,
  hovered,
  incrementCalls,
  locate,
  openLab,
  probe,
  removeFromXR,
  showInXR,
  watchConsole,
  watchRemoteRequests,
  webCount,
  xrItem,
} from "./lab";

// Desktop 3D (no XR session): the same scenarios and assertions for every
// XR engine × integration combination. 3D interaction is real mouse input on
// the canvas, picked by the engine itself.

const moveRight = (page: Page, id: string) =>
  xrItem(page, id).getByRole("button", { name: /right/i }).click();

for (const { engine, mode } of COMBINATIONS) {
  test.describe(`${engine} × ${mode} — desktop 3D`, () => {
    let problems: string[];
    let remote: string[];

    test.beforeEach(async ({ page }) => {
      problems = watchConsole(page);
      remote = watchRemoteRequests(page);
      await openLab(page, engine, mode);
    });

    test.afterEach(() => {
      expect(problems, "console errors/warnings").toEqual([]);
      expect(remote, "requests to remote servers").toEqual([]);
    });

    test("1. web action updates the XR panel", async ({ page }) => {
      await showInXR(page, "shared-counter");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=0");

      await page.getByTestId("web-increment").click();
      await page.getByTestId("web-increment").click();

      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=2");
      await expect(webCount(page)).toHaveText("2");
    });

    test("2. clicking the 3D button runs the app's action", async ({
      page,
    }) => {
      await showInXR(page, "shared-counter");

      await clickPart(page, "shared-counter", "button:increment");

      await expect(webCount(page)).toHaveText("1");
      await expect(incrementCalls(page)).toHaveText("1");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=1");
    });

    test("3. each click is processed exactly once", async ({ page }) => {
      await showInXR(page, "shared-counter");

      for (let i = 0; i < 3; i++) {
        await clickPart(page, "shared-counter", "button:increment");
        await expect(incrementCalls(page)).toHaveText(String(i + 1));
      }
      await page.getByTestId("web-increment").click();
      await page.getByTestId("web-increment").click();

      await expect(incrementCalls(page)).toHaveText("5");
      await expect(actionCount(page)).toHaveText("5");
      await expect(webCount(page)).toHaveText("5");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=5");
    });

    test("4. select and reposition a panel", async ({ page }) => {
      await showInXR(page, "shared-counter");
      const before = await locate(page, "shared-counter", "button:increment");

      await clickPart(page, "shared-counter", "background");
      await expect(
        xrItem(page, "shared-counter").getByText("selected"),
      ).toBeVisible();
      await moveRight(page, "shared-counter");
      await moveRight(page, "shared-counter");

      await expect
        .poll(
          async () =>
            (await locate(page, "shared-counter", "button:increment")).x,
        )
        .toBeGreaterThan(before.x + 20);
      // Moving and selecting are presentation only.
      await expect(incrementCalls(page)).toHaveText("0");
      // The button still works at its new place.
      await clickPart(page, "shared-counter", "button:increment");
      await expect(webCount(page)).toHaveText("1");
    });

    test("5. repeated open/close keeps state and subscriptions", async ({
      page,
    }) => {
      await showInXR(page, "shared-counter");
      await clickPart(page, "shared-counter", "button:increment");
      await expect(webCount(page)).toHaveText("1");
      const subscriptions = await activeSubscriptions(page).textContent();

      for (let i = 0; i < 10; i++) {
        await removeFromXR(page, "shared-counter");
        await showInXR(page, "shared-counter");
      }
      // Close with the 3D close control.
      await clickPart(page, "shared-counter", "close");
      await expect.poll(() => probe(page, "panels")).toEqual([]);

      await expect(activeSubscriptions(page)).toHaveText(subscriptions!);
      await expect(webCount(page)).toHaveText("1");
      await showInXR(page, "shared-counter");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=1");
    });

    test("6. unmounting a widget removes its XR panel", async ({ page }) => {
      await showInXR(page, "image-panel");
      await clickPart(page, "image-panel", "button:next-variant");
      await expect
        .poll(() => drawnText(page, "image-panel"))
        .toBe("#1e3a8a:night");

      await page.getByTestId("image-mounted").uncheck();

      await expect.poll(() => probe(page, "panels")).toEqual([]);
      await expect(xrItem(page, "image-panel")).toHaveCount(0);

      await page.getByTestId("image-mounted").check();
      await expect(xrItem(page, "image-panel")).toHaveAttribute(
        "data-shown",
        "false",
      );
      await expect.poll(() => probe(page, "panels")).toEqual([]);
    });

    test("7. unsupported immersive XR is reported, desktop 3D keeps working", async ({
      page,
    }) => {
      await expect(page.getByTestId("xr-availability")).toHaveAttribute(
        "data-value",
        "unavailable",
      );
      await page.getByRole("button", { name: "Enter VR" }).click();
      await expect(page.getByTestId("xr-error")).toBeVisible();
      await expect(page.getByTestId("xr-session")).toHaveAttribute(
        "data-value",
        "none",
      );

      await showInXR(page, "shared-counter");
      await clickPart(page, "shared-counter", "button:increment");
      await expect(webCount(page)).toHaveText("1");

      // Chromium also logs the rejected request it was asked to make. Those
      // messages are expected here (Firefox logs none).
      const rejection = [
        /Unsupported feature requested/,
        /is not supported for mode/,
        /Could not create a session/,
      ];
      const remaining = problems.filter(
        (p) => !rejection.some((r) => r.test(p)),
      );
      problems.splice(0, problems.length, ...remaining);
    });

    test("8. real canvas pointer: hover, orbit and reset", async ({ page }) => {
      await showInXR(page, "shared-counter");
      const button = await locate(page, "shared-counter", "button:increment");

      await page.mouse.move(button.x, button.y);
      await expect
        .poll(() => hovered(page, "shared-counter", "button:increment"))
        .toBe(true);
      await page.mouse.move(button.x, button.y + 200);
      await expect
        .poll(() => hovered(page, "shared-counter", "button:increment"))
        .toBe(false);

      // Orbit by dragging empty space below the panel. The orbit target is
      // next to the counter, so measure the off-center chart panel.
      await showInXR(page, "live-chart");
      const chart = await locate(page, "live-chart", "background");
      const start = { x: button.x, y: button.y + 200 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 150, start.y, { steps: 6 });
      await page.mouse.up();
      await expect
        .poll(async () =>
          Math.abs(
            (await locate(page, "live-chart", "background")).x - chart.x,
          ),
        )
        .toBeGreaterThan(30);
      await expect(incrementCalls(page)).toHaveText("0");

      await page.getByRole("button", { name: "Reset view" }).click();
      await expect
        .poll(async () => {
          const now = await locate(page, "live-chart", "background");
          return Math.round(Math.hypot(now.x - chart.x, now.y - chart.y));
        })
        .toBeLessThan(2);
    });

    test("shared counter flow (web → 3D → move → 3D)", async ({ page }) => {
      await showInXR(page, "shared-counter");
      await expect(webCount(page)).toHaveText("0");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=0");
      await expect(actionCount(page)).toHaveText("0");

      await page.getByTestId("web-increment").click();
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=1");

      await clickPart(page, "shared-counter", "button:increment");
      await expect(webCount(page)).toHaveText("2");
      await expect(actionCount(page)).toHaveText("2");

      const before = await locate(page, "shared-counter", "button:increment");
      await moveRight(page, "shared-counter");
      // Wait until the panel is at its new place before clicking it there.
      await expect
        .poll(
          async () =>
            (await locate(page, "shared-counter", "button:increment")).x,
        )
        .toBeGreaterThan(before.x + 10);
      await clickPart(page, "shared-counter", "button:increment");
      await expect(webCount(page)).toHaveText("3");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=3");
      await expect(actionCount(page)).toHaveText("3");
      await expect(incrementCalls(page)).toHaveText("3");
    });

    test("chart reflects app data without another store", async ({ page }) => {
      await showInXR(page, "live-chart");
      await expect
        .poll(() => drawnText(page, "live-chart"))
        .toBe("Recent counts=[0]");

      await page.getByTestId("web-increment").click();
      await page.getByTestId("web-increment").click();

      await expect
        .poll(() => drawnText(page, "live-chart"))
        .toBe("Recent counts=[0,1,2]");
      await expect(page.getByTestId("web-chart")).toHaveAttribute(
        "data-values",
        "0,1,2",
      );
    });

    test("image follows the web variant; unmount and show again", async ({
      page,
    }) => {
      await showInXR(page, "image-panel");
      await page.getByTestId("image-variant").selectOption("mono");
      await expect
        .poll(() => drawnText(page, "image-panel"))
        .toBe("#57606a:mono");

      await page.getByTestId("image-mounted").uncheck();
      await expect.poll(() => probe(page, "panels")).toEqual([]);

      await page.getByTestId("image-mounted").check();
      await showInXR(page, "image-panel");
      // The variant is app state: it survives the widget's unmount.
      await expect
        .poll(() => drawnText(page, "image-panel"))
        .toBe("#57606a:mono");
    });

    test("resource cleanup: textures, host and render loop", async ({
      page,
    }) => {
      await expect.poll(() => probe(page, "activeHosts")).toBe(1);
      await expect.poll(() => probe(page, "engine")).toBe(engine);
      expect(await probe(page, "liveTextures")).toBe(0);

      for (const id of ["shared-counter", "live-chart", "image-panel"]) {
        await showInXR(page, id);
      }
      // 3 panels + their controls (+1 & close, close, Next & close).
      await expect.poll(() => probe(page, "liveTextures")).toBe(8);
      for (const id of ["shared-counter", "live-chart", "image-panel"]) {
        await removeFromXR(page, id);
      }
      await expect.poll(() => probe(page, "liveTextures")).toBe(0);

      await showInXR(page, "shared-counter");
      await page.getByRole("button", { name: "Unmount workspace" }).click();
      await expect(page.getByTestId("xr-canvas")).toHaveCount(0);
      await expect.poll(() => probe(page, "activeHosts")).toBe(0);
      await expect.poll(() => probe(page, "liveTextures")).toBe(0);
      // The render loop has stopped: no frames are rendered any more.
      const frames = await probe(page, "frames");
      await page.waitForTimeout(500); // observation window, not synchronization
      expect(await probe(page, "frames")).toBe(frames);

      // Releasing the GL context on unmount is the expected cleanup; some
      // browsers report it as a warning.
      const released = /WebGL context was lost/;
      problems.splice(
        0,
        problems.length,
        ...problems.filter((p) => !released.test(p)),
      );

      await page.getByRole("button", { name: "Mount workspace" }).click();
      await expect.poll(() => probe(page, "activeHosts")).toBe(1);
      await expect.poll(() => probe(page, "liveTextures")).toBe(3);
      await clickPart(page, "shared-counter", "button:increment");
      await expect(webCount(page)).toHaveText("1");
      await expect(incrementCalls(page)).toHaveText("1");
    });

    test("loads only the selected engine, and SpatialFlex only in spatialflex mode", async ({
      page,
    }) => {
      const scripts = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => name.endsWith(".js")),
      );
      const loaded = (chunk: string) =>
        scripts.some((name) => new RegExp(`/${chunk}-[^/]*\\.js$`).test(name));
      expect(loaded("three-host")).toBe(engine === "three");
      expect(loaded("babylon-host")).toBe(engine === "babylon");
      // The Three.js library itself is never downloaded for Babylon.js.
      expect(loaded("three.module")).toBe(engine === "three");
      expect(loaded("spatialflex")).toBe(mode === "spatialflex");
      expect(await page.locator("[data-spatialflex-item]").count()).toBe(
        mode === "spatialflex" ? 3 : 0,
      );
    });
  });
}
