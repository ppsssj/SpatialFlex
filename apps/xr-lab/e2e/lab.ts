import { expect, type Page } from "@playwright/test";

/**
 * Shared page model for the XR Lab E2E tests. Every helper works the same for
 * every XR engine and integration mode; the 3D scene is reached only through
 * real mouse input on the canvas (or the emulated XR device), never through
 * app shortcuts. The host probe is read-only: it reports where a panel part
 * is on screen and what a panel last drew.
 */

export const ENGINES = ["three", "babylon"] as const;
export type Engine = (typeof ENGINES)[number];
export const MODES = ["baseline", "spatialflex"] as const;
export type Mode = (typeof MODES)[number];

/** The four engine × integration combinations. */
export const COMBINATIONS = ENGINES.flatMap((engine) =>
  MODES.map((mode) => ({ engine, mode })),
);

/**
 * Known third-party console messages, allowed for every engine and mode:
 * - @react-three/fiber 9.8 still uses THREE.Clock, deprecated in three 0.187.
 * - Chromium's software GL driver reports read-back stalls as warnings.
 * - Firefox warns when pointer-event libraries copy every MouseEvent field,
 *   including its deprecated moz* getters.
 * - Firefox warns when an engine probes WEBGL_debug_renderer_info for GPU
 *   capabilities (Babylon.js does on startup).
 */
const ALLOWED = [
  /WEBGL_debug_renderer_info is deprecated/,
  /MouseEvent\.moz(Pressure|InputSource) is deprecated/,
  /THREE\.Clock: This module has been deprecated/,
  /GL Driver Message/,
];

export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (!["error", "warning", "assert"].includes(message.type())) return;
    const text = message.text();
    if (!ALLOWED.some((pattern) => pattern.test(text))) {
      problems.push(`${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Requests to anything other than the local preview server. */
export function watchRemoteRequests(page: Page) {
  const remote: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:)/.test(url))
      remote.push(url);
  });
  return remote;
}

export async function openLab(
  page: Page,
  engine: Engine,
  mode: Mode,
  emulator: "off" | "iwer" = "off",
) {
  await page.goto(
    `/?engine=${engine}&integration=${mode}&xr-emulator=${emulator}`,
  );
  await expect(page.getByTestId("engine-id")).toHaveText(engine);
  await expect(page.getByTestId("integration-mode")).toHaveText(mode);
  // The first frames have been rendered.
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
}

export type Probe = {
  locate(id: string, part: string): { x: number; y: number } | null;
  worldPosition(id: string, part: string): [number, number, number] | null;
  hovered(id: string, part: string): boolean;
  frames: number;
  frameTimes: number[];
  drawn: Record<string, { text: string; at: number }>;
  panels: string[];
  sessionMode: string | null;
  liveTextures: number;
  activeHosts: number;
  engine: string | null;
};

/** Reads a field of the host probe. */
export function probe<
  K extends
    | "frames"
    | "frameTimes"
    | "drawn"
    | "panels"
    | "sessionMode"
    | "liveTextures"
    | "activeHosts"
    | "engine",
>(page: Page, field: K): Promise<Probe[K]> {
  return page.evaluate(
    // Undefined until the canvas has mounted; polling callers retry.
    (key) =>
      (window as unknown as { __xrHostProbe?: Probe }).__xrHostProbe?.[key],
    field,
  ) as Promise<Probe[K]>;
}

export function hovered(
  page: Page,
  id: string,
  part: string,
): Promise<boolean> {
  return page.evaluate(
    ([id, part]) =>
      (window as unknown as { __xrHostProbe?: Probe }).__xrHostProbe?.hovered(
        id!,
        part!,
      ) ?? false,
    [id, part],
  );
}

export const xrItem = (page: Page, id: string) =>
  page.getByTestId(`xr-item-${id}`);

export async function showInXR(page: Page, id: string) {
  await xrItem(page, id).getByRole("button", { name: "Show in XR" }).click();
  await expect.poll(() => probe(page, "panels")).toContain(id);
}

export async function removeFromXR(page: Page, id: string) {
  await xrItem(page, id)
    .getByRole("button", { name: "Remove from XR" })
    .click();
  await expect.poll(() => probe(page, "panels")).not.toContain(id);
}

/** Screen position of a panel part, once it is on screen. */
export async function locate(page: Page, id: string, part: string) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      point = await page.evaluate(
        ([id, part]) =>
          (
            window as unknown as { __xrHostProbe?: Probe }
          ).__xrHostProbe?.locate(id!, part!) ?? null,
        [id, part],
      );
      return point;
    })
    .not.toBeNull();
  return point!;
}

/** Clicks a 3D panel part with the real mouse; the host raycasts it. */
export async function clickPart(page: Page, id: string, part: string) {
  const { x, y } = await locate(page, id, part);
  await page.mouse.click(x, y);
}

export const drawnText = (page: Page, id: string) =>
  probe(page, "drawn").then((drawn) => drawn[id]?.text);

export const webCount = (page: Page) => page.getByTestId("web-count");
export const incrementCalls = (page: Page) =>
  page.getByTestId("increment-calls");
export const actionCount = (page: Page) => page.getByTestId("action-count");
export const activeSubscriptions = (page: Page) =>
  page.getByTestId("active-subscriptions");
