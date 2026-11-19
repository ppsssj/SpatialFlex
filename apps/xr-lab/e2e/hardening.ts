import { expect, type Locator, type Page } from "@playwright/test";
import { probe, type Engine, type Probe } from "./lab";

/**
 * Shared page model for the P1-07A hardening tests. Input is real mouse and
 * keyboard input; geometry is checked against the renderer's own projection
 * (read-only host probe) and hit testing against `elementFromPoint`.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Point = { x: number; y: number };
export type Pose = { position: Vec3; rotation: Quat; scale: number };
export type Target = {
  itemId: string;
  presentationId: string;
  kind: "native" | "adaptive";
  transform: Pose;
  initial: Pose;
};
export type TestWindow = Window & {
  __xrHostProbe?: Probe;
  __xrLabManipulation?: {
    targets(): Target[];
    getSnapshot(): { active: unknown; selected: string | null };
  };
  __marked?: Record<string, Element>;
  __liveListeners?: (target: EventTarget, type: string) => number;
  __liveWindowListeners?: (type: string) => number;
  __lastPointerId?: number;
};

export const EVIDENCE = "../../docs/evidence/p1-07a";

/**
 * Counts live listeners per target and type (capture-sensitive), on every
 * EventTarget, to detect leaked or duplicated listeners. Installed before
 * the app starts.
 */
export const countListeners = () => {
  const live = new WeakMap<EventTarget, Map<unknown, Set<string>>>();
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const keyOf = (type: string, options?: boolean | EventListenerOptions) =>
    `${type}:${typeof options === "boolean" ? options : !!options?.capture}`;
  proto.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    // Playwright's own injected script (hit-target interceptors) is not the
    // application: its listeners are not counted.
    if (listener && !new Error().stack?.includes("InjectedScript")) {
      const byListener = live.get(this) ?? new Map<unknown, Set<string>>();
      live.set(this, byListener);
      const keys = byListener.get(listener) ?? new Set<string>();
      keys.add(keyOf(type, options));
      byListener.set(listener, keys);
    }
    return add.call(this, type, listener, options);
  } as typeof proto.addEventListener;
  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (listener) live.get(this)?.get(listener)?.delete(keyOf(type, options));
    return remove.call(this, type, listener, options);
  } as typeof proto.removeEventListener;
  const count = (target: EventTarget, type: string) =>
    [...(live.get(target)?.values() ?? [])].filter((keys) =>
      [...keys].some((k) => k.startsWith(`${type}:`)),
    ).length;
  const w = window as TestWindow;
  w.__liveListeners = count;
  w.__liveWindowListeners = (type: string) => count(window, type);
  add.call(
    window,
    "pointerdown",
    (event: Event) => {
      w.__lastPointerId = (event as PointerEvent).pointerId;
    },
    true,
  );
};

