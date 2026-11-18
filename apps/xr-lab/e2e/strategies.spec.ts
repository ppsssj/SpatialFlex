import { expect, test, type Frame, type Page } from "@playwright/test";
import { ENGINES, type Probe, watchConsole } from "./lab";
import type { BridgeMessage } from "../src/bridge/protocol";
import { mkdir, writeFile } from "node:fs/promises";

type Realm = Page | Frame;
type TestWindow = Window & {
  __xrHostProbe?: Probe;
  __holdStrategyAction?: boolean;
  __heldStrategyAction?: BridgeMessage;
};
const slot = (page: Page, id = "shared-counter") =>
  page.locator(`[data-spatialflex-item="${id}"]`);
const panel = (page: Page, id = "shared-counter") =>
  slot(page, id).locator("[data-spatialflex-panel]");
const observed = (realm: Realm) =>
  realm.evaluate(
    () => (window as unknown as TestWindow).__xrHostProbe?.panels ?? [],
  );
const drawn = (realm: Realm) =>
  realm.evaluate(
    () =>
      (window as unknown as TestWindow).__xrHostProbe?.drawn["shared-counter"]
        ?.text,
  );

async function click3D(page: Page, realm: Realm, id: string, part: string) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () =>
        (point = await realm.evaluate(
          ([id, part]) =>
            (window as unknown as TestWindow).__xrHostProbe?.locate(
              id!,
              part!,
            ) ?? null,
          [id, part],
        )),
    )
    .not.toBeNull();
  const frameBox =
    realm === page
      ? { x: -1, y: -1 }
      : (await page.locator("iframe").boundingBox())!;
  await page.mouse.click(frameBox.x + 1 + point!.x, frameBox.y + 1 + point!.y);
}

