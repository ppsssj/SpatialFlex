// @vitest-environment jsdom
import { SpatialItem } from "@spatialflex/react";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { spatialflexIntegration } from "../integrations/spatialflex";
import type { LabIntegration } from "../integrations/contract";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it("discovers a component never named by the adapter; rejects stale closures after same-ID remount", () => {
  let lab: LabIntegration;
  function Capture() {
    const current = spatialflexIntegration.useIntegration();
    useEffect(() => {
      lab = current;
    });
    return null;
  }
  function UnknownWidget() {
    const [count, setCount] = useState(0);
    return (
      <SpatialItem
        id="not-in-the-application-fixture"
        xr={{
          title: "Custom",
          body: { kind: "value", label: "Local", value: String(count) },
          actions: [
            {
              id: "custom-add",
              label: "Add",
              invoke: () => setCount((n) => n + 1),
            },
          ],
        }}
      >
        <output>{count}</output>
      </SpatialItem>
    );
  }
  const { Provider } = spatialflexIntegration;
  const container = document.createElement("div");
  const root = createRoot(container);
  const ui = (mounted: boolean) => (
    <Provider>
      <Capture />
      {mounted && <UnknownWidget />}
    </Provider>
  );
  try {
    act(() => root.render(ui(true)));
    expect(lab!.items.map((i) => i.id)).toEqual([
      "not-in-the-application-fixture",
    ]);
    act(() => {
      lab!.show("not-in-the-application-fixture");
    });
    const old = lab!;
    act(() =>
      old.onPanelButton("not-in-the-application-fixture", "custom-add"),
    );
    expect(container.textContent).toBe("1");
    act(() => root.render(ui(false)));
    expect(lab!.items).toEqual([]);
    act(() => root.render(ui(true)));
    act(() => {
      lab!.show("not-in-the-application-fixture");
    });
    act(() =>
      old.onPanelButton("not-in-the-application-fixture", "custom-add"),
    );
    expect(container.textContent).toBe("0");
    act(() =>
      lab!.onPanelButton("not-in-the-application-fixture", "undeclared"),
    );
    expect(container.textContent).toBe("0");
    act(() =>
      lab!.onPanelButton("not-in-the-application-fixture", "custom-add"),
    );
    expect(container.textContent).toBe("1");
  } finally {
    act(() => root.unmount());
  }
});
