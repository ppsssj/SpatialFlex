import { expect, test, type Frame, type Page } from "@playwright/test";
import { type Probe, watchConsole } from "./lab";

type ClockWindow = Window & {
  __mousePointerId?: number;
  __mouseClock: { set(value: number): void; restore(): void };
  __xrHostProbe?: Probe;
};
const CLOCK_BASE = 1_800_000_000_000;
type Realm = Page | Frame;

async function open(
  page: Page,
  bridge: "off" | "iframe",
  integration: "baseline" | "spatialflex" = "baseline",
) {
  // Only Date.now is controlled; input, timers, rendering and raycasts are real.
  // Every document starts at the same instant so iframe lease checks agree.
  await page.addInitScript((initial) => {
    const nativeNow = Date.now;
    let current = initial;
    Date.now = () => current;
    (window as unknown as ClockWindow).__mouseClock = {
      set(value) {
        current = value;
      },
      restore() {
        Date.now = nativeNow;
      },
    };
    window.addEventListener(
      "pointerdown",
      (event) => {
        (window as unknown as ClockWindow).__mousePointerId = event.pointerId;
      },
      true,
    );
  }, CLOCK_BASE);
  await page.goto(
    `/?engine=babylon&integration=${integration}&bridge=${bridge}&xr-emulator=off`,
  );
  let realm: Realm = page;
  if (bridge === "iframe") {
    await expect(page.getByTestId("bridge-status")).toHaveText("connected");
    realm = page.frames().find((f) => f.url().includes("/host.html"))!;
  }
  await page
    .getByTestId("xr-item-shared-counter")
    .getByRole("button", { name: "Show in XR" })
    .click();
  await expect
    .poll(() =>
      realm.evaluate(
        () => (window as unknown as ClockWindow).__xrHostProbe?.panels ?? [],
      ),
    )
    .toContain("shared-counter");
  return realm;
}

async function clock(page: Page, value?: number) {
  for (const frame of page.frames())
    await frame.evaluate((value) => {
      const control = (window as unknown as ClockWindow).__mouseClock;
      if (value === undefined) control.restore();
      else control.set(value);
    }, value);
}

async function point(page: Page, realm: Realm) {
  let location: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () =>
        (location = await realm.evaluate(
          () =>
            (window as unknown as ClockWindow).__xrHostProbe?.locate(
              "shared-counter",
              "button:increment",
            ) ?? null,
        )),
    )
    .not.toBeNull();
  const offset =
    realm === page
      ? { x: -1, y: -1 }
      : (await page.locator("iframe").boundingBox())!;
  return { x: offset.x + 1 + location!.x, y: offset.y + 1 + location!.y };
}

for (const bridge of ["off", "iframe"] as const) {
  for (const interval of [299, 300, 301])
    test(`Babylon/${bridge}: two real clicks ${interval}ms apart each invoke once`, async ({
      page,
    }) => {
      const errors = watchConsole(page);
      try {
        const realm = await open(page, bridge);
        const target = await point(page, realm);
        await page.mouse.click(target.x, target.y);
        await expect(page.getByTestId("web-count")).toHaveText("1");
        await expect
          .poll(() =>
            realm.evaluate(
              () =>
                (window as unknown as ClockWindow).__xrHostProbe?.drawn[
                  "shared-counter"
                ]?.text,
            ),
          )
          .toBe("Shared count=1");
        await clock(page, CLOCK_BASE + interval);
        await page.mouse.click(target.x, target.y);
        await expect(page.getByTestId("web-count")).toHaveText("2");
        await expect(page.getByTestId("increment-calls")).toHaveText("2");
        expect(errors).toEqual([]);
      } finally {
        await clock(page);
      }
    });

  test(`Babylon/${bridge}: drag out and back cancels; the next click still invokes once`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    try {
      const realm = await open(page, bridge);
      const target = await point(page, realm);
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      await page.mouse.move(target.x + 30, target.y + 30, { steps: 5 });
      await page.mouse.move(target.x, target.y, { steps: 5 });
      await page.mouse.up();
      await expect(page.getByTestId("increment-calls")).toHaveText("0");
      await realm
        .getByRole("button", { name: "Reset view", exact: true })
        .click();
      const fresh = await point(page, realm);
      await clock(page, CLOCK_BASE + 301);
      await page.mouse.click(fresh.x, fresh.y);
      await expect(page.getByTestId("web-count")).toHaveText("1");
      await expect(page.getByTestId("increment-calls")).toHaveText("1");
      expect(errors).toEqual([]);
    } finally {
      await clock(page);
    }
  });

  test(`Babylon/${bridge}: held press cannot activate a replacement SpatialFlex presentation`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    try {
      const realm = await open(page, bridge, "spatialflex");
      const target = await point(page, realm);
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      const item = page.getByTestId("xr-item-shared-counter");
      await expect(page.getByTestId("increment-calls")).toHaveText("0");
      await item
        .getByRole("button", { name: "Remove from XR", exact: true })
        .focus();
      await expect(page.getByTestId("increment-calls")).toHaveText("0");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("increment-calls")).toHaveText("0");
      await expect
        .poll(() =>
          realm.evaluate(
            () =>
              (window as unknown as ClockWindow).__xrHostProbe?.panels ?? [],
          ),
        )
        .not.toContain("shared-counter");
      await item
        .getByRole("button", { name: "Show in XR", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect
        .poll(() =>
          realm.evaluate(
            () =>
              (window as unknown as ClockWindow).__xrHostProbe?.panels ?? [],
          ),
        )
        .toContain("shared-counter");
      await page.mouse.up();
      await expect(page.getByTestId("increment-calls")).toHaveText("0");
      await clock(page, CLOCK_BASE + 301);
      const fresh = await point(page, realm);
      await page.mouse.click(fresh.x, fresh.y);
      await expect(page.getByTestId("increment-calls")).toHaveText("1");
      expect(errors).toEqual([]);
    } finally {
      await clock(page);
    }
  });

  test(`Babylon/${bridge}: cancellation and blur clear a held native mouse press`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    try {
      const realm = await open(page, bridge);
      let count = 0;
      for (const cancellation of ["pointercancel", "blur"]) {
        const target = await point(page, realm);
        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        // Browser cancellation notifications, not application action shortcuts.
        await realm.evaluate((cancellation) => {
          if (cancellation === "blur") window.dispatchEvent(new Event("blur"));
          else
            document.querySelector("canvas")!.dispatchEvent(
              new PointerEvent("pointercancel", {
                pointerId: (window as unknown as ClockWindow).__mousePointerId!,
                pointerType: "mouse",
                bubbles: true,
              }),
            );
        }, cancellation);
        await page.mouse.up();
        await expect(page.getByTestId("increment-calls")).toHaveText(
          String(count),
        );
        await clock(page, CLOCK_BASE + ++count * 301);
        await page.mouse.click(target.x, target.y);
        await expect(page.getByTestId("increment-calls")).toHaveText(
          String(count),
        );
      }
      expect(errors).toEqual([]);
    } finally {
      await clock(page);
    }
  });
}
