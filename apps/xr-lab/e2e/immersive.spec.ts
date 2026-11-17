import { expect, test, type Page } from "@playwright/test";
import {
  clickPart,
  drawnText,
  hovered,
  incrementCalls,
  MODES,
  openLab,
  probe,
  showInXR,
  watchConsole,
  watchRemoteRequests,
  webCount,
  type Probe,
} from "./lab";

// Emulated immersive WebXR (IWER, injected by the lab's dev tooling). The
// emulated controller is driven only through IWER's documented remote API
// (`look_at`, `select`), so input goes through the real WebXR input source ->
// XR ray -> pointer event path. These results are emulator results, not
// physical-device results.

type Remote = { dispatch(method: string, params: object): Promise<unknown> };

function dispatch(page: Page, method: string, params: object) {
  return page.evaluate(
    ([method, params]) => {
      const devtools = (
        window as unknown as {
          __xrLabDevtools: {
            store: { getState(): { emulator: { remote: Remote } | undefined } };
          };
        }
      ).__xrLabDevtools;
      const emulator = devtools.store.getState().emulator;
      if (!emulator) throw new Error("No emulated XR device");
      return emulator.remote.dispatch(method as string, params as object);
    },
    [method, params] as const,
  );
}

async function aimAt(page: Page, id: string, part: string) {
  const target = await page.evaluate(
    ([id, part]) =>
      (
        window as unknown as { __xrHostProbe: Probe }
      ).__xrHostProbe.worldPosition(id!, part!),
    [id, part],
  );
  expect(target).not.toBeNull();
  const [x, y, z] = target!;
  await dispatch(page, "look_at", {
    device: "controller-right",
    target: { x, y, z },
  });
}

for (const mode of MODES) {
  test.describe(`${mode} — immersive VR (IWER emulator)`, () => {
    test("controller interaction updates the original app; state survives exit", async ({
      page,
    }, info) => {
      const problems = watchConsole(page);
      const remote = watchRemoteRequests(page);
      await openLab(page, mode, "iwer");
      await showInXR(page, "shared-counter");

      // Emulated runtime detected and session started.
      await expect(page.getByTestId("xr-availability")).toHaveAttribute(
        "data-value",
        "emulated",
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: "Enter VR" }).click();
      await expect(page.getByTestId("xr-session")).toHaveAttribute(
        "data-value",
        "immersive-vr",
        { timeout: 15_000 },
      );
      const framesInSession = await probe(page, "frames");
      await expect
        .poll(() => probe(page, "frames"))
        .toBeGreaterThan(framesInSession + 5);

      // Point the emulated controller at +1: the XR ray hovers it.
      await aimAt(page, "shared-counter", "button:increment");
      await expect
        .poll(() => hovered(page, "shared-counter", "button:increment"))
        .toBe(true);

      // Trigger select: the app's action runs exactly once.
      await dispatch(page, "select", { device: "controller-right" });
      await expect(webCount(page)).toHaveText("1");
      await expect(incrementCalls(page)).toHaveText("1");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=1");

      // A web-side change reaches the panel during the session.
      await page.getByTestId("web-increment").dispatchEvent("click");
      await expect
        .poll(() => drawnText(page, "shared-counter"))
        .toBe("Shared count=2");

      // Exit the session; app state is untouched and desktop 3D works again.
      await page.evaluate(() =>
        (
          window as unknown as {
            __xrLabDevtools: {
              store: { getState(): { session?: { end(): Promise<void> } } };
            };
          }
        ).__xrLabDevtools.store
          .getState()
          .session?.end(),
      );
      await expect(page.getByTestId("xr-session")).toHaveAttribute(
        "data-value",
        "none",
      );
      await expect(webCount(page)).toHaveText("2");
      await expect(incrementCalls(page)).toHaveText("2");
      await clickPart(page, "shared-counter", "button:increment");
      await expect(webCount(page)).toHaveText("3");

      info.annotations.push({
        type: "remote requests during the XR session",
        description: remote.length ? [...new Set(remote)].join(", ") : "none",
      });
      expect(problems, "console errors/warnings").toEqual([]);
    });
  });
}
