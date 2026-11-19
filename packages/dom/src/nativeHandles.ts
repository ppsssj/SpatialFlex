import type {
  ManipulationMode,
  NudgeDirection,
  SpatialRay,
} from "@spatialflex/core";
import { trackManipulationPointer } from "./pointer.js";

/**
 * What Native DOM handles drive: item-addressed manipulation, as
 * `ItemManipulator` (@spatialflex/core) provides it.
 */
export interface NativeHandleManipulation {
  begin(
    itemId: string,
    mode: ManipulationMode,
    pointerId: number,
    ray: SpatialRay,
  ): number | null;
  update(token: number, ray: SpatialRay): void;
  end(token: number, commit: boolean): void;
  nudge(
    itemId: string,
    mode: ManipulationMode,
    direction: NudgeDirection,
    large: boolean,
  ): number | null;
  endKeyboard(itemId: string, commit: boolean): boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): {
    readonly active: {
      readonly itemId: string;
      readonly mode: ManipulationMode;
    } | null;
    readonly selected: string | null;
  };
}

/** A natively extracted element and the item it presents. */
export interface NativeHandleElement {
  readonly id: string;
  readonly element: HTMLElement;
}

export interface NativeHandleBinding {
  readonly manipulation: NativeHandleManipulation;
  readonly elements: readonly NativeHandleElement[];
  /** Removes every listener and feedback attribute; cancels a drag. */
  dispose(): void;
}

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
 * Binds pointer and keyboard input to the manipulation handles that
 * `SpatialItem` renders on natively extracted elements
 * (`data-spatialflex-handle`). A pointer becomes a world ray through
 * `rayAt` (the last rendered camera), and keyboard steps on a focused
 * handle become `nudge` steps. Controls inside a handle keep their own
 * input. Elements are never moved, cloned or re-rendered: only one
 * delegated listener per type and two feedback data attributes are added
 * (`data-manipulation-selected`, `data-manipulating`), and `dispose`
 * removes all of them.
 */
export function bindNativeHandles(
  manipulation: NativeHandleManipulation,
  elements: readonly NativeHandleElement[],
  rayAt: (clientX: number, clientY: number) => SpatialRay | null,
): NativeHandleBinding {
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
        ? { handle, mode: mode as ManipulationMode }
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
          manipulation.nudge(id, found.mode, direction, event.shiftKey) !== null
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
  return {
    manipulation,
    elements,
    dispose() {
      drag?.();
      unsubscribe();
      for (const cleanup of cleanups) cleanup();
    },
  };
}
