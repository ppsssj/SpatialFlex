import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialRegistry,
  useSpatialViews,
  useSpatialController,
  useSpatialItems,
} from "@spatialflex/react";
import {
  assertDetachmentStrategy,
  SpatialFlexError,
  XR_MIRROR_STRATEGY,
  validateDetachmentStrategy,
} from "@spatialflex/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RenderWidget } from "../../fixtures";
import { usePresentation } from "../common/presentation";
import type { IntegrationModule, LabIntegration } from "../contract";

// Generic translation only: no widget IDs, application state or action table.
const renderWidget: RenderWidget = (id, widget, view) => (
  <SpatialItem id={id} xr={view} detachable movable resizable>
    {widget}
  </SpatialItem>
);
function useSpatialFlexIntegration(): LabIntegration {
  const registry = useSpatialRegistry();
  const controller = useSpatialController();
  const records = useSpatialItems();
  const views = useSpatialViews();
  // Presentation membership follows the registration, not its reusable item ID.
  const available = useMemo(() => views.map((v) => v.registrationId), [views]);
  const { presentation, show, hide, move, select } = usePresentation(available);
  const instances = useRef(new Map<string, string>());
  const generation = useRef(0);
  const [capturedInstances, setInstances] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const publishInstances = () => setInstances(new Map(instances.current));
  useEffect(() => {
    const unsubscribe = registry.subscribeViews(() => {
      const current = new Set(registry.views().map((v) => v.registrationId));
      let changed = false;
      for (const id of instances.current.keys()) {
        if (!current.has(id)) {
          instances.current.delete(id);
          changed = true;
        }
      }
      if (changed) setInstances(new Map(instances.current));
    });
    const activeInstances = instances.current;
    return () => {
      unsubscribe();
      activeInstances.clear();
    };
  }, [registry]);
  const panels = presentation.shown.flatMap((registrationId) => {
    const index = views.findIndex((v) => v.registrationId === registrationId);
    const view = views[index];
    if (!view) return [];
    const id = view.id;
    const [x, y, z] = slot(index);
    const [ox, oy, oz] = presentation.offsets[registrationId] ?? [0, 0, 0];
    return [
      {
        id,
        title: view.title,
        position: [round(x + ox), round(y + oy), round(z + oz)] as const,
        body: view.body,
        buttons: view.actions,
        selected: presentation.selected === registrationId,
      },
    ];
  });
  // Host callbacks are bound to the presentation that actually drew them.
  // A stale close/select must not affect a later instance either.
  const currentPresentation = (id: string) => {
    const view = views.find((v) => v.id === id);
    if (!view || !presentation.shown.includes(view.registrationId)) return;
    const instance = capturedInstances.get(view.registrationId);
    if (
      instance &&
      instance === instances.current.get(view.registrationId) &&
      registry.getView(id)?.registrationId === view.registrationId
    )
      return view;
  };
  return {
    source: "SpatialFlex registry",
    validateStrategy: validateDetachmentStrategy,
    items: views.map((v) => ({
      id: v.id,
      label: v.title,
      shown: presentation.shown.includes(v.registrationId),
      selected: presentation.selected === v.registrationId,
      detached: records.find((r) => r.id === v.id)?.status === "detached",
      ...(capturedInstances.get(v.registrationId) && {
        presentationId: capturedInstances.get(v.registrationId)!,
      }),
    })),
    panels,
    actionOwners: Object.fromEntries(
      views
        .filter((v) => presentation.shown.includes(v.registrationId))
        .map((v) => [
          v.id,
          `${v.registrationId}/${capturedInstances.get(v.registrationId)}`,
        ]),
    ),
    show(id, options = XR_MIRROR_STRATEGY) {
      const strategy = assertDetachmentStrategy(options);
      if (strategy.mode !== "mirror")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "XR show accepts Mirror + Visible + XR only.",
        );
      const view = registry.getView(id);
      if (!view || !available.includes(view.registrationId)) return false;
      controller.attach(id);
      if (!instances.current.has(view.registrationId)) {
        instances.current.set(
          view.registrationId,
          `presentation-${++generation.current}`,
        );
        publishInstances();
      }
      return show(view.registrationId);
    },
    hide(id) {
      const view = registry.getView(id);
      if (!view) return false;
      instances.current.delete(view.registrationId);
      publishInstances();
      return hide(view.registrationId);
    },
    detach(id, options) {
      const strategy = assertDetachmentStrategy(options);
      if (strategy.mode !== "move")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "DOM detach accepts Move strategies only.",
        );
      // Validate/carry out the move before removing a valid existing mirror.
      const result = controller.detach(id, strategy);
      const view = registry.getView(id);
      if (view) {
        instances.current.delete(view.registrationId);
        publishInstances();
        hide(view.registrationId);
      }
      return result;
    },
    attach: controller.attach,
    move(id, delta) {
      const view = registry.getView(id);
      return view ? move(view.registrationId, delta) : false;
    },
    onPanelButton(id, action) {
      const view = currentPresentation(id);
      if (view) registry.invokeView(id, view.registrationId, action);
    },
    onPanelSelect(id) {
      const view = currentPresentation(id);
      if (view) select(view.registrationId);
    },
    onPanelClose(id) {
      const view = currentPresentation(id);
      if (view) {
        instances.current.delete(view.registrationId);
        publishInstances();
        hide(view.registrationId);
      }
    },
    renderWidget,
  };
}

// Renderer-owned placement; independent of component identity or domain state.
const slot = (index: number): readonly [number, number, number] => {
  if (index === 0) return [0, 1.4, -1.2];
  if (index === 1) return [-0.75, 1.4, -1];
  if (index === 2) return [0.75, 1.4, -1];
  return [(((index - 3) % 3) - 1) * 0.75, 2, -1.3];
};
const round = (value: number) => Math.round(value * 1000) / 1000;
export const spatialflexIntegration: IntegrationModule = {
  id: "spatialflex",
  Provider: SpatialWorkspace,
  useIntegration: useSpatialFlexIntegration,
};
