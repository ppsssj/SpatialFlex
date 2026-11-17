import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialRegistry,
  useSpatialViews,
} from "@spatialflex/react";
import { useMemo } from "react";
import type { RenderWidget } from "../../fixtures";
import { usePresentation } from "../common/presentation";
import type { IntegrationModule, LabIntegration } from "../contract";

// Generic translation only: no widget IDs, application state or action table.
const renderWidget: RenderWidget = (id, widget, view) => (
  <SpatialItem id={id} xr={view}>
    {widget}
  </SpatialItem>
);
function useSpatialFlexIntegration(): LabIntegration {
  const registry = useSpatialRegistry();
  const views = useSpatialViews();
  const available = useMemo(() => views.map((v) => v.id), [views]);
  const { presentation, show, hide, move, select } = usePresentation(available);
  const panels = presentation.shown.flatMap((id) => {
    const index = views.findIndex((v) => v.id === id);
    const view = views[index];
    if (!view) return [];
    const [x, y, z] = slot(index);
    const [ox, oy, oz] = presentation.offsets[id] ?? [0, 0, 0];
    return [
      {
        id,
        title: view.title,
        position: [round(x + ox), round(y + oy), round(z + oz)] as const,
        body: view.body,
        buttons: view.actions,
        selected: presentation.selected === id,
      },
    ];
  });
  return {
    source: "SpatialFlex registry",
    items: views.map((v) => ({
      id: v.id,
      label: v.title,
      shown: presentation.shown.includes(v.id),
      selected: presentation.selected === v.id,
    })),
    panels,
    actionOwners: Object.fromEntries(
      views.map((v) => [v.id, v.registrationId]),
    ),
    show,
    hide,
    move,
    onPanelButton(id, action) {
      if (!presentation.shown.includes(id)) return;
      const view = views.find((v) => v.id === id);
      if (view) registry.invokeView(id, view.registrationId, action);
    },
    onPanelSelect: select,
    onPanelClose: (id) => void hide(id),
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
