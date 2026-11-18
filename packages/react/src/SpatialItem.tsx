import type {
  SpatialItemId,
  SpatialItemRegistration,
  SpatialSize,
  SpatialViewBinding,
} from "@spatialflex/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  /** @experimental Explicit XR mirror data and parent-owned semantic actions. */
  xr?: SpatialViewBinding | undefined;
}

/** The pointer interaction in progress, if any. Only one at a time. */
type Interaction =
  | { kind: "drag"; pointerId: number; dx: number; dy: number }
  | {
      kind: "resize";
      pointerId: number;
      startX: number;
      startY: number;
      width: number;
      height: number;
    };

/**
 * Registers its children as a SpatialItem of the enclosing workspace while
 * mounted, and presents them attached or detached.
 *
 * Detaching never remounts the children. The same elements stay in the same
 * place in the DOM and the React tree; the panel element only switches to
 * `position: fixed`. Its parent reserves the original size by default, or
 * generates no layout box under the Collapse policy. Local state, context, event handlers and focus are therefore
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
  xr,
}: SpatialItemProps) {
  const { registry, controller } = useWorkspace();
  const record = useSpatialItem(id);
  const capabilities = useMemo(
    () => ({ detachable, movable, resizable }),
    [detachable, movable, resizable],
  );
  const capabilitiesRef = useRef(capabilities);
  const registrationRef = useRef<SpatialItemRegistration | null>(null);
  const viewRef = useRef<SpatialViewBinding | undefined>(undefined);
  useLayoutEffect(() => {
    viewRef.current = xr
      ? { ...xr, title: xr.title ?? label ?? id }
      : undefined;
    if (registrationRef.current?.id === id)
      registrationRef.current.setView(viewRef.current);
  }, [xr, label, id]);
  const slotRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  // Size of the original, attached placement. Host-owned and separate from
  // the registry's panel size, so resizing the panel cannot change it.
  const [placeholder, setPlaceholder] = useState<SpatialSize | null>(null);
  const [sourcePolicy, setSourcePolicy] = useState<"placeholder" | "collapse">(
    "placeholder",
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
    try {
      registration.setView(viewRef.current);
    } catch (error) {
      registration.unregister();
      registrationRef.current = null;
      throw error;
    }
    const disconnect = controller.connect(id, {
      slot: slotRef.current!,
      panel: panelRef.current!,
      setPlaceholder,
      setSourcePolicy,
    });
    return () => {
      disconnect();
      registration.unregister();
      registrationRef.current = null;
    };
  }, [registry, controller, id]);

  const detached = record?.status === "detached";
  // Source visibility policy "reserved": hidden, footprint kept, still mounted.
  const reserved = !detached && record?.layout.visible === false;
  const position = record?.layout.position;
  const size = record?.layout.size;

  // An interaction cannot outlive the detached panel its handles belong to.
  useEffect(() => {
    if (!detached) interactionRef.current = null;
  }, [detached]);

  // Keep the panel inside the viewport when the window shrinks.
  useEffect(() => {
    if (!detached || !position || !(movable || (resizable && size))) return;
    const onResize = () => {
      if (movable) controller.move(id, position);
      if (resizable && size) controller.resize(id, size);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [controller, id, detached, movable, resizable, position, size]);

  const begin = (
    event: PointerEvent<HTMLElement>,
    interaction: Interaction,
  ) => {
    if (interactionRef.current || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    interactionRef.current = interaction;
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  // Shared by the panel bar and the resize handle: only the pointer that
  // started the current interaction is followed.
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (interaction?.pointerId !== event.pointerId) return;
    // The release was missed (for example outside the window): stop here
    // instead of following a pointer whose button is no longer pressed.
    if ((event.buttons & 1) === 0) {
      end(event);
      return;
    }
    if (interaction.kind === "drag") {
      controller.move(id, {
        x: event.clientX - interaction.dx,
        y: event.clientY - interaction.dy,
      });
    } else {
      controller.resize(id, {
        width: interaction.width + event.clientX - interaction.startX,
        height: interaction.height + event.clientY - interaction.startY,
      });
    }
  };

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (!movable || !position) return;
    if ((event.target as Element).closest("button")) return;
    begin(event, {
      kind: "drag",
      pointerId: event.pointerId,
      dx: event.clientX - position.x,
      dy: event.clientY - position.y,
    });
  };
  const startResize = (event: PointerEvent<HTMLElement>) => {
    const panel = panelRef.current;
    if (!resizable || !panel) return;
    const rect = panel.getBoundingClientRect();
    begin(event, {
      kind: "resize",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
    });
  };

  const status = detached ? "detached" : "attached";
  const slotStyle: CSSProperties | undefined =
    detached && sourcePolicy === "collapse"
      ? { display: "contents" }
      : detached && placeholder
        ? { width: placeholder.width, height: placeholder.height }
        : undefined;
  const panelStyle: CSSProperties | undefined = reserved
    ? { visibility: "hidden" }
    : detached
      ? {
          position: "fixed",
          left: position?.x ?? 0,
          top: position?.y ?? 0,
          // Natural size: the original width and automatic height.
          width: size?.width ?? placeholder?.width,
          height: size?.height,
          boxSizing: "border-box",
          overflow: size ? "hidden" : undefined,
        }
      : undefined;
  const title = label ?? id;

  // The element structure is identical in both states, and the panel bar and
  // resize handle are optional siblings around `children`, so `children` keep
  // their position in the React tree and are never remounted.
  return (
    <div
      ref={slotRef}
      data-spatialflex-item={id}
      data-status={status}
      data-source-policy={detached ? sourcePolicy : undefined}
      data-source-visibility={reserved ? "reserved" : undefined}
      style={slotStyle}
    >
      <div
        ref={panelRef}
        data-spatialflex-panel=""
        data-status={status}
        role={detached ? "dialog" : undefined}
        aria-label={detached ? title : undefined}
        style={panelStyle}
        // A reserved source cannot be focused or activated while hidden; its
        // DOM, React state and field values are kept for restoration.
        inert={reserved || undefined}
        aria-hidden={reserved || undefined}
        // While the panel is being dragged or resized, content that moves
        // under the original press point (such as an image) must not start a
        // native drag-and-drop, which would cancel the pointer stream.
        onDragStart={(event) => {
          if (interactionRef.current) event.preventDefault();
        }}
      >
        {detached ? (
          <div
            data-spatialflex-panel-bar=""
            data-movable={movable}
            style={
              movable ? { touchAction: "none", cursor: "move" } : undefined
            }
            onPointerDown={startDrag}
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
          >
            <span>{title}</span>
            <button type="button" onClick={() => controller.attach(id)}>
              Attach
            </button>
          </div>
        ) : null}
        {children}
        {detached && resizable ? (
          <div
            data-spatialflex-resize-handle=""
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 16,
              height: 16,
              cursor: "nwse-resize",
              touchAction: "none",
            }}
            onPointerDown={startResize}
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
          />
        ) : null}
      </div>
    </div>
  );
}
