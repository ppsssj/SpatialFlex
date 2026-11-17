import { expect, test, type Frame, type Page } from "@playwright/test";
import { isMessage, type BridgeMessage } from "../src/bridge/protocol";
import { COMBINATIONS, type Probe, watchConsole } from "./lab";

type TestWindow = Window & {
  __xrHostProbe?: Probe;
  __declarativeMessages: BridgeMessage[];
  __holdHeat?: boolean;
  __delayedHeat?: BridgeMessage;
};
type Realm = Frame | Page;
const panels = (realm: Realm) =>
  realm.evaluate(
    () => (window as unknown as TestWindow).__xrHostProbe?.panels ?? [],
  );
const drawn = (realm: Realm) =>
  realm.evaluate(
    () =>
      (window as unknown as TestWindow).__xrHostProbe?.drawn.thermostat?.text,
  );
async function click3D(page: Page, realm: Realm) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () =>
        (point = await realm.evaluate(
          () =>
            (window as unknown as TestWindow).__xrHostProbe?.locate(
              "thermostat",
              "button:heat",
            ) ?? null,
        )),
    )
    .not.toBeNull();
  const box =
    realm === page
      ? { x: -1, y: -1 }
      : (await page.locator("iframe").boundingBox())!;
  await page.mouse.click(box.x + 1 + point!.x, box.y + 1 + point!.y);
}

for (const { engine, mode } of COMBINATIONS)
  for (const bridge of ["off", "iframe"] as const) {
    test(`${engine}/${mode}/${bridge}: fourth component lifecycle, current handlers and stale-action rejection`, async ({
      page,
    }) => {
      const problems = watchConsole(page);
      const scripts: string[] = [];
      page.on("request", (request) => {
        if (request.url().endsWith(".js")) scripts.push(request.url());
      });
      await page.addInitScript(() => {
        const w = window as unknown as TestWindow;
        w.__declarativeMessages = [];
        window.addEventListener("message", (event) => {
          if (event.data?.protocolVersion !== 1) return;
          if (
            w.__holdHeat &&
            event.data.type === "action-request" &&
            event.data.itemId === "thermostat"
          ) {
            w.__delayedHeat = event.data;
            event.stopImmediatePropagation();
            return;
          }
          w.__declarativeMessages.push(event.data);
          if (w.__declarativeMessages.length > 100)
            w.__declarativeMessages.shift();
        });
      });
      await page.goto(
        `/?engine=${engine}&integration=${mode}&bridge=${bridge}&xr-emulator=off`,
      );
      let realm: Realm = page;
      if (bridge === "iframe") {
        await expect(page.getByTestId("bridge-status")).toHaveText("connected");
        realm = page.frames().find((f) => f.url().includes("/host.html"))!;
      }
      await page.getByTestId("thermostat-mounted").check();
      const show = () =>
        page
          .getByTestId("xr-item-thermostat")
          .getByRole("button", { name: "Show in XR", exact: true })
          .click();
      await show();
      await expect.poll(() => panels(realm)).toContain("thermostat");
      await expect.poll(() => drawn(realm)).toBe("Temperature=20");
      await page.getByTestId("web-heat").click();
      await expect.poll(() => drawn(realm)).toBe("Temperature=21");
      await click3D(page, realm);
      await expect(page.getByTestId("temperature")).toHaveText("22");
      await expect(page.getByTestId("heat-calls")).toHaveText("2");
      // Body and action labels do not change when captured application state changes.
      await page.getByTestId("heat-step").selectOption("5");
      await click3D(page, realm);
      await expect(page.getByTestId("temperature")).toHaveText("27");
      await expect(page.getByTestId("heat-calls")).toHaveText("3");
      let delayed: BridgeMessage | undefined;
      if (bridge === "iframe") {
        await page.evaluate(() => {
          (window as unknown as TestWindow).__holdHeat = true;
        });
        await click3D(page, realm);
        await expect
          .poll(() =>
            page.evaluate(
              () => (window as unknown as TestWindow).__delayedHeat?.type,
            ),
          )
          .toBe("action-request");
        delayed = await page.evaluate(
          () => (window as unknown as TestWindow).__delayedHeat,
        );
      }
      await page.getByTestId("thermostat-mounted").uncheck();
      await expect.poll(() => panels(realm)).not.toContain("thermostat");
      await expect(page.getByTestId("xr-item-thermostat")).toHaveCount(0);
      await page.getByTestId("thermostat-mounted").check();
      await show();
      await expect.poll(() => panels(realm)).toContain("thermostat");
      if (bridge === "iframe") {
        const messages = await realm.evaluate(
          () => (window as unknown as TestWindow).__declarativeMessages,
        );
        expect(messages.every(isMessage)).toBe(true);
        expect(JSON.stringify(messages)).not.toContain('"invoke"');
        await page.evaluate(() => {
          (window as unknown as TestWindow).__holdHeat = false;
        });
        await realm.evaluate(
          (message) => window.parent.postMessage(message, location.origin),
          delayed!,
        );
      }
      // A fresh real interaction is also a processing barrier for the stale request.
      await click3D(page, realm);
      await expect(page.getByTestId("temperature")).toHaveText("32");
      await expect(page.getByTestId("heat-calls")).toHaveText("4");
      if (bridge === "iframe") {
        await page
          .getByRole("button", { name: "Disconnect bridge", exact: true })
          .click();
        await expect(realm.getByTestId("view-status")).toContainText(
          "stale / disconnected",
        );
        await page.getByTestId("web-heat").click();
        await page
          .getByRole("button", { name: "Reconnect bridge", exact: true })
          .click();
        await expect.poll(() => drawn(realm)).toBe("Temperature=37");
        await expect(page.getByTestId("heat-calls")).toHaveText("5");
      }
      expect(scripts.some((url) => /\/spatialflex-[^/]*\.js$/.test(url))).toBe(
        mode === "spatialflex",
      );
      expect(problems).toEqual([]);
    });
  }
