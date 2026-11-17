import { describe, expect, it, vi } from "vitest";
import { SpatialRegistry, type SpatialViewBinding } from "./index";

const view = (invoke = vi.fn()): SpatialViewBinding => ({
  title: "Counter",
  body: { kind: "value", label: "Count", value: "0" },
  actions: [{ id: "add", label: "+1", invoke }],
});
describe("experimental spatial views", () => {
  it("separates immutable serializable data, handlers and P0 layout records", () => {
    const registry = new SpatialRegistry();
    const handle = registry.register({ id: "counter" });
    const item = registry.get("counter");
    const invoke = vi.fn();
    handle.setView(view(invoke));
    const record = registry.views()[0]!;
    expect(registry.get("counter")).toBe(item);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.actions[0])).toBe(true);
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    expect(JSON.stringify(record)).not.toContain("invoke");
    expect(registry.invokeView("counter", record.registrationId, "add")).toBe(
      true,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(
      registry.invokeView("counter", record.registrationId, "unknown"),
    ).toBe(false);
    expect(
      registry.invokeView("counter", record.registrationId, "constructor"),
    ).toBe(false);
  });
  it("replaces handlers without replacing unchanged data or notifying subscribers", () => {
    const registry = new SpatialRegistry();
    const handle = registry.register({ id: "counter" });
    const first = vi.fn();
    const latest = vi.fn();
    const notified = vi.fn();
    handle.setView(view(first));
    const snapshot = registry.views();
    const unsubscribe = registry.subscribeViews(notified);
    handle.setView(view(latest));
    expect(registry.views()).toBe(snapshot);
    expect(notified).not.toHaveBeenCalled();
    registry.invokeView("counter", snapshot[0]!.registrationId, "add");
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    unsubscribe();
  });
  it("updates body data without changing registration identity or caller-owned input", () => {
    const registry = new SpatialRegistry();
    const handle = registry.register({ id: "chart" });
    const values = [1, 2];
    handle.setView({ body: { kind: "bars", label: "History", values } });
    const original = registry.getView("chart")!;
    values.push(3);
    expect(original.body).toEqual({
      kind: "bars",
      label: "History",
      values: [1, 2],
    });
    handle.setView({
      body: { kind: "swatch", color: "#123abc", caption: "Next" },
    });
    expect(registry.getView("chart")!.registrationId).toBe(
      original.registrationId,
    );
    expect(registry.getView("chart")!.body.kind).toBe("swatch");
  });
  it("revokes declarations and changes their epoch when reenabled", () => {
    const registry = new SpatialRegistry();
    const handle = registry.register({ id: "counter" });
    handle.setView(view());
    const old = registry.getView("counter")!;
    handle.setView(undefined);
    expect(registry.views()).toEqual([]);
    expect(registry.has("counter")).toBe(true);
    handle.setView(view());
    expect(registry.getView("counter")!.registrationId).not.toBe(
      old.registrationId,
    );
    expect(registry.invokeView("counter", old.registrationId, "add")).toBe(
      false,
    );
  });
  it("old handles and old view IDs cannot touch a remounted logical ID", () => {
    const registry = new SpatialRegistry();
    const oldHandle = registry.register({ id: "counter" });
    oldHandle.setView(view());
    const old = registry.getView("counter")!;
    oldHandle.unregister();
    const next = registry.register({ id: "counter" });
    const invoke = vi.fn();
    next.setView(view(invoke));
    const snapshot = registry.views();
    oldHandle.setView(view());
    oldHandle.unregister();
    expect(registry.views()).toBe(snapshot);
    expect(registry.invokeView("counter", old.registrationId, "add")).toBe(
      false,
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(
      registry.invokeView("counter", snapshot[0]!.registrationId, "add"),
    ).toBe(true);
  });
  it("rejects duplicate item registrations and isolates workspace identities", () => {
    const a = new SpatialRegistry();
    const b = new SpatialRegistry();
    a.register({ id: "x" }).setView(view());
    b.register({ id: "x" }).setView(view());
    expect(() => a.register({ id: "x" })).toThrow(/already registered/);
    expect(a.getView("x")!.registrationId).not.toBe(
      b.getView("x")!.registrationId,
    );
    expect(b.invokeView("x", a.getView("x")!.registrationId, "add")).toBe(
      false,
    );
  });
  it("unregisters handlers even through the external registry API and cleans subscriptions", () => {
    const registry = new SpatialRegistry();
    const callback = vi.fn();
    const stop = registry.subscribeViews(callback);
    registry.register({ id: "x" }).setView(view());
    const record = registry.getView("x")!;
    registry.unregister("x");
    expect(callback).toHaveBeenCalledTimes(2);
    stop();
    stop();
    registry.register({ id: "y" }).setView(view());
    expect(callback).toHaveBeenCalledTimes(2);
    expect(registry.invokeView("x", record.registrationId, "add")).toBe(false);
  });
  it.each([
    { body: { kind: "html", html: "<script/>" } },
    { body: { kind: "value", label: "x", value: () => 1 } },
    { body: { kind: "bars", label: "x", values: [Infinity] } },
    { body: { kind: "bars", label: "x", values: new Array(2) } },
    { body: { kind: "swatch", color: "url(x)", caption: "x" } },
    { ...view(), actions: [{ id: "x", label: "x", invoke: 1 }] },
    { ...view(), actions: new Array(1) },
    { ...view(), actions: [view().actions![0], view().actions![0]] },
  ])("rejects invalid declarations atomically: %j", (bad) => {
    const registry = new SpatialRegistry();
    const handle = registry.register({ id: "x" });
    handle.setView(view());
    const snapshot = registry.views();
    expect(() => handle.setView(bad as SpatialViewBinding)).toThrow();
    expect(registry.views()).toBe(snapshot);
  });
});
