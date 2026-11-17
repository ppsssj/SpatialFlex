import { useMemo } from "react";
import type { HostPanel } from "../../contracts/xrHost";
import type { LabState, WidgetId } from "../../fixtures";
import { XR_VIEWS } from "../common/scenario";
import type { Presentation } from "../common/presentation";
/** Host panels for the shown items, built from the current app state. */
export function usePanels(
  presentation: Presentation,
  state: LabState,
): readonly HostPanel[] {
  return useMemo(
    () =>
      presentation.shown.map((id) => {
        const view = XR_VIEWS[id as WidgetId];
        const [ox, oy, oz] = presentation.offsets[id] ?? [0, 0, 0];
        const [x, y, z] = view.position;
        return {
          id,
          title: view.label,
          position: [round(x + ox), round(y + oy), round(z + oz)] as const,
          body: view.body(state),
          buttons: view.buttons,
          selected: presentation.selected === id,
        };
      }),
    [presentation, state],
  );
}

const round = (value: number) => Math.round(value * 1000) / 1000;
