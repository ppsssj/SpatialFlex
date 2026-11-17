import { expect, it, vi } from "vitest";
import { ActionLedger } from "./authority";
import { envelope } from "./protocol";
import { ViewAuthorization } from "./viewAuthorization";

it("binds current registrations to publication revisions without changing protocol v1", () => {
  const auth = new ViewAuthorization();
  expect(auth.update({ item: "first" }, 0)).toBe(true);
  expect(auth.allows("item", 0)).toBe(true);
  expect(auth.update({ item: "first" }, 5)).toBe(false);
  expect(auth.update({}, 5)).toBe(true);
  expect(auth.update({ item: "second" }, 7)).toBe(true);
  expect(auth.allows("item", 7)).toBe(false);
  expect(auth.allows("item", 8)).toBe(true);
  const ledger = new ActionLedger();
  const onPanelButton = vi.fn();
  const request = {
    ...envelope("app", "view", 7, "connection"),
    type: "action-request" as const,
    itemId: "item",
    requestId: "stale",
    action: "add",
  };
  const panels = [
    {
      id: "item",
      title: "Item",
      position: [0, 0, 0] as const,
      body: { kind: "value" as const, label: "Count", value: "0" },
      buttons: [{ id: "add", label: "+1" }],
      selected: false,
    },
  ];
  const events = {
    onPanelButton,
    onPanelClose: vi.fn(),
    onPanelSelect: vi.fn(),
  };
  expect(
    ledger.execute(request, panels, events, auth.allows("item", 7)).status,
  ).toBe("denied");
  expect(onPanelButton).not.toHaveBeenCalled();
  expect(
    ledger.execute(
      { ...request, revision: 8, requestId: "fresh" },
      panels,
      events,
      auth.allows("item", 8),
    ).status,
  ).toBe("ok");
  expect(onPanelButton).toHaveBeenCalledTimes(1);
  // An already processed retry can retrieve its result, but never invokes again.
  ledger.execute(
    { ...request, revision: 8, requestId: "fresh" },
    panels,
    events,
    false,
  );
  expect(onPanelButton).toHaveBeenCalledTimes(1);
});
