import { expect, test, type Page } from "@playwright/test";
import {
  clickPart,
  COMBINATIONS,
  drawnText,
  hovered,
  incrementCalls,
  openLab,
  probe,
  showInXR,
  watchConsole,
  watchRemoteRequests,
  webCount,
  type Probe,
} from "./lab";

// Emulated immersive WebXR. The lab's dev tooling installs IWER as the
// browser's WebXR runtime before any engine loads; each engine then uses it
// through its own standard WebXR support. The emulated controller is driven
// only through IWER's documented remote API (`look_at`, `select`), so input
// goes through the real WebXR input source -> engine XR ray -> pointer event
// path. No XR input event is fabricated. These are emulator results, not
// physical-device results.

type Remote = { dispatch(method: string, params: object): Promise<unknown> };

function dispatch(page: Page, method: string, params: object) {
  return page.evaluate(
    ([method, params]) => {
      const emulator = (
        window as unknown as {
          __xrLabDevtools?: { emulator: { remote: Remote } };
        }
      ).__xrLabDevtools?.emulator;
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
  expect(target, `${part} world position`).not.toBeNull();
  const [x, y, z] = target!;
  await dispatch(page, "look_at", {
    device: "controller-right",
    target: { x, y, z },
  });
}

for (const { engine, mode } of COMBINATIONS) {
  test.describe(`${engine} × ${mode} — immersive VR (IWER emulator)`, () => {
    test("controller interaction updates the original app; state survives exit", async ({
      page,
    }, info) => {
      const problems = watchConsole(page);
      const remote = watchRemoteRequests(page);
      await openLab(page, engine, mode, "iwer");
      await showInXR(page, "shared-counter");

      await test.step("emulator installed and immersive VR available", async () => {
        await expect(page.getByTestId("xr-emulator")).toContainText(
          "IWER emulator installed",
        );
        await expect(page.getByTestId("xr-availability")).toHaveAttribute(
          "data-value",
          "available",
          { timeout: 15_000 },
        );
      });

      await test.step("immersive session created", async () => {
        await page.getByRole("button", { name: "Enter VR" }).click();
        await expect(page.getByTestId("xr-session")).toHaveAttribute(
          "data-value",
          "immersive-vr",
          { timeout: 15_000 },
        );
        const frames = await probe(page, "frames");
        await expect
          .poll(() => probe(page, "frames"))
          .toBeGreaterThan(frames + 5);
      });

      await test.step("controller ray targets the 3D button", async () => {
        await aimAt(page, "shared-counter", "button:increment");
        await expect
          .poll(() => hovered(page, "shared-counter", "button:increment"), {
            timeout: 10_000,
          })
          .toBe(true);
      });

      await test.step("controller select runs the app's action exactly once", async () => {
        await dispatch(page, "select", { device: "controller-right" });
        await expect(webCount(page)).toHaveText("1");
        await expect(incrementCalls(page)).toHaveText("1");
        await expect
          .poll(() => drawnText(page, "shared-counter"))
          .toBe("Shared count=1");
      });

      await test.step("web change reaches the panel during the session", async () => {
        // The emulator's overlay covers the page during a session.
        await page.getByTestId("web-increment").dispatchEvent("click");
        await expect
          .poll(() => drawnText(page, "shared-counter"))
          .toBe("Shared count=2");
      });

      await test.step("exit through the host; state kept; desktop works again", async () => {
        await page
          .getByRole("button", { name: "Exit VR" })
          .dispatchEvent("click");
        await expect(page.getByTestId("xr-session")).toHaveAttribute(
          "data-value",
          "none",
          {
            timeout: 15_000,
          },
        );
        await expect(webCount(page)).toHaveText("2");
        await expect(incrementCalls(page)).toHaveText("2");
        await clickPart(page, "shared-counter", "button:increment");
        await expect(webCount(page)).toHaveText("3");
      });

      info.annotations.push({
        type: "remote requests during the XR session",
        description: remote.length ? [...new Set(remote)].join(", ") : "none",
      });
      expect(problems, "console errors/warnings").toEqual([]);
    });
  });
}
