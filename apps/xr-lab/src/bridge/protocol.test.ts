import { describe, expect, it, vi } from "vitest";
import type { HostPanel } from "../contracts/xrHost";
import { ActionLedger } from "./authority";
import { applyState } from "./replica";
import {
  CAPABILITY,
  envelope,
  isMessage,
  trustedEvent,
  type BridgeMessage,
} from "./protocol";

const panel: HostPanel = {
  id: "counter",
  title: "Counter",
  position: [0, 1, -1],
  body: { kind: "value", label: "Count", value: "0" },
  buttons: [{ id: "increment", label: "+1" }],
  selected: false,
};
const base = envelope("app", "view", 1, "connection");
const snapshot: BridgeMessage = { ...base, type: "snapshot", panels: [panel] };
const request = {
  ...base,
  type: "action-request" as const,
  itemId: "counter",
  requestId: "request",
  action: "increment",
};
const events = () => ({
  onPanelButton: vi.fn(),
  onPanelSelect: vi.fn(),
  onPanelClose: vi.fn(),
});

describe("bridge schema", () => {
  it("rejects sparse wire arrays, including vector coordinates", () => {
    expect(isMessage({ ...snapshot, panels: new Array(1) })).toBe(false);
    expect(
      isMessage({
        ...snapshot,
        panels: [{ ...panel, position: new Array(3) }],
      }),
    ).toBe(false);
    expect(
      isMessage({ ...base, type: "hello", capabilities: new Array(1) }),
    ).toBe(false);
  });
  it("accepts every documented message after a structured clone", () => {
    const messages: BridgeMessage[] = [
      snapshot,
      { ...base, type: "hello", capabilities: [CAPABILITY] },
      { ...base, type: "welcome", capabilities: [CAPABILITY] },
      { ...base, type: "update", panels: [panel] },
      { ...base, type: "register", itemId: panel.id, panels: [panel] },
      { ...base, type: "unregister", itemId: panel.id, panels: [] },
      request,
      {
        ...base,
        type: "action-result",
        itemId: panel.id,
        requestId: "request",
        status: "ok",
      },
      ...(["ping", "pong", "disconnect", "resync"] as const).map((type) => ({
        ...base,
        type,
      })),
    ];
    for (const message of messages)
      expect(isMessage(structuredClone(message))).toBe(true);
  });
  it.each([
    null,
    {},
    [],
    { ...snapshot, protocolVersion: 2 },
    { ...snapshot, revision: -1 },
    { ...snapshot, revision: 1.5 },
    { ...snapshot, appSessionId: "" },
    { ...snapshot, connectionId: "" },
    { ...snapshot, extra: 1 },
    { ...snapshot, panels: [panel, panel] },
    { ...snapshot, panels: [{ ...panel, position: [0, NaN, 0] }] },
    {
      ...snapshot,
      panels: [
        { ...panel, body: { kind: "value", label: "x", value: () => 0 } },
      ],
    },
    {
      ...snapshot,
      panels: [
        {
          ...panel,
          body: { kind: "swatch", color: "url(javascript:bad)", caption: "x" },
        },
      ],
    },
    { ...request, action: "a".repeat(257) },
    { ...request, type: "execute-code" },
  ])("rejects malformed input %j", (value) => {
    expect(isMessage(value)).toBe(false);
  });
  it("requires both origin and exact non-null source", () => {
    const source = {} as Window;
    expect(
      trustedEvent(
        { origin: "https://app.test", source },
        "https://app.test",
        source,
      ),
    ).toBe(true);
    expect(
      trustedEvent(
        { origin: "https://evil.test", source },
        "https://app.test",
        source,
      ),
    ).toBe(false);
    expect(
      trustedEvent(
        { origin: "https://app.test", source: {} as Window },
        "https://app.test",
        source,
      ),
    ).toBe(false);
    expect(
      trustedEvent(
        { origin: "https://app.test", source: null },
        "https://app.test",
        null,
      ),
    ).toBe(false);
  });
});

describe("session action ledger", () => {
  it("executes exactly two actions for one web action and any number of XR retries", () => {
    let count = 0;
    const increment = () => count++;
    increment();
    const hostEvents = { ...events(), onPanelButton: vi.fn(increment) };
    const ledger = new ActionLedger();
    for (let i = 0; i < 20; i++)
      expect(ledger.execute(request, [panel], hostEvents).status).toBe("ok");
    expect(count).toBe(2);
    expect(hostEvents.onPanelButton).toHaveBeenCalledTimes(1);
    expect(ledger.size).toBe(1);
  });
  it("rejects unknown, prototype-named, hidden/unregistered items and unknown actions", () => {
    const ledger = new ActionLedger();
    const e = events();
    for (const itemId of ["unknown", "__proto__", "constructor"])
      expect(
        ledger.execute({ ...request, itemId, requestId: itemId }, [panel], e)
          .status,
      ).toBe("denied");
    expect(
      ledger.execute({ ...request, requestId: "unmounted" }, [], e).status,
    ).toBe("denied");
    expect(
      ledger.execute(
        { ...request, action: "unknown", requestId: "bad-action" },
        [panel],
        e,
      ).status,
    ).toBe("denied");
    expect(e.onPanelButton).not.toHaveBeenCalled();
  });
  it("replays a result across connection changes without executing again; rejects ID reuse", () => {
    const ledger = new ActionLedger();
    const e = events();
    ledger.execute(request, [panel], e);
    expect(
      ledger.execute({ ...request, connectionId: "new" }, [], e),
    ).toMatchObject({ status: "ok", connectionId: "new" });
    expect(
      ledger.execute({ ...request, action: "different" }, [panel], e).status,
    ).toBe("conflict");
    expect(e.onPanelButton).toHaveBeenCalledTimes(1);
  });
  it("bounds records without evicting retry protection", () => {
    const ledger = new ActionLedger(2);
    const e = events();
    ledger.execute(request, [panel], e);
    ledger.execute({ ...request, requestId: "second" }, [panel], e);
    expect(
      ledger.execute({ ...request, requestId: "third" }, [panel], e).status,
    ).toBe("capacity");
    ledger.execute(request, [panel], e);
    expect(ledger.size).toBe(2);
    expect(e.onPanelButton).toHaveBeenCalledTimes(2);
  });
  it("never retries an action that threw after a possible mutation", () => {
    const ledger = new ActionLedger();
    const e = {
      ...events(),
      onPanelButton: vi.fn(() => {
        throw Error("after mutation");
      }),
    };
    expect(ledger.execute(request, [panel], e).status).toBe("denied");
    ledger.execute(request, [panel], e);
    expect(e.onPanelButton).toHaveBeenCalledTimes(1);
  });
});

it("ignores duplicates and older revisions; full replacements recover dropped changes", () => {
  const initial = { revision: -1, panels: [] };
  const first = applyState(initial, snapshot);
  const latest = applyState(first, { ...snapshot, revision: 5, panels: [] });
  expect(applyState(latest, snapshot)).toBe(latest);
  expect(applyState(latest, { ...snapshot, revision: 5 })).toBe(latest);
  expect(applyState(latest, { ...snapshot, revision: 6 })).toEqual({
    revision: 6,
    panels: [panel],
  });
});