export async function openSurface(
  page: Page,
  engine: Engine,
  fixture: "dashboard" | "hardening" = "dashboard",
) {
  await page.addInitScript(countListeners);
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=website${
      fixture === "hardening" ? "&fixture=hardening" : ""
    }`,
  );
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  await expect(page.getByTestId("surface-status")).toHaveAttribute(
    "data-value",
    "visible",
  );
}

export const surface = (page: Page) => page.getByTestId("web-surface");
export const slot = (page: Page, id: string) =>
  page.locator(`[data-spatialflex-item="${id}"]`);
export const panel = (page: Page, id: string) =>
  slot(page, id).locator("[data-spatialflex-panel]");
export const outline = (page: Page, id: string) =>
  surface(page).locator(`.surface-outline[data-surface-item="${id}"]`);
export const handle = (
  page: Page,
  id: string,
  mode: "translate" | "rotate" | "resize",
): Locator =>
  panel(page, id).locator(
    mode === "translate"
      ? '[data-spatialflex-handle="translate"][role=button]'
      : `[data-spatialflex-handle="${mode}"]`,
  );

export async function select(page: Page, id: string) {
  await surface(page).getByTestId("surface-select-mode").click();
  await outline(page, id).click();
  await expect(outline(page, id)).toHaveAttribute("data-selected", "true");
}

export async function extract(
  page: Page,
  id: string,
  presentation: "native" | "adaptive",
) {
  await select(page, id);
  await surface(page)
    .getByTestId(`surface-presentation-${presentation}`)
    .click();
  await surface(page).getByTestId("surface-source").selectOption("reserved");
  await surface(page).getByTestId("surface-extract").click();
  if (presentation === "native")
    await expect(panel(page, id)).toHaveAttribute("data-spatial-placed", "");
  else await expect.poll(() => probe(page, "panels")).toContain(id);
  await expect
    .poll(async () => (await target(page, id))?.kind)
    .toBe(presentation);
}

export const targets = (page: Page) =>
  page.evaluate(() => (window as TestWindow).__xrLabManipulation!.targets());
export const target = async (page: Page, id: string) =>
  (await targets(page)).find((t) => t.itemId === id);
export const poseOf = async (page: Page, id: string) =>
  (await target(page, id))!.transform;
export const activeSession = (page: Page) =>
  page.evaluate(
    () => (window as TestWindow).__xrLabManipulation!.getSnapshot().active,
  );

export const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((v, i) => v - b[i]!));
export const yaw = ([x, y, z, w]: Quat) =>
  Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y));

export const centerOf = async (locator: Locator): Promise<Point> => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A real mouse drag; `hold` keeps the button pressed at the end. */
export async function drag(page: Page, from: Point, to: Point, hold = false) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(
    from.x + (to.x - from.x) / 2,
    from.y + (to.y - from.y) / 2,
    { steps: 5 },
  );
  await page.mouse.move(to.x, to.y, { steps: 5 });
  if (!hold) await page.mouse.up();
}

/** Client positions of the surface page's corners: they move with the camera. */
export const surfaceCorners = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-surface-corner]")].flatMap((m) => {
      const r = m.getBoundingClientRect();
      return [r.left, r.top];
    }),
  );
export const cornerShift = async (page: Page, corners: number[]) => {
  const now = await surfaceCorners(page);
  return Math.max(...now.map((v, i) => Math.abs(v - corners[i]!)));
};

export async function orbit(page: Page, engine: Engine) {
  const box = (await page.getByTestId("xr-canvas").boundingBox())!;
  const start = { x: box.x + box.width - 40, y: box.y + box.height - 30 };
  const dx = engine === "three" ? -60 : -40;
  await drag(page, start, { x: start.x + dx, y: start.y - 10 });
}

/** Orbits, checks that the camera moved, and resets the view. */
export async function expectCameraResponds(page: Page, engine: Engine) {
  const corners = await surfaceCorners(page);
  await orbit(page, engine);
  await expect.poll(() => cornerShift(page, corners)).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Reset view" }).click();
  await expect.poll(() => cornerShift(page, corners)).toBeLessThan(0.5);
}

/**
 * Where the composited pose of a native element projects through the
 * renderer's camera (compositor-independent reference), as the client
 * points of its corners and of interior samples (u, v in -0.5..0.5).
 */
export const projectedNative = (
  page: Page,
  id: string,
  samples: readonly [number, number][] = [],
) =>
  page.evaluate(
    ({ id, samples }) => {
      const el = document.querySelector<HTMLElement>(
        `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
      )!;
      if (!el.dataset.spatialPose) return null;
      const pose = JSON.parse(el.dataset.spatialPose) as {
        position: [number, number, number];
        rotation: [number, number, number];
        width: number;
        height: number;
      };
      const [rx, ry, rz] = pose.rotation;
      const cx = Math.cos(rx),
        sx = Math.sin(rx),
        cy = Math.cos(ry),
        sy = Math.sin(ry),
        cz = Math.cos(rz),
        sz = Math.sin(rz);
      const R = [
        [cy * cz, -cy * sz, sy],
        [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
        [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
      ];
      const p = (window as TestWindow).__xrHostProbe!;
      const at = (u: number, v: number) =>
        p.project(
          [0, 1, 2].map(
            (i) =>
              pose.position[i]! +
              R[i]![0]! * u * pose.width +
              R[i]![1]! * v * pose.height,
          ) as [number, number, number],
        )!;
      return {
        corners: [at(-0.5, 0.5), at(0.5, 0.5), at(0.5, -0.5), at(-0.5, -0.5)],
        samples: samples.map(([u, v]) => at(u, v)),
      };
    },
    { id, samples },
  );