async function drag(
  page: Page,
  target: ReturnType<typeof panel>,
  x: number,
  y: number,
) {
  const bar = target.locator("[data-spatialflex-panel-bar]");
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

for (const engine of ENGINES)
  for (const bridge of ["off", "iframe"] as const) {
    test(`${engine}/${bridge}: select → move → interact → attach → mirror → interact → hide`, async ({
      page,
    }, testInfo) => {
      const errors = watchConsole(page);
      await page.addInitScript(() => {
        window.addEventListener("message", (event) => {
          const w = window as unknown as TestWindow;
          if (w.__holdStrategyAction && event.data?.type === "action-request") {
            w.__heldStrategyAction = event.data;
            event.stopImmediatePropagation();
          }
        });
      });
      await page.goto(
        `/?integration=spatialflex&engine=${engine}&bridge=${bridge}&xr-emulator=off`,
      );
      let realm: Realm = page;
      if (bridge === "iframe") {
        await expect(page.getByTestId("bridge-status")).toHaveText("connected");
        realm = page.frames().find((f) => f.url().includes("/host.html"))!;
      }
      const counter = page.getByTestId("web-count");
      const original = await counter.elementHandle();
      const mounts = await page.getByTestId("counter-mounts").textContent();
      const subscriptions = await page
        .getByTestId("active-subscriptions")
        .textContent();
      await page.getByTestId("strategy-item").selectOption("shared-counter");
      await page.getByTestId("counter-local").click();
      await page.getByTestId("counter-note").fill("same mounted input");
      const source = (await slot(page).boundingBox())!;
      const chart = (await slot(page, "live-chart").boundingBox())!;
      const screenshot = async (name: string) => {
        if (
          engine === "three" &&
          bridge === "iframe" &&
          testInfo.project.name === "chromium"
        )
          await page.screenshot({
            path: `../../docs/evidence/p1-05-${name}.png`,
          });
      };
      await screenshot("attached");
      await page.getByTestId("strategy-apply").click();
      await expect(slot(page)).toHaveAttribute(
        "data-source-policy",
        "placeholder",
      );
      await expect(page.getByTestId("counter-note")).toBeFocused();
      const reserved = (await slot(page).boundingBox())!;
      expect(Math.abs(reserved.height - source.height)).toBeLessThan(2);
      expect(
        Math.abs((await slot(page, "live-chart").boundingBox())!.y - chart.y),
      ).toBeLessThan(2);
      await drag(page, panel(page), 760, 230);
      const moved = (await panel(page).boundingBox())!;
      expect(moved.x).toBeGreaterThan(450);
      await page.getByTestId("web-increment").click();
      await expect(counter).toHaveText("1");
      await expect(page.getByTestId("counter-local")).toHaveText(
        "Local clicks: 1",
      );
      const handle = (await panel(page)
        .locator("[data-spatialflex-resize-handle]")
        .boundingBox())!;
      await page.mouse.move(handle.x + 8, handle.y + 8);
      await page.mouse.down();
      await page.mouse.move(handle.x + 68, handle.y + 48, { steps: 5 });
      await page.mouse.up();
      expect((await panel(page).boundingBox())!.width).toBeGreaterThan(
        moved.width + 30,
      );
      await page.setViewportSize({ width: 1100, height: 820 });
      const resized = (await panel(page).boundingBox())!;
      expect(resized.x + resized.width).toBeLessThanOrEqual(1101);
      await screenshot("placeholder");
      await panel(page)
        .getByRole("button", { name: "Attach", exact: true })
        .click();
      await expect(slot(page)).toHaveAttribute("data-status", "attached");
      await page.getByTestId("strategy-source").selectOption("collapse");
      const attachedChart = (await slot(page, "live-chart").boundingBox())!;
      await page.getByTestId("strategy-apply").click();
      await expect(slot(page)).toHaveCSS("display", "contents");
      const collapsedChart = (await slot(page, "live-chart").boundingBox())!;
      expect(collapsedChart.y).toBeLessThan(
        attachedChart.y - source.height * 0.5,
      );
      await expect(counter).toHaveText("1");
      await expect(page.getByTestId("counter-note")).toHaveValue(
        "same mounted input",
      );
      await screenshot("collapse");
      // Switching directly from Move to Mirror attaches the original first.
      await page.getByTestId("strategy-mode").selectOption("mirror");
      await page.getByTestId("strategy-apply").click();
      await expect(slot(page)).toHaveAttribute("data-status", "attached");
      await expect.poll(() => observed(realm)).toContain("shared-counter");
      await expect.poll(() => drawn(realm)).toBe("Shared count=1");
      await click3D(page, realm, "shared-counter", "button:increment");
      await expect(counter).toHaveText("2");
      await expect(page.getByTestId("increment-calls")).toHaveText("2");
      await expect.poll(() => drawn(realm)).toBe("Shared count=2");
      await screenshot("mirror");
      if (bridge === "iframe") {
        await page.evaluate(() => {
          (window as unknown as TestWindow).__holdStrategyAction = true;
        });
        await click3D(page, realm, "shared-counter", "button:increment");
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as TestWindow).__heldStrategyAction?.type,
            ),
          )
          .toBe("action-request");
      }
      await page.getByTestId("strategy-restore").click();
      await expect.poll(() => observed(realm)).not.toContain("shared-counter");
      await page.getByTestId("strategy-apply").click();
      await expect.poll(() => observed(realm)).toContain("shared-counter");
      if (bridge === "iframe") {
        const held = await page.evaluate(() => {
          const w = window as unknown as TestWindow;
          w.__holdStrategyAction = false;
          return w.__heldStrategyAction;
        });
        await realm.evaluate(
          (held) => window.parent.postMessage(held, location.origin),
          held,
        );
      }
      await click3D(page, realm, "shared-counter", "button:increment");
      await expect(counter).toHaveText("3");
      await expect(page.getByTestId("increment-calls")).toHaveText("3");
      // Switching Mirror → Move revokes the mirror's action owner.
      await page.getByTestId("strategy-mode").selectOption("move");
      await page.getByTestId("strategy-apply").click();
      await expect.poll(() => observed(realm)).not.toContain("shared-counter");
      await page.getByTestId("strategy-restore").click();
      expect(
        await counter.evaluate((node, old) => node === old, original),
      ).toBe(true);
      await expect(page.getByTestId("counter-mounts")).toHaveText(mounts!);
      await expect(page.getByTestId("counter-instances")).toHaveText("1");
      await expect(page.getByTestId("active-subscriptions")).toHaveText(
        subscriptions!,
      );
      const evidence = {
        engine,
        bridge,
        browser: testInfo.project.name,
        sourceAttached: source,
        sourcePlaceholder: reserved,
        chartAttached: attachedChart,
        chartCollapsed: collapsedChart,
        floatingAfterDrag: moved,
        floatingAfterViewportResize: resized,
        originalDOMIdentityPreserved: await counter.evaluate(
          (node, old) => node === old,
          original,
        ),
        localState: await page.getByTestId("counter-local").textContent(),
        localNote: await page.getByTestId("counter-note").inputValue(),
        effectMountsBefore: Number(mounts),
        effectMountsAfter: Number(
          await page.getByTestId("counter-mounts").textContent(),
        ),
        activeInstances: Number(
          await page.getByTestId("counter-instances").textContent(),
        ),
        subscriptionsBefore: Number(subscriptions),
        subscriptionsAfter: Number(
          await page.getByTestId("active-subscriptions").textContent(),
        ),
        domainActions: Number(
          await page.getByTestId("action-count").textContent(),
        ),
        incrementCalls: Number(
          await page.getByTestId("increment-calls").textContent(),
        ),
        strategies: [
          "move/placeholder/web",
          "move/collapse/web",
          "mirror/visible/xr",
        ],
        finalPresentation: await page
          .getByTestId("strategy-presentation")
          .textContent(),
      };
      await mkdir("../../docs/evidence", { recursive: true });
      await writeFile(
        `../../docs/evidence/p1-05-${engine}-${bridge}-${testInfo.project.name}.json`,
        JSON.stringify(evidence, null, 2) + "\n",
      );
      await testInfo.attach("strategy-evidence", {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      await page.getByTestId("strategy-target").selectOption("xr");
      await expect(page.getByTestId("strategy-support")).toContainText(
        "Original React DOM",
      );
      await expect(page.getByTestId("strategy-apply")).toBeDisabled();
      await page.getByTestId("strategy-mode").selectOption("snapshot");
      await expect(page.getByTestId("strategy-support")).toContainText(
        "Snapshots are not implemented",
      );
      await expect(page.getByTestId("strategy-apply")).toBeDisabled();
      expect(errors).toEqual([]);
    });
  }

