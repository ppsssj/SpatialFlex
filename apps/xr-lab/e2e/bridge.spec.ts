import { expect, test, type Frame, type Page } from "@playwright/test";
import type { BridgeMessage } from "../src/bridge/protocol";
import type { Probe } from "./lab";
import { COMBINATIONS, MODES, watchConsole } from "./lab";

type Faults = {
  messages: BridgeMessage[];
  drop: string[];
  holdState: boolean;
  duplicate: string[];
  held: MessageEvent[];
  release(): void;
  deliver(
    data: BridgeMessage,
    source: MessageEventSource | null,
    origin: string,
  ): void;
  messageListeners: number;
};
type TestWindow = Window & { __bridgeFaults: Faults; __xrHostProbe?: Probe };

// Deterministic receiver-side faults, installed before either entrypoint.
// Production has no fault controls. Application interactions still raycast 3D.
async function installFaults(page: Page) {
  await page.addInitScript(() => {
    const nativeAdd = window.addEventListener.bind(window);
    const nativeRemove = window.removeEventListener.bind(window);
    const synthetic = new WeakSet<Event>();
    const listeners = new Set<unknown>();
    const faults: Faults = {
      messages: [],
      drop: [],
      holdState: false,
      duplicate: [],
      held: [],
      messageListeners: 0,
      deliver(data, source, origin) {
        const event = new MessageEvent("message", { data, source, origin });
        synthetic.add(event);
        window.dispatchEvent(event);
      },
      release() {
        for (const event of faults.held.splice(0).reverse()) {
          synthetic.add(event);
          window.dispatchEvent(event);
        }
      },
    };
    (window as unknown as TestWindow).__bridgeFaults = faults;
    nativeAdd("message", (event) => {
      if (synthetic.has(event)) return;
      const m = event.data;
      if (m?.protocolVersion !== 1) return;
      faults.messages.push(m);
      if (faults.messages.length > 100) faults.messages.shift();
      if (faults.drop.includes(m.type)) {
        event.stopImmediatePropagation();
        return;
      }
      const copy = () =>
        new MessageEvent("message", {
          data: structuredClone(m),
          source: event.source,
          origin: event.origin,
        });
      if (faults.holdState && "panels" in m) {
        faults.held.push(copy());
        event.stopImmediatePropagation();
        return;
      }
      if (faults.duplicate.includes(m.type)) {
        const duplicate = copy();
        synthetic.add(duplicate);
        queueMicrotask(() => window.dispatchEvent(duplicate));
      }
    });
    window.addEventListener = ((
      type: string,
      listener: unknown,
      options: unknown,
    ) => {
      if (type === "message") {
        listeners.add(listener);
        faults.messageListeners = listeners.size;
      }
      nativeAdd(type, listener as EventListener, options as boolean);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((
      type: string,
      listener: unknown,
      options: unknown,
    ) => {
      if (type === "message") {
        listeners.delete(listener);
        faults.messageListeners = listeners.size;
      }
      nativeRemove(type, listener as EventListener, options as boolean);
    }) as typeof window.removeEventListener;
  });
}

async function openBridge(page: Page, engine = "three", mode = "baseline") {
  await installFaults(page);
  await page.goto(
    `/?bridge=iframe&engine=${engine}&integration=${mode}&xr-emulator=off`,
  );
  await expect(page.getByTestId("bridge-status")).toHaveText("connected");
  const frame = page.frames().find((f) => f.url().includes("/host.html"))!;
  await expect(frame.getByTestId("view-status")).toContainText("connected");
  await expect
    .poll(() =>
      frame.evaluate(
        () => (window as unknown as TestWindow).__xrHostProbe?.frames ?? 0,
      ),
    )
    .toBeGreaterThan(2);
  return frame;
}

const panels = (frame: Frame) =>
  frame.evaluate(
    () => (window as unknown as TestWindow).__xrHostProbe?.panels ?? [],
  );
const drawn = (frame: Frame, id = "shared-counter") =>
  frame.evaluate(
    (id) => (window as unknown as TestWindow).__xrHostProbe?.drawn[id]?.text,
    id,
  );
async function show(page: Page, frame: Frame, id: string) {
  await page
    .getByTestId(`xr-item-${id}`)
    .getByRole("button", { name: "Show in XR", exact: true })
    .click();
  await expect.poll(() => panels(frame)).toContain(id);
}
async function click3D(page: Page, frame: Frame, id: string, part: string) {
  const point = await frame.evaluate(
    ([id, part]) =>
      (window as unknown as TestWindow).__xrHostProbe?.locate(id!, part!),
    [id, part],
  );
  expect(point).toBeTruthy();
  const box = await page.locator("iframe").boundingBox();
  await page.mouse.click(box!.x + 1 + point!.x, box!.y + 1 + point!.y);
}
async function inject(frame: Frame, patch: Record<string, unknown>) {
  await frame.evaluate((patch) => {
    const welcome = (window as unknown as TestWindow).__bridgeFaults.messages
      .slice()
      .reverse()
      .find((m) => m.type === "welcome")!;
    const { protocolVersion, appSessionId, viewId, connectionId } = welcome;
    window.parent.postMessage(
      {
        protocolVersion,
        appSessionId,
        viewId,
        connectionId,
        revision: 0,
        type: "action-request",
        itemId: "shared-counter",
        action: "increment",
        requestId: crypto.randomUUID(),
        ...patch,
      },
      location.origin,
    );
  }, patch);
}

for (const { engine, mode } of COMBINATIONS) {
  test(`${engine}/${mode}: separate realm, snapshot, bidirectional actions and unregistration`, async ({
    page,
  }) => {
    const problems = watchConsole(page);
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    const frame = await openBridge(page, engine, mode);
    expect(
      await frame.evaluate(
        () =>
          window !== window.parent &&
          Array !== (window.parent as Window & typeof globalThis).Array,
      ),
    ).toBe(true);
    await show(page, frame, "shared-counter");
    await expect.poll(() => drawn(frame)).toContain("Shared count=0");
    await page.getByTestId("web-increment").click();
    await expect.poll(() => drawn(frame)).toContain("Shared count=1");
    await click3D(page, frame, "shared-counter", "button:increment");
    await expect(page.getByTestId("web-count")).toHaveText("2");
    await expect.poll(() => drawn(frame)).toContain("Shared count=2");
    await expect(page.getByTestId("increment-calls")).toHaveText("2");
    await expect(page.getByTestId("action-count")).toHaveText("2");
    await show(page, frame, "image-panel");
    await page.getByTestId("image-mounted").uncheck();
    await expect.poll(() => panels(frame)).not.toContain("image-panel");
    expect(
      await frame.evaluate(() =>
        (window as unknown as TestWindow).__bridgeFaults.messages.some(
          (m) => m.type === "unregister" && m.itemId === "image-panel",
        ),
      ),
    ).toBe(true);
    const loaded = (chunk: string) =>
      requests.some((url) => new RegExp(`/${chunk}-[^/]*\\.js$`).test(url));
    expect(loaded("spatialflex")).toBe(mode === "spatialflex");
    expect(loaded("three-host")).toBe(engine === "three");
    expect(loaded("babylon-host")).toBe(engine === "babylon");
    const childScripts = await frame.evaluate(() =>
      performance.getEntriesByType("resource").map((r) => r.name),
    );
    expect(
      childScripts.some((url) =>
        /\/(fixtures|baseline|spatialflex|app|IframeHost)-[^/]*\.js$/.test(url),
      ),
    ).toBe(false);
    expect(problems).toEqual([]);
  });
}

for (const mode of MODES) {
  test(`${mode}: parent lease expires without pong; iframe reload resyncs without replaying actions`, async ({
    page,
  }) => {
    let frame = await openBridge(page, "three", mode);
    await show(page, frame, "shared-counter");
    await click3D(page, frame, "shared-counter", "button:increment");
    await expect(page.getByTestId("increment-calls")).toHaveText("1");
    const request = await page.evaluate(() =>
      (window as unknown as TestWindow).__bridgeFaults.messages.find(
        (m) => m.type === "action-request",
      )!,
    );
    await frame.evaluate(() => location.reload());
    frame = page.frames().find((f) => f.url().includes("/host.html"))!;
    await expect(frame.getByTestId("view-status")).toContainText("connected");
    await expect.poll(() => drawn(frame)).toBe("Shared count=1");
    await inject(frame, {
      requestId: (request as Extract<BridgeMessage, { type: "action-request" }>)
        .requestId,
    });
    await click3D(page, frame, "shared-counter", "button:increment");
    await expect(page.getByTestId("increment-calls")).toHaveText("2");
    await page.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = ["pong", "hello"];
    });
    await expect(page.getByTestId("bridge-status")).toHaveText("disconnected");
    await inject(frame, { requestId: "expired-parent-lease" });
    await expect(frame.getByTestId("view-status")).toContainText(
      "stale / disconnected",
    );
    await expect(page.getByTestId("increment-calls")).toHaveText("2");
    await page.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = [];
    });
    await expect(page.getByTestId("bridge-status")).toHaveText("connected");
    await expect.poll(() => drawn(frame)).toBe("Shared count=2");
  });

  test(`${mode}: lost disconnect expires the view lease and rejects old connection requests`, async ({
    page,
  }) => {
    const frame = await openBridge(page, "three", mode);
    await show(page, frame, "shared-counter");
    await frame.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = ["disconnect"];
    });
    await page
      .getByRole("button", { name: "Disconnect bridge", exact: true })
      .click();
    await click3D(page, frame, "shared-counter", "button:increment");
    await expect(frame.getByTestId("view-status")).toContainText(
      "stale / disconnected",
    );
    await expect.poll(() => panels(frame)).toEqual([]);
    await expect(page.getByTestId("increment-calls")).toHaveText("0");
    const oldConnection = await frame.evaluate(
      () =>
        (window as unknown as TestWindow).__bridgeFaults.messages
          .slice()
          .reverse()
          .find((m) => m.type === "welcome")!.connectionId,
    );
    await frame.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = [];
    });
    await page
      .getByRole("button", { name: "Reconnect bridge", exact: true })
      .click();
    await expect.poll(() => panels(frame)).toContain("shared-counter");
    await inject(frame, {
      connectionId: oldConnection,
      requestId: "expired-connection",
    });
    await click3D(page, frame, "shared-counter", "button:increment");
    await expect(page.getByTestId("increment-calls")).toHaveText("1");
  });

  test(`${mode}: handshake requires origin, source, version, session and capability`, async ({
    page,
  }) => {
    await installFaults(page);
    await page.addInitScript(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = ["hello"];
    });
    await page.goto(`/?bridge=iframe&integration=${mode}&xr-emulator=off`);
    const frame = await expect
      .poll(() =>
        page
          .frames()
          .find((f) => f.url().includes("/host.html"))
          ?.url(),
      )
      .toBeTruthy()
      .then(() => page.frames().find((f) => f.url().includes("/host.html"))!);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as TestWindow).__bridgeFaults.messages.some(
            (m) => m.type === "hello",
          ),
        ),
      )
      .toBe(true);
    await page.evaluate(() => {
      const f = (window as unknown as TestWindow).__bridgeFaults;
      const hello = f.messages.find((m) => m.type === "hello")!;
      const source = document.querySelector("iframe")!.contentWindow;
      for (const patch of [
        { capabilities: [] },
        { protocolVersion: 2 },
        { appSessionId: "foreign" },
        { viewId: "foreign" },
      ])
        f.deliver(
          { ...hello, ...patch } as BridgeMessage,
          source,
          location.origin,
        );
      f.deliver(hello, window, location.origin);
      f.deliver(hello, source, "https://untrusted.example");
    });
    await expect(page.getByTestId("bridge-status")).toHaveText("disconnected");
    await page.evaluate(() => {
      const f = (window as unknown as TestWindow).__bridgeFaults;
      const hello = f.messages.find((m) => m.type === "hello")!;
      f.deliver(
        hello,
        document.querySelector("iframe")!.contentWindow,
        location.origin,
      );
      f.drop = [];
    });
    await expect(page.getByTestId("bridge-status")).toHaveText("connected");
    await expect(frame.getByTestId("view-status")).toContainText("connected");
  });

  test(`${mode}: retries, duplicates, reordering, dropped snapshots and reconnect`, async ({
    page,
  }) => {
    const frame = await openBridge(page, "three", mode);
    await show(page, frame, "shared-counter");
    await page.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.duplicate = [
        "action-request",
      ];
    });
    await frame.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = ["action-result"];
    });
    await click3D(page, frame, "shared-counter", "button:increment");
    await expect(page.getByTestId("web-count")).toHaveText("1");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as TestWindow).__bridgeFaults.messages.filter(
              (m) => m.type === "action-request",
            ).length,
        ),
      )
      .toBeGreaterThanOrEqual(3);
    await frame.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = [];
    });
    await expect(frame.getByTestId("action-result")).toHaveText("ok");
    await expect(page.getByTestId("increment-calls")).toHaveText("1");

    await frame.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.holdState = true;
    });
    await page.getByTestId("web-increment").click();
    await page.getByTestId("web-increment").click();
    await expect
      .poll(() =>
        frame.evaluate(
          () => (window as unknown as TestWindow).__bridgeFaults.held.length,
        ),
      )
      .toBeGreaterThanOrEqual(2);
    await frame.evaluate(() => {
      const f = (window as unknown as TestWindow).__bridgeFaults;
      f.holdState = false;
      f.release();
    });
    await expect.poll(() => drawn(frame)).toContain("Shared count=3");
    const revision = Number(
      await frame.getByTestId("view-revision").textContent(),
    );
    expect(revision).toBeGreaterThan(0);

    await frame.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = [
        "update",
        "snapshot",
        "register",
        "unregister",
      ];
    });
    await page.getByTestId("web-increment").click();
    await expect(page.getByTestId("web-count")).toHaveText("4");
    await expect.poll(() => drawn(frame)).toContain("Shared count=3");
    await expect(frame.getByTestId("view-status")).toContainText(
      "stale / disconnected",
    );
    await expect.poll(() => panels(frame)).toEqual([]);
    await frame.evaluate(() => {
      (window as unknown as TestWindow).__bridgeFaults.drop = [];
    });
    await expect.poll(() => drawn(frame)).toContain("Shared count=4");

    await page
      .getByRole("button", { name: "Disconnect bridge", exact: true })
      .click();
    await expect(frame.getByTestId("view-status")).toContainText(
      "stale / disconnected",
    );
    await inject(frame, {});
    await page.getByTestId("web-increment").click();
    await expect(page.getByTestId("increment-calls")).toHaveText("5");
    await page
      .getByRole("button", { name: "Reconnect bridge", exact: true })
      .click();
    await expect(page.getByTestId("bridge-status")).toHaveText("connected");
    await expect.poll(() => drawn(frame)).toContain("Shared count=5");
    await click3D(page, frame, "shared-counter", "button:increment");
    await expect(page.getByTestId("increment-calls")).toHaveText("6");
  });

  test(`${mode}: rejects invalid identity, capability, source, actions and unavailable items`, async ({
    page,
  }) => {
    const frame = await openBridge(page, "three", mode);
    await show(page, frame, "shared-counter");
    const rejected = [
      { action: "unknown" },
      { itemId: "unknown" },
      { itemId: "image-panel", action: "next-variant" },
      { appSessionId: "foreign" },
      { viewId: "foreign" },
      { connectionId: "expired" },
      { protocolVersion: 2 },
      { extra: "not permitted" },
    ];
    for (const patch of rejected) await inject(frame, patch);
    // Correct identity from the wrong Window (the parent itself).
    await page.evaluate(() => {
      const hello = (
        window as unknown as TestWindow
      ).__bridgeFaults.messages.find((m) => m.type === "hello")!;
      window.postMessage(
        {
          ...hello,
          type: "action-request",
          itemId: "shared-counter",
          action: "increment",
          requestId: "wrong-source",
        },
        location.origin,
      );
    });
    await inject(frame, { requestId: "barrier" });
    await expect(page.getByTestId("increment-calls")).toHaveText("1");
    await expect(frame.getByTestId("action-result")).toHaveText("none"); // forged requests are not pending user interactions
    await show(page, frame, "image-panel");
    await page.getByTestId("image-mounted").uncheck();
    await expect.poll(() => panels(frame)).not.toContain("image-panel");
    await inject(frame, { itemId: "image-panel", action: "next-variant" });
    await inject(frame, { requestId: "second-barrier" });
    await expect(page.getByTestId("increment-calls")).toHaveText("2");
    await page.getByTestId("image-mounted").check();
    await expect(page.getByTestId("image-variant")).toHaveValue("sunrise");
  });

  test(`${mode}: workspace remounts clean listeners, subscriptions and iframe engines`, async ({
    page,
  }) => {
    let frame = await openBridge(page, "three", mode);
    const baseline = await page
      .getByTestId("active-subscriptions")
      .textContent();
    const listenerCount = await page.evaluate(
      () => (window as unknown as TestWindow).__bridgeFaults.messageListeners,
    );
    for (let i = 0; i < 3; i++) {
      await show(page, frame, "shared-counter");
      await page
        .getByRole("button", { name: "Unmount workspace", exact: true })
        .click();
      await expect(page.locator("iframe")).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as TestWindow).__bridgeFaults.messageListeners,
          ),
        )
        .toBe(listenerCount - 1);
      await page
        .getByRole("button", { name: "Mount workspace", exact: true })
        .click();
      await expect(page.getByTestId("bridge-status")).toHaveText("connected");
      frame = page.frames().find((f) => f.url().includes("/host.html"))!;
      await expect.poll(() => panels(frame)).toContain("shared-counter");
      await expect
        .poll(() =>
          frame.evaluate(
            () => (window as unknown as TestWindow).__xrHostProbe?.activeHosts,
          ),
        )
        .toBe(1);
      await expect(page.getByTestId("active-subscriptions")).toHaveText(
        baseline!,
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as TestWindow).__bridgeFaults.messageListeners,
          ),
        )
        .toBe(listenerCount);
      // Hide before the next loop so Show in XR remains a real user action.
      await page
        .getByTestId("xr-item-shared-counter")
        .getByRole("button", { name: "Remove from XR", exact: true })
        .click();
    }
  });
}
