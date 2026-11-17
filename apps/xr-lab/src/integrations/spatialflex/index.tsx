import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialItems,
} from "@spatialflex/react";
import { useMemo } from "react";
import { useLabState, useLabStore, type RenderWidget } from "../../fixtures";
import { usePanels, usePresentation } from "../common/presentation";
import { hasXRView, XR_VIEWS } from "../common/scenario";
import type { IntegrationModule, LabIntegration } from "../contract";

/**
 * SpatialFlex: dashboard widgets are registered as SpatialItems, and the XR
 * items are the registered items that have an XR view.
 *
 * - Eligibility comes from the live SpatialFlex registry, not a static list.
 * - When a widget unmounts, its SpatialItem unregisters and its XR panel is
 *   removed, with no extra wiring.
 * - A panel action is forwarded only if its item is still registered, shown
 *   and declares that action.
 *
 * This is a mirror: the XR panel is a separate 3D view of the same logical
 * item and the same app state. The original DOM and React component stay in
 * the dashboard; nothing is moved into XR.
 */
const renderWidget: RenderWidget = (id, widget) => (
  <SpatialItem id={id} label={XR_VIEWS[id].label}>
    {widget}
  </SpatialItem>
);

function useSpatialFlexIntegration(): LabIntegration {
  const store = useLabStore();
  const state = useLabState((s) => s);
  const registered = useSpatialItems();

  const available = useMemo(
    () => registered.map((item) => item.id).filter(hasXRView),
    [registered],
  );
  const { presentation, show, hide, move, select } = usePresentation(available);
  const panels = usePanels(presentation, state);

  return {
    source: "SpatialFlex registry",
    items: available.map((id) => ({
      id,
      label: XR_VIEWS[id].label,
      shown: presentation.shown.includes(id),
      selected: presentation.selected === id,
    })),
    panels,
    show: (id) => hasXRView(id) && show(id),
    hide,
    move,
    onPanelButton(panelId, buttonId) {
      if (!hasXRView(panelId) || !available.includes(panelId)) return;
      if (!presentation.shown.includes(panelId)) return;
      XR_VIEWS[panelId].actions[buttonId]?.(store.actions, store.getState());
    },
    onPanelSelect: select,
    onPanelClose: (panelId) => void hide(panelId),
    renderWidget,
  };
}

export const spatialflexIntegration: IntegrationModule = {
  id: "spatialflex",
  Provider: SpatialWorkspace,
  useIntegration: useSpatialFlexIntegration,
};
