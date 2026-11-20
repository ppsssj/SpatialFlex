import { expect, test, type Page } from "@playwright/test";
import { ENGINES, probe, watchConsole, type Engine } from "./lab";

/**
 * P1-07D Adaptive panel texture correctness (D1–D7), for every engine.
 *
 * Visual checks compare RENDERED pixels (page screenshots of the WebGL
 * canvas), not DOM text: the panel region after a sequence of updates is
 * compared with the same region of a fresh page that rendered only the
 * final state (the reference), and with one that rendered the previous
 * state (a stale reference, which must NOT match). Equality is measured,
 * not assumed: mean absolute channel difference and the share of pixels
 * that differ by more than 48 in any channel. Same browser, same viewport,
 * same camera; no cross-browser pixel comparison.
 *
 * Redraw/upload counts (D2, D3) come from the benchmark-mode collector
 * (`?fixture=benchmark`), which is how the benchmark observes the texture
 * pipeline; nothing is mocked.
 */

type Point = { x: number; y: number };
type Clip = { x: number; y: number; width: number; height: number };
type Counters = Record<string, number>;
type W = Window & {
  __spatialBench?: {
    extractAll(kind: string): boolean[];
    restoreAll(): boolean[];
    setCamera(p: number[], t: number[]): boolean;
    validate(kind: string): { issues: string[] };
    state(): {
      presentations: { native: number; adaptive: number };
      manipulationTargets: number;
      liveTextures: number;
      dataSubscriptions: number;
      componentMounts: number;
    };
    handlePoint(id: string, mode: string): Point | null;
    pose(id: string): { position: number[] } | null;
    data: {
      step(): void;
      getTick(): number;
      setValue(index: number, text: string): void;
      start(ms: number): void;
      stop(): void;
    };
    collector: {
      start(): void;
      stop(): {
        counters: Counters;
        spans: Record<string, { count: number }>;
      };
    };
  };
  __xrHostProbe: {
    worldPosition(id: string, part: string): number[] | null;
    project(p: number[]): Point | null;
    locate(id: string, part: string): Point | null;
    hovered(id: string, part: string): boolean;
    drawn: Record<string, { text: string }>;
  };
};

const PANELS = 5;
const ids = Array.from({ length: PANELS }, (_, i) => `bench-${i + 1}`);
const valueOf = (tick: number, index: number) =>
  (tick * (index + 3) + index * 17) % 1000;

async function open(page: Page, engine: Engine) {
  await page.goto(
    `/?engine=${engine}&integration=spatialflex&bridge=off&xr-emulator=off&surface=website&fixture=benchmark&panels=${PANELS}`,
  );
  await expect.poll(() => probe(page, "frames")).toBeGreaterThan(2);
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as W).__spatialBench))
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as W).__spatialBench!.setCamera(
      [0, 1.42, 4],
      [0, 1.42, -0.4],
    ),
  );
  await rest(page);
}

/**
 * Rests the pointer on empty canvas (bottom-left floor), away from every
 * panel: hosts clear hover feedback on pointer moves inside the canvas.
 */
async function rest(page: Page) {
  const box = (await page.getByTestId("xr-canvas").boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + box.height - 12);
}

async function present(page: Page) {
  await page.evaluate(() =>
    (window as unknown as W).__spatialBench!.extractAll("adaptive"),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as W).__spatialBench!.validate("adaptive").issues,
      ),
    )
    .toEqual([]);
}

/** Waits until every panel drew `Value=<expected>` and frames followed. */
async function settled(page: Page, expected: (index: number) => string) {
  const want = ids.map((_, i) => `Value=${expected(i)}`);
  await expect
    .poll(() =>
      page.evaluate(
        (list) =>
          list.map(
            (id) =>
              (window as unknown as W).__xrHostProbe.drawn[id]?.text ?? "",
          ),
        ids,
      ),
    )
    .toEqual(want);
  await frames(page, 6);
}

const frames = (page: Page, n: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const next = () =>
          --left <= 0 ? resolve() : requestAnimationFrame(next);
        requestAnimationFrame(next);
      }),
    n,
  );

