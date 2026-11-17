import type { SpatialItemId, SpatialItemRegistration } from "@spatialflex/core";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useWorkspace } from "./context";
import { useSpatialItem } from "./hooks";

export interface SpatialItemProps {
  /** Stable ID, unique within the workspace. */
  id: SpatialItemId;
  detachable?: boolean;
  movable?: boolean;
  resizable?: boolean;
  /** Title of the detached panel. Defaults to `id`. */
  label?: string;
  children?: ReactNode;
}

/**
 * Registers its children as a SpatialItem of the enclosing workspace while
 * mounted, and presents them attached or detached.
 *
 * Detaching never remounts the children. The same elements stay in the same
 * place in the DOM and the React tree; the panel element only switches to
 * `position: fixed`, and its in-flow parent keeps the original size as a
 * placeholder. Local state, context, event handlers and focus are therefore
 * preserved. See the README for the limits of this approach.
 *
 * A duplicate ID throws a `DUPLICATE_ITEM_ID` error from the commit phase,
 * which the nearest error boundary receives.
 */
export function SpatialItem({
  id,
  detachable = false,
  movable = false,
  resizable = false,
  label,
  children,
}: SpatialItemProps) {
  const { registry, controller } = useWorkspace();
  const record = useSpatialItem(id);
  const capabilities = useMemo(
    () => ({ detachable, movable, resizable }),
    [detachable, movable, resizable],
  );
  const capabilitiesRef = useRef(capabilities);
  const registrationRef = useRef<SpatialItemRegistration | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number } | null>(
    null,
  );

  // Declared before the registration effect so that, when the ID and the
  // capabilities change together, the new registration reads fresh values.
  useEffect(() => {
    capabilitiesRef.current = capabilities;
    registrationRef.current?.update(capabilities);
  }, [capabilities]);

  useEffect(() => {
    const registration = registry.register({
      id,
      capabilities: capabilitiesRef.current,
    });
    registrationRef.current = registration;
    const disconnect = controller.connect(id, {
      slot: slotRef.current!,
      panel: panelRef.current!,
    });
    return () => {
      disconnect();
      registration.unregister();
      registrationRef.current = null;
    };
  }, [registry, controller, id]);

  const detached = record?.status === "detached";
  const position = record?.layout.position;
  const size = record?.layout.size;

  // Keep a movable panel inside the viewport when the window shrinks.
  useEffect(() => {
    if (!detached || !movable || !position) return;
    const onResize = () => controller.move(id, position);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [controller, id, detached, movable, position]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!movable || !position || event.button !== 0) return;
    if ((event.target as Element).closest("button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    controller.move(id, {
      x: event.clientX - drag.dx,
      y: event.clientY - drag.dy,
    });
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const status = detached ? "detached" : "attached";
  const slotStyle: CSSProperties | undefined =
    detached && size ? { width: size.width, height: size.height } : undefined;
  const panelStyle: CSSProperties | undefined = detached
    ? {
        position: "fixed",
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        width: size?.width,
        boxSizing: "border-box",
      }
    : undefined;
  const title = label ?? id;

  // The element structure is identical in both states, and the panel bar is
  // a sibling that precedes `children`, so `children` keep their position in
  // the React tree and are never remounted.
  return (
    <div
      ref={slotRef}
      data-spatialflex-item={id}
      data-status={status}
      style={slotStyle}
    >
      <div
        ref={panelRef}
        data-spatialflex-panel=""
        data-status={status}
        role={detached ? "dialog" : undefined}
        aria-label={detached ? title : undefined}
        style={panelStyle}
      >
        {detached ? (
          <div
            data-spatialflex-panel-bar=""
            data-movable={movable}
            style={
              movable ? { touchAction: "none", cursor: "move" } : undefined
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span>{title}</span>
            <button type="button" onClick={() => controller.attach(id)}>
              Attach
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
