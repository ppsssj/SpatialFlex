import { useCallback, useMemo, useState } from "react";
import type { HostPanel, Vec3 } from "../../host";
import type { LabState, WidgetId } from "../../fixtures";
import { XR_VIEWS } from "./scenario";

/**
 * XR presentation state shared by the integrations: which items are shown,
 * their position offsets and the selection. Presentation only; it never
 * holds domain data.
 */
interface Presentation {
  readonly shown: readonly WidgetId[];
  readonly offsets: Readonly<Partial<Record<WidgetId, Vec3>>>;
  readonly selected: WidgetId | null;
}

const EMPTY: Presentation = { shown: [], offsets: {}, selected: null };

/**
 * @param available Items that may currently be shown. Shown items that stop
 *   being available are removed, together with their offset and selection.
 */
export function usePresentation(available: readonly WidgetId[]) {
  const [presentation, setPresentation] = useState(EMPTY);
  const [seenAvailable, setSeenAvailable] = useState(available);

  // Clean up items that disappeared, while rendering (React's pattern for
  // adjusting state when an input changes), so no frame shows a stale panel.
  if (available !== seenAvailable) {
    setSeenAvailable(available);
    const pruned = prune(presentation, available);
    if (pruned !== presentation) setPresentation(pruned);
  }

  const show = useCallback(
    (id: WidgetId) => {
      if (!available.includes(id)) return false;
      setPresentation((current) =>
        current.shown.includes(id)
          ? current
          : { ...current, shown: [...current.shown, id] },
      );
      return true;
    },
    [available],
  );

  const hide = useCallback(
    (id: string) => {
      if (!presentation.shown.includes(id as WidgetId)) return false;
      setPresentation((current) => {
        const offsets = { ...current.offsets };
        delete offsets[id as WidgetId];
        return {
          shown: current.shown.filter((shownId) => shownId !== id),
          offsets,
          selected: current.selected === id ? null : current.selected,
        };
      });
      return true;
    },
    [presentation.shown],
  );

  const move = useCallback(
    (id: string, [dx, dy, dz]: Vec3) => {
      if (!presentation.shown.includes(id as WidgetId)) return false;
      setPresentation((current) => {
        const [x, y, z] = current.offsets[id as WidgetId] ?? [0, 0, 0];
        return {
          ...current,
          offsets: {
            ...current.offsets,
            [id]: [round(x + dx), round(y + dy), round(z + dz)],
          },
        };
      });
      return true;
    },
    [presentation.shown],
  );

  const select = useCallback(
    (id: string) => {
      if (!presentation.shown.includes(id as WidgetId)) return;
      setPresentation((current) => ({ ...current, selected: id as WidgetId }));
    },
    [presentation.shown],
  );

  return { presentation, show, hide, move, select };
}

function prune(
  presentation: Presentation,
  available: readonly WidgetId[],
): Presentation {
  const shown = presentation.shown.filter((id) => available.includes(id));
  if (shown.length === presentation.shown.length) return presentation;
  const offsets = { ...presentation.offsets };
  for (const id of presentation.shown)
    if (!shown.includes(id)) delete offsets[id];
  const selected =
    presentation.selected && shown.includes(presentation.selected)
      ? presentation.selected
      : null;
  return { shown, offsets, selected };
}

/** Host panels for the shown items, built from the current app state. */
export function usePanels(
  presentation: Presentation,
  state: LabState,
): readonly HostPanel[] {
  return useMemo(
    () =>
      presentation.shown.map((id) => {
        const view = XR_VIEWS[id];
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