/** Screen rectangle of a panel's face (projected corners, inset). */
async function faceClip(page: Page, id: string): Promise<Clip> {
  const corners = await page.evaluate((panel) => {
    const p = (window as unknown as W).__xrHostProbe;
    const c = p.worldPosition(panel, "background")!;
    return [
      [-0.3, -0.2],
      [0.3, -0.2],
      [-0.3, 0.2],
      [0.3, 0.2],
    ].map(([dx, dy]) => p.project([c[0]! + dx!, c[1]! + dy!, c[2]!])!);
  }, id);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  // 1 px inset: the panel's own pixels only, its border band included.
  const inset = 1;
  const x = Math.ceil(Math.min(...xs)) + inset;
  const y = Math.ceil(Math.min(...ys)) + inset;
  return {
    x,
    y,
    width: Math.floor(Math.max(...xs)) - inset - x,
    height: Math.floor(Math.max(...ys)) - inset - y,
  };
}

const shoot = async (page: Page, clip: Clip) =>
  (await page.screenshot({ clip, animations: "disabled" })).toString("base64");

/** Pixel difference of two same-size PNG screenshots, decoded in-page. */
async function difference(page: Page, a: string, b: string) {
  return page.evaluate(
    async ([first, second]) => {
      const decode = async (data: string) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${data}`)).blob(),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [x, y] = await Promise.all([decode(first), decode(second)]);
      if (x.width !== y.width || x.height !== y.height)
        return { meanAbs: Infinity, differing: 1, changed: 1, pixels: 0 };
      let sum = 0;
      let differing = 0;
      let changed = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        let max = 0;
        for (let c = 0; c < 3; c++) {
          const d = Math.abs(x.data[i + c]! - y.data[i + c]!);
          sum += d;
          if (d > max) max = d;
        }
        if (max > 48) differing++;
        if (max > 16) changed++;
      }
      const pixels = x.data.length / 4;
      return {
        meanAbs: sum / (pixels * 3),
        differing: differing / pixels,
        changed: changed / pixels,
        pixels,
      };
    },
    [a, b] as const,
  );
}

async function capture(page: Page) {
  const shots: string[] = [];
  for (const id of ids) shots.push(await shoot(page, await faceClip(page, id)));
  return shots;
}

/**
 * The fresh-page references for tick `tick`: `final` renders only that
 * state; `stale` renders the state one tick earlier.
 */
async function references(page: Page, engine: Engine, tick: number) {
  await open(page, engine);
  await page.evaluate((n) => {
    const d = (window as unknown as W).__spatialBench!.data;
    for (let i = 0; i < n; i++) d.step();
  }, tick - 1);
  await present(page);
  await settled(page, (i) => String(valueOf(tick - 1, i)));
  const stale = await capture(page);
  await page.evaluate(() =>
    (window as unknown as W).__spatialBench!.data.step(),
  );
  await settled(page, (i) => String(valueOf(tick, i)));
  const final = await capture(page);
  return { final, stale };
}

/** Each shot matches its reference and differs from the stale one. */
async function expectLatest(
  page: Page,
  shots: string[],
  refs: { final: string[]; stale: string[] },
) {
  for (let i = 0; i < shots.length; i++) {
    const same = await difference(page, shots[i]!, refs.final[i]!);
    const stale = await difference(page, shots[i]!, refs.stale[i]!);
    test.info().annotations.push({
      type: `panel ${i + 1} pixel difference`,
      description: `vs reference ${JSON.stringify(same)}; vs stale ${JSON.stringify(stale)}`,
    });
    expect(same.pixels, `panel ${i + 1} size`).toBeGreaterThan(1000);
    expect(same.changed, `panel ${i + 1} vs reference`).toBeLessThan(0.001);
    expect(same.meanAbs, `panel ${i + 1} vs reference`).toBeLessThan(0.5);
    // The stale state is distinguishable at this resolution (a single
    // changed digit), so the check above can fail.
    expect(stale.changed, `panel ${i + 1} vs stale`).toBeGreaterThan(0.004);
  }
}

const counters = (r: { counters: Counters }, name: string) =>
  r.counters[name] ?? 0;

for (const engine of ENGINES) {
  test(`${engine}: D1/D6 after rapid updates every panel renders the latest value (rendered pixels vs fresh reference)`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await open(page, engine);
    await present(page);
    // Rapid updates: a 10 ms timer (faster than frames) for 600 ms, then a
    // synchronous burst of 7 updates inside one task.
    await page.evaluate(() =>
      (window as unknown as W).__spatialBench!.data.start(10),
    );
    await page.waitForTimeout(600);
    const tick = await page.evaluate(() => {
      const d = (window as unknown as W).__spatialBench!.data;
      d.stop();
      for (let i = 0; i < 7; i++) d.step();
      return d.getTick();
    });
    expect(tick).toBeGreaterThan(10);
    await settled(page, (i) => String(valueOf(tick, i)));
    const shots = await capture(page);
    expect(errors).toEqual([]);
    const viewport = page.viewportSize()!;
    await page.close();

    const fresh = await browser.newPage({ viewport });
    const refs = await references(fresh, engine, tick);
    await expectLatest(fresh, shots, refs);
    await fresh.close();
  });

  test(`${engine}: D2/D3 unchanged content is not redrawn or re-uploaded; one panel's update touches only that panel`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await open(page, engine);
    await present(page);
    await settled(page, (i) => String(valueOf(0, i)));
    const run = (fn: string) =>
      page.evaluate(async (source) => {
        const b = (window as unknown as W).__spatialBench!;
        b.collector.start();
        new Function("b", source)(b);
        // Long enough for every engine to render several frames.
        await new Promise((r) => setTimeout(r, 400));
        return b.collector.stop();
      }, fn);
    // Every item re-renders and re-declares its view (new body objects);
    // only panel 3's text changes.
    const one = await run('b.data.setValue(2, "X42")');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as W).__xrHostProbe.drawn["bench-3"]!.text,
        ),
      )
      .toBe("Value=X42");
    // Re-declaring identical content: nothing changes.
    const none = await run('b.data.setValue(2, "X42")');
    if (engine === "three") {
      expect(counters(one, "three.faceDraw.content")).toBe(1);
      expect(counters(one, "three.faceDraw.unchanged")).toBe(0);
      expect(counters(one, "three.textureDirty")).toBe(1);
      expect(counters(none, "three.textureDirty")).toBe(0);
    } else {
      expect(one.spans["babylon.textureUpdate"]?.count).toBe(1);
      expect(none.spans["babylon.textureUpdate"]?.count ?? 0).toBe(0);
    }
    // Observed WebGL uploads (both engines): exactly the one panel face.
    expect(counters(one, "gl.uploadCalls")).toBe(1);
    expect(counters(none, "gl.uploadCalls")).toBe(0);
    expect(counters(one, "gl.createTexture")).toBe(0);
    expect(errors).toEqual([]);
  });

  test(`${engine}: D4 hover, selection and the action button render and clear correctly`, async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await open(page, engine);
    await present(page);
    await settled(page, (i) => String(valueOf(0, i)));
    const clip = await faceClip(page, "bench-2");
    const initial = await shoot(page, clip);

    // Hover over panel 2's "+1" button: feedback appears in its pixels.
    const button = (await page.evaluate(() =>
      (window as unknown as W).__xrHostProbe.locate("bench-2", "button:bump"),
    ))!;
    await page.mouse.move(button.x, button.y);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as W).__xrHostProbe.hovered(
            "bench-2",
            "button:bump",
          ),
        ),
      )
      .toBe(true);
    await frames(page, 6);
    const hovered = await shoot(page, clip);
    const changed = async (shot: string) =>
      (await difference(page, shot, initial)).changed;
    expect(await changed(hovered)).toBeGreaterThan(0.002);
    // ...and clears.
    await rest(page);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as W).__xrHostProbe.hovered(
            "bench-2",
            "button:bump",
          ),
        ),
      )
      .toBe(false);
    await frames(page, 6);
    expect(await changed(await shoot(page, clip))).toBeLessThan(0.001);

    // The action runs exactly once per click.
    await page.mouse.click(button.x, button.y);
    await expect(page.getByTestId("bench-bumps-1")).toHaveText("1");
    await page.waitForTimeout(150);
    await expect(page.getByTestId("bench-bumps-1")).toHaveText("1");
    await rest(page);
    await frames(page, 6);
    expect(await changed(await shoot(page, clip))).toBeLessThan(0.001);

    // Selecting panel 2 (a click on its face) draws the selection border.
    const select = async (id: string) => {
      const face = (await page.evaluate(
        (panel) =>
          (window as unknown as W).__xrHostProbe.locate(panel, "background"),
        id,
      ))!;
      await page.mouse.click(face.x, face.y);
      await rest(page);
    };
    await select("bench-2");
    await expect
      .poll(async () => changed(await shoot(page, clip)))
      .toBeGreaterThan(0.01);
    // Selecting another panel clears panel 2's border again.
    await select("bench-4");
    await expect
      .poll(async () => changed(await shoot(page, clip)))
      .toBeLessThan(0.001);
    expect(errors).toEqual([]);
  });

  test(`${engine}: D5 extract/restore, manipulation and host remount cycles release textures and never show stale content`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const errors = watchConsole(page);
    await open(page, engine);
    const textures = await probe(page, "liveTextures");
    const subscriptions = await page.evaluate(
      () => (window as unknown as W).__spatialBench!.state().dataSubscriptions,
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      await present(page);
      await page.evaluate(() =>
        (window as unknown as W).__spatialBench!.data.step(),
      );
      // Move, rotate and scale panel 1 with the real mouse.
      for (const mode of ["translate", "rotate", "resize"]) {
        const from = await page.evaluate(
          (m) =>
            (window as unknown as W).__spatialBench!.handlePoint("bench-1", m),
          mode,
        );
        if (!from) continue;
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 });
        await page.mouse.up();
      }
      await rest(page);
      await page.evaluate(() =>
        (window as unknown as W).__spatialBench!.restoreAll(),
      );
      await expect.poll(() => probe(page, "panels")).toEqual([]);
      await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
      // Data changes while nothing is presented.
      await page.evaluate(() =>
        (window as unknown as W).__spatialBench!.data.step(),
      );
    }
    // Unmount and remount the workspace: every item registers again with
    // the same ids (new registrations); the data changes in between.
    await present(page);
    await page.getByRole("button", { name: "Unmount workspace" }).click();
    await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
    await page.getByRole("button", { name: "Mount workspace" }).click();
    await expect(page.getByTestId("surface-status")).toHaveAttribute(
      "data-value",
      "visible",
    );
    await page.evaluate(() =>
      (window as unknown as W).__spatialBench!.data.step(),
    );
    await page.evaluate(() =>
      (window as unknown as W).__spatialBench!.setCamera(
        [0, 1.42, 4],
        [0, 1.42, -0.4],
      ),
    );
    await present(page);
    const tick = await page.evaluate(() =>
      (window as unknown as W).__spatialBench!.data.getTick(),
    );
    await settled(page, (i) => String(valueOf(tick, i)));
    expect(
      await page.evaluate(
        () =>
          (window as unknown as W).__spatialBench!.state().dataSubscriptions,
      ),
    ).toBe(subscriptions);
    // Panels 2–5 were never manipulated: their pixels match a fresh page
    // showing the same data (panel 1's pose was reset by the remount too,
    // so it is compared as well).
    const shots = await capture(page);
    await page.evaluate(() =>
      (window as unknown as W).__spatialBench!.restoreAll(),
    );
    await expect.poll(() => probe(page, "liveTextures")).toBe(textures);
    // Unmounting the workspace releases the WebGL context on purpose.
    expect(errors.filter((e) => !/WebGL context was lost/.test(e))).toEqual([]);
    const viewport = page.viewportSize()!;
    await page.close();
    const fresh = await browser.newPage({ viewport });
    await expectLatest(fresh, shots, await references(fresh, engine, tick));
    await fresh.close();
  });
}