test("chart and image use the same Move strategies; detached unmount/remount restores a fresh registration", async ({
  page,
}) => {
  await page.goto("/?integration=spatialflex&engine=three&xr-emulator=off");
  for (const id of ["live-chart", "image-panel"]) {
    await page.getByTestId("strategy-item").selectOption(id);
    await page.getByTestId("strategy-source").selectOption("collapse");
    await page.getByTestId("strategy-apply").click();
    await expect(slot(page, id)).toHaveAttribute("data-status", "detached");
    await page.getByTestId("strategy-restore").click();
    await expect(slot(page, id)).toHaveAttribute("data-status", "attached");
  }
  await page.getByTestId("strategy-apply").click();
  const old = await slot(page, "image-panel").elementHandle();
  await page.getByTestId("image-mounted").uncheck();
  await expect(slot(page, "image-panel")).toHaveCount(0);
  await expect(page.getByTestId("strategy-apply")).toBeDisabled();
  await page.getByTestId("image-mounted").check();
  await expect(slot(page, "image-panel")).toHaveAttribute(
    "data-status",
    "attached",
  );
  expect(
    await slot(page, "image-panel").evaluate((node, old) => node === old, old),
  ).toBe(false);
  await page.getByTestId("strategy-apply").click();
  await expect(slot(page, "image-panel")).toHaveAttribute(
    "data-source-policy",
    "collapse",
  );
  await page.getByTestId("strategy-restore").click();
});
