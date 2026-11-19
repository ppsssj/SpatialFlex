import { expect, test, type Page } from "@playwright/test";
import { ENGINES, probe, watchConsole, type Engine } from "./lab";

/**
 * P1-07C benchmark fixture correctness (B1, B3–B7). Short and
 * deterministic: part of the normal E2E suite. Performance numbers are
 * produced by the separate benchmark (`pnpm bench:spatial`), never here.
 * Real mouse and keyboard input; presentations are started through the
 * lab's own integration API by the benchmark harness.
 */

type Kind = "native" | "adaptive";
type Point = { x: number; y: number };
type Bench = {
  panels: number;
  ids: string[];
  extractAll(kind: Kind): boolean[];
  restoreAll(): boolean[];
  presentations(): {
    native: number;
    adaptive: number;
    instances: (string | null)[];
  };
  validate(kind: Kind): { valid: boolean; issues: string[] };
  state(): Record<string, unknown> & {
    presentations: { native: number; adaptive: number };
    manipulationTargets: number;
    activeSession: boolean;
    sdkMarkedElements: number;
    liveComponents: number;
    componentMounts: number;
    dataSubscriptions: number;
    liveTextures: number;
  };
  handlePoint(id: string, mode: string): Point | null;
  pose(id: string): { position: number[] } | null;
  setCamera(p: number[], t: number[]): boolean;
  cameraPath(on: boolean): void;
  collector: { start(): void; stop(): unknown };
};
type W = Window & {
  __spatialBench?: Bench;
  __spatialPerf?: unknown;
  __marked?: Element[];
};

const bench = <T>(
  page: Page,
  fn: (b: Bench, arg: unknown) => T,
  arg?: unknown,
) =>
  page.evaluate(
    ([source, a]) =>
      new Function("b", "a", `return (${source})(b, a)`)(
        (window as W).__spatialBench!,
        a,
      ) as T,
    [fn.toString(), arg] as const,
  );

