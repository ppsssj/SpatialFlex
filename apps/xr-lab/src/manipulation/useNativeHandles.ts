import { bindNativeHandles, type NativeHandleBinding } from "@spatialflex/dom";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { HostRay } from "../contracts/xrHost";
import type { LabManipulation } from "../integrations/contract";

/**
 * Binds pointer and keyboard input (through the SDK's `bindNativeHandles`,
 * `@spatialflex/dom`) to the manipulation handles that the SDK
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
  const bound = useRef<NativeHandleBinding | null>(null);
  const rayRef = useRef(rayAt);
  useLayoutEffect(() => {
    rayRef.current = rayAt;
  });
  // Bound to the resolved elements, not only to their ids: an element that
  // is replaced while the id list stays the same (a remounted component
  // extracted again in the same commit) is unbound and the new one bound.
  // Runs after every render; rebinds only when something changed.
  useEffect(() => {
    const elements = manipulation
      ? nativeIds.flatMap((id) => {
          const element = resolveNative(id);
          return element ? [{ id, element }] : [];
        })
      : [];
    const current = bound.current;
    if (
      current &&
      current.manipulation === manipulation &&
      current.elements.length === elements.length &&
      current.elements.every(
        (e, i) =>
          e.id === elements[i]!.id && e.element === elements[i]!.element,
      )
    )
      return;
    current?.dispose();
    bound.current = manipulation
      ? bindNativeHandles(manipulation, elements, (x, y) =>
          rayRef.current(x, y),
        )
      : null;
  });
  useEffect(
    () => () => {
      bound.current?.dispose();
      bound.current = null;
    },
    [],
  );
}
