import { Fragment, useMemo } from "react";
import {
  useLabState,
  useLabStore,
  WIDGETS,
  type WidgetId,
} from "../../fixtures";
import { usePresentation } from "../common/presentation";
import { usePanels } from "./panels";
import { hasXRView, XR_VIEWS } from "../common/scenario";
import type { IntegrationModule, LabIntegration } from "../contract";

/**
 * Baseline: an ordinary, hand-written integration without SpatialFlex.
 *
 * It keeps a static list of the widgets that have an XR view and derives
 * their availability from app state by hand (the image widget can be
 * unmounted). Panel button presses call the app's actions directly.
 */
const ALL_ITEMS: readonly WidgetId[] = [
  WIDGETS.counter,
  WIDGETS.chart,
  WIDGETS.image,
  WIDGETS.thermostat,
];

function useBaselineIntegration(): LabIntegration {
  const store = useLabStore();
  const state = useLabState((s) => s);

  // Manual lifecycle wiring: the integration must know that the image widget
  // exists only while `imageMounted` is true.
  const available = useMemo(
    () =>
      ALL_ITEMS.filter(
        (id) =>
          (id !== WIDGETS.image || state.imageMounted) &&
          (id !== WIDGETS.thermostat || state.thermostatMounted),
      ),
    [state.imageMounted, state.thermostatMounted],
  );
  const { presentation, show, hide, move, select } = usePresentation(available);
  const panels = usePanels(presentation, state);

  return {
    source: "static list in the baseline integration",
    items: available.map((id) => ({
      id,
      label: XR_VIEWS[id].label,
      shown: presentation.shown.includes(id),
      selected: presentation.selected === id,
    })),
    panels,
    actionOwners: {
      [WIDGETS.counter]: "counter",
      [WIDGETS.chart]: "chart",
      [WIDGETS.image]: String(state.imageEpoch),
      [WIDGETS.thermostat]: String(state.thermostatEpoch),
    },
    show: (id) => hasXRView(id) && show(id),
    hide,
    move,
    onPanelButton(panelId, buttonId) {
      const current = store.getState();
      if (
        panelId === WIDGETS.image &&
        (!current.imageMounted || current.imageEpoch !== state.imageEpoch)
      )
        return;
      if (
        panelId === WIDGETS.thermostat &&
        (!current.thermostatMounted ||
          current.thermostatEpoch !== state.thermostatEpoch)
      )
        return;
      if (!hasXRView(panelId) || !available.includes(panelId)) return;
      if (!presentation.shown.includes(panelId)) return;
      XR_VIEWS[panelId].actions[buttonId]?.(store.actions, store.getState());
    },
    onPanelSelect: select,
    onPanelClose: (panelId) => void hide(panelId),
  };
}

export const baselineIntegration: IntegrationModule = {
  id: "baseline",
  Provider: Fragment,
  useIntegration: useBaselineIntegration,
};