async function openBench(page: Page, engine: Engine, panels: number) {
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=website&fixture=benchmark&panels=${panels}`,
  );
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  await expect(page.getByTestId("surface-status")).toHaveAttribute(
    "data-value",
    "visible",
  );
  await expect
    .poll(() => page.evaluate(() => !!(window as W).__spatialBench))
    .toBe(true);
  await bench(page, (b) => b.setCamera([0, 1.42, 4], [0, 1.42, -0.4]));
}

async function present(page: Page, kind: Kind) {
  const done = await bench(page, (b, k) => b.extractAll(k as Kind), kind);
  expect(done.every(Boolean)).toBe(true);
  await expect
    .poll(
      async () =>
        (await bench(page, (b, k) => b.validate(k as Kind), kind)).issues,
    )
    .toEqual([]);
}

const panel = (page: Page, i: number) =>
  page.locator(
    `[data-spatialflex-item="bench-${i + 1}"] [data-spatialflex-panel]`,
  );

for (const engine of ENGINES) {
  test(`${engine}: B1/B7 the fixture presents exactly N visible, non-overlapping panels (0/1/5/10/20, Native and Adaptive)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    for (const n of [0, 1, 5, 10, 20]) {
      await openBench(page, engine, n);
      await expect(page.locator(".bench-panel")).toHaveCount(n);
      for (const kind of ["native", "adaptive"] as const) {
        await present(page, kind);
        const state = await bench(page, (b) => b.state());
        expect(state.presentations[kind]).toBe(n);
        expect(state.manipulationTargets).toBe(n);
        await bench(page, (b) => b.restoreAll());
        await expect
          .poll(() => bench(page, (b) => b.state().manipulationTargets))
          .toBe(0);
      }
      // A short measurement is valid in every engine (B7).
      const result = (await page.evaluate(async () => {
        const c = (window as W).__spatialBench!.collector;
        c.start();
        await new Promise((r) => setTimeout(r, 400));
        return c.stop();
      })) as {
        frames: { samples: number; medianIntervalMs: number | null };
        spans: Record<string, { count: number; unit: string }>;
      };
      expect(result.frames.samples).toBeGreaterThan(5);
      expect(result.frames.medianIntervalMs).toBeGreaterThan(0);
      expect(result.spans[`render.${engine}`]!.count).toBeGreaterThan(5);
      expect(result.spans["lab.surfaceFrame"]!.unit).toBe("ms");
    }
    expect(errors).toEqual([]);
  });

  test(`${engine}: B4 Native DOM at 20 panels keeps identity, state, input and restores cleanly`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await openBench(page, engine, 20);
    await page.getByTestId("bench-local-6").click();
    await page.evaluate(() => {
      (window as W).__marked = [
        ...document.querySelectorAll("[data-spatialflex-panel]"),
      ];
    });
    const before = await bench(page, (b) => b.state());
    await present(page, "native");
    const same = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("[data-spatialflex-panel]")].every(
          (el, i) => (window as W).__marked![i] === el,
        ),
      );
    expect(await same()).toBe(true);
    // Local state survived; a real click on the original control in space.
    const local = page.getByTestId("bench-local-6");
    await expect(local).toHaveText("Local 1");
    const box = (await local.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(local).toHaveText("Local 2");
    // A real drag on panel 1's Native handle moves only that presentation.
    const start = (await bench(page, (b) => b.pose("bench-1")))!.position;
    const other = (await bench(page, (b) => b.pose("bench-2")))!.position;
    const from = (await bench(page, (b) =>
      b.handlePoint("bench-1", "translate"),
    ))!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
    // Escape cancels the drag in progress: back to the start pose.
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await bench(page, (b) => b.pose("bench-1")))!.position).toEqual(
      start,
    );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
    await page.mouse.up();
    const moved = (await bench(page, (b) => b.pose("bench-1")))!.position;
    expect(
      Math.hypot(moved[0]! - start[0]!, moved[1]! - start[1]!),
    ).toBeGreaterThan(0.02);
    expect((await bench(page, (b) => b.pose("bench-2")))!.position).toEqual(
      other,
    );
    await bench(page, (b) => b.restoreAll());
    await expect
      .poll(() => bench(page, (b) => b.state().sdkMarkedElements))
      .toBe(0);
    const after = await bench(page, (b) => b.state());
    expect(after.componentMounts).toBe(before.componentMounts);
    expect(after.liveComponents).toBe(20);
    expect(after.activeSession).toBe(false);
    expect(await same()).toBe(true);
    await expect(local).toHaveText("Local 2");
    expect(errors).toEqual([]);
  });

  test(`${engine}: B5 XR Adaptive at 20 panels: distinct instances, one action per click, manipulation and cleanup`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await openBench(page, engine, 20);
    const textures = await probe(page, "liveTextures");
    await present(page, "adaptive");
    const { instances } = await bench(page, (b) => b.presentations());
    expect(new Set(instances).size).toBe(20);
    expect(instances.every((i) => /^presentation-\d+$/.test(i!))).toBe(true);
    // A real click on panel 5's 3D action runs it exactly once.
    const button = (await page.evaluate(() =>
      (
        window as unknown as {
          __xrHostProbe: { locate(id: string, part: string): Point | null };
        }
      ).__xrHostProbe.locate("bench-5", "button:bump"),
    ))!;
    await page.mouse.click(button.x, button.y);
    await expect(page.getByTestId("bench-bumps-4")).toHaveText("1");
    await page.waitForTimeout(150);
    await expect(page.getByTestId("bench-bumps-4")).toHaveText("1");
    // A real drag on the 3D Move handle of panel 1.
    const start = (await bench(page, (b) => b.pose("bench-1")))!.position;
    const from = (await bench(page, (b) =>
      b.handlePoint("bench-1", "translate"),
    ))!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 15, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const p = (await bench(page, (b) => b.pose("bench-1")))!.position;
        return Math.hypot(p[0]! - start[0]!, p[1]! - start[1]!);
      })
      .toBeGreaterThan(0.02);
    await bench(page, (b) => b.restoreAll());
    await expect.poll(() => probe(page, "panels")).toEqual([]);
    await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
    expect((await bench(page, (b) => b.state())).manipulationTargets).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`${engine}: B6 repeated extract/restore/switch at 20 panels leaves no stale handles, styles or subscriptions`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = watchConsole(page);
    await openBench(page, engine, 20);
    const textures = await probe(page, "liveTextures");
    const before = await bench(page, (b) => b.state());
    for (let cycle = 0; cycle < 3; cycle++) {
      await present(page, "native");
      // Native → Adaptive switch for every panel, then back.
      await bench(page, (b) => b.extractAll("adaptive"));
      await expect
        .poll(() => bench(page, (b) => b.validate("adaptive").issues))
        .toEqual([]);
      await bench(page, (b) => b.extractAll("native"));
      await expect
        .poll(() => bench(page, (b) => b.validate("native").issues))
        .toEqual([]);
      await bench(page, (b) => b.restoreAll());
      await expect
        .poll(() => bench(page, (b) => b.state().manipulationTargets))
        .toBe(0);
    }
    await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
    const after = await bench(page, (b) => b.state());
    expect(after.sdkMarkedElements).toBe(0);
    expect(after.activeSession).toBe(false);
    expect(after.dataSubscriptions).toBe(before.dataSubscriptions);
    expect(after.componentMounts).toBe(before.componentMounts);
    expect(after.liveComponents).toBe(20);
    expect(after.presentations).toMatchObject({ native: 0, adaptive: 0 });
    // The original handles of a restored element take no input.
    const handle = panel(page, 0).locator("[data-spatialflex-handle]");
    await expect(handle).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("B3 benchmark mode is opt-in: ordinary lab pages expose no collector or harness", async ({
  page,
}) => {
  await page.goto(
    "/?engine=three&integration=spatialflex&bridge=off&xr-emulator=off&surface=website",
  );
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  expect(
    await page.evaluate(() => ({
      perf: "__spatialPerf" in window,
      bench: "__spatialBench" in window,
    })),
  ).toEqual({ perf: false, bench: false });
  await expect(page.locator(".bench-panel")).toHaveCount(0);
});
