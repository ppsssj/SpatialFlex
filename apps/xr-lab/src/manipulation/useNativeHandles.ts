import { useEffect } from "react";
import type { HostManipulationMode, HostRay } from "../contracts/xrHost";
import { trackManipulationPointer } from "../hosts/shared/manipulationPointer";
import type { LabManipulation, NudgeDirection } from "../integrations/contract";

const KEYS: Readonly<Record<string, NudgeDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
const MODES = new Set(["translate", "rotate", "resize"]);
/** Controls inside a handle keep their own clicks (the bar's Attach button). */
const CONTROLS =
  "button, input, select, textarea, a, [contenteditable], [role=button]";

/**
 * Binds pointer and keyboard input to the manipulation handles that the SDK
 * renders on natively extracted elements (`data-spatialflex-handle`). The
 * pointer becomes a world ray through the compositor's last camera frame,
 * and the same shared pointer lifecycle as the 3D hosts feeds the same
 * manipulation controller. Elements are never moved, cloned or re-rendered
 * here: only listeners and two feedback data attributes are added, and all
 * are removed again.
 */
export function useNativeHandles(
  manipulation: LabManipulation | undefined,
  nativeIds: readonly string[],
  resolveNative: (id: string) => HTMLElement | null,
  rayAt: (clientX: number, clientY: number) => HostRay | null,
) {
  const key = JSON.stringify(nativeIds);
  useEffect(() => {
    if (!manipulation) return;
    const elements = (JSON.parse(key) as string[]).flatMap((id) => {
      const element = resolveNative(id);
      return element ? [{ id, element }] : [];
    });
    let drag: (() => void) | null = null;
    const cleanups: (() => void)[] = [];
    for (const { id, element } of elements) {
      const handleOf = (target: EventTarget | null) => {
        if (!(target instanceof Element)) return null;
        const handle = target.closest<HTMLElement>("[data-spatialflex-handle]");
        if (!handle || !element.contains(handle)) return null;
        const control = target.closest(CONTROLS);
        if (control && control !== handle && handle.contains(control))
          return null;
        const mode = handle.dataset.spatialflexHandle!;
        return MODES.has(mode)
          ? { handle, mode: mode as HostManipulationMode }
          : null;
      };
      const down = (event: PointerEvent) => {
        const found = handleOf(event.target);
        if (!found || event.button !== 0 || drag) return;
        const ray = rayAt(event.clientX, event.clientY);
        if (!ray) return;
        const token = manipulation.begin(id, found.mode, event.pointerId, ray);
        if (token === null) return;
        // No text selection or native drag while manipulating.
        event.preventDefault();
        event.stopPropagation();
        if (found.handle.tabIndex >= 0)
          found.handle.focus({ preventScroll: true });
        drag = trackManipulationPointer({
          token,
          pointerId: event.pointerId,
          toRay: rayAt,
          manipulation,
          onRelease: () => {
            drag = null;
          },
        });
      };
      const keydown = (event: KeyboardEvent) => {
        const found = handleOf(event.target);
        if (!found || found.handle !== event.target) return;
        const direction = KEYS[event.key];
        if (direction) {
          if (
            manipulation.nudge(id, found.mode, direction, event.shiftKey) !==
            null
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        } else if (event.key === "Escape") {
          if (manipulation.endKeyboard(id, false)) {
            event.preventDefault();
            event.stopPropagation();
          }
        } else if (event.key === "Enter") {
          manipulation.endKeyboard(id, true);
          event.preventDefault();
        }
      };
      // Leaving the panel's handles commits its keyboard steps.
      const focusout = (event: FocusEvent) => {
        if (!element.contains(event.relatedTarget as Node | null))
          manipulation.endKeyboard(id, true);
      };
      element.addEventListener("pointerdown", down);
      element.addEventListener("keydown", keydown);
      element.addEventListener("focusout", focusout);
      cleanups.push(() => {
        element.removeEventListener("pointerdown", down);
        element.removeEventListener("keydown", keydown);
        element.removeEventListener("focusout", focusout);
        delete element.dataset.manipulationSelected;
        delete element.dataset.manipulating;
      });
    }
    // Feedback: the selected panel and the handle in use.
    const paint = () => {
      const { active, selected } = manipulation.getSnapshot();
      for (const { id, element } of elements) {
        if (selected === id) element.dataset.manipulationSelected = "";
        else delete element.dataset.manipulationSelected;
        if (active?.itemId === id) element.dataset.manipulating = active.mode;
        else delete element.dataset.manipulating;
      }
    };
    paint();
    const unsubscribe = manipulation.subscribe(paint);
    return () => {
      drag?.();
      unsubscribe();
      for (const cleanup of cleanups) cleanup();
    };
    // The resolver and ray source may change identity every render; the
    // set of natively extracted ids decides what is bound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manipulation, key]);
}