/**
 * The native element is exactly where its composited world pose projects
 * (bounding boxes within 2 px, the P1-06B tolerance).
 */
export async function expectPlaced(page: Page, id: string) {
  await expect
    .poll(async () => {
      const projected = await projectedNative(page, id);
      if (!projected) return Infinity;
      const actual = (await panel(page, id).boundingBox())!;
      const xs = projected.corners.map((q) => q.x);
      const ys = projected.corners.map((q) => q.y);
      return Math.max(
        Math.abs(actual.x - Math.min(...xs)),
        Math.abs(actual.y - Math.min(...ys)),
        Math.abs(actual.x + actual.width - Math.max(...xs)),
        Math.abs(actual.y + actual.height - Math.max(...ys)),
      );
    })
    .toBeLessThan(2);
}

/** Interior points (u, v) of a panel used for hit testing. */
export const HIT_SAMPLES: readonly [number, number][] = [
  [0, 0],
  [-0.3, 0.3],
  [0.3, 0.3],
  [0.3, -0.3],
  [-0.3, -0.3],
];

/**
 * Which element the browser hit-tests at each projected interior point:
 * `native` (inside the extracted element), or what else is there.
 */
export async function hitsAt(page: Page, id: string, points: Point[]) {
  return page.evaluate(
    ({ id, points }) => {
      const el = document.querySelector(
        `[data-spatialflex-item="${id}"] [data-spatialflex-panel]`,
      )!;
      return points.map(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        if (!hit) return "none";
        if (el.contains(hit)) return "native";
        if (hit.closest("[data-testid=xr-canvas]") || hit.tagName === "CANVAS")
          return "canvas";
        if (hit.closest(".web-surface-page")) return "page";
        return hit.tagName.toLowerCase();
      });
    },
    { id, points },
  );
}

export async function nativeHits(page: Page, id: string) {
  const projected = await projectedNative(page, id, HIT_SAMPLES);
  return projected ? hitsAt(page, id, projected.samples) : [];
}

/** Compositor-owned attributes and inline styles left on an element. */
export const compositorResidue = (locator: Locator) =>
  locator.evaluate((el: HTMLElement) =>
    [
      el.style.transform && `transform=${el.style.transform}`,
      el.style.clipPath && `clip-path=${el.style.clipPath}`,
      el.style.visibility && `visibility=${el.style.visibility}`,
      ...[
        "spatialPlaced",
        "spatialPose",
        "spatialVisibility",
        "spatialIssue",
        "manipulationSelected",
        "manipulating",
      ]
        .filter((key) => key in el.dataset)
        .map((key) => `data-${key}`),
    ].filter(Boolean),
  );

export const liveListeners = (page: Page, selector: string, type: string) =>
  page.evaluate(
    ({ selector, type }) =>
      (window as TestWindow).__liveListeners!(
        document.querySelector(selector)!,
        type,
      ),
    { selector, type },
  );
export const windowListeners = (page: Page, type: string) =>
  page.evaluate((t) => (window as TestWindow).__liveWindowListeners!(t), type);

export async function subscriptions(page: Page) {
  const subs = page.getByTestId("active-subscriptions");
  return {
    active: await subs.textContent(),
    subscribes: await subs.getAttribute("data-total-subscribes"),
  };
}

/**
 * A point on a handle where the browser actually hit-tests that handle
 * (parts of a native panel can be cut out by an XR panel in front of it).
 */
export async function grabPoint(locator: Locator): Promise<Point> {
  const box = (await locator.boundingBox())!;
  const point = await locator.evaluate((el, box) => {
    for (const f of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      const p = { x: box.x + box.width * f, y: box.y + box.height / 2 };
      const hit = document.elementFromPoint(p.x, p.y);
      if (hit && el.contains(hit)) return p;
    }
    return null;
  }, box);
  expect(point, "a visible, hit-testable part of the handle").not.toBeNull();
  return point!;
}
