import type {
  SpatialItemId,
  SpatialPosition,
  SpatialRegistry,
  SpatialSize,
} from "@spatialflex/core";

/**
 * Workspace-scoped detach/attach actions for the 2D DOM host.
 *
 * Positions are CSS pixels of the panel's top-left corner, relative to the
 * top-left corner of the viewport (the `position: fixed` containing block),
 * with x to the right and y down. Sizes are CSS pixels of the panel's border
 * box. Values are rounded and clamped so the panel stays inside the viewport
 * when it fits.
 */
export interface SpatialController {
  /**
   * Detaches the item. The original placement is measured for the
   * placeholder, and the panel opens at its last position and size, or over
   * the original placement at its natural size the first time.
   */
  detach(id: SpatialItemId): boolean;
  attach(id: SpatialItemId): boolean;
  move(id: SpatialItemId, position: SpatialPosition): boolean;
  /**
   * Resizes the detached panel, to at least {@link MIN_PANEL_SIZE} and at
   * most the space between its position and the viewport's bottom-right.
   */
  resize(id: SpatialItemId, size: SpatialSize): boolean;
}

/** Smallest panel size the controller allows when resizing. */
export const MIN_PANEL_SIZE: SpatialSize = Object.freeze({
  width: 160,
  height: 120,
});

export interface ItemHost {
  /** In-flow element that keeps the original placement. */
  readonly slot: HTMLElement;
  /** Element that becomes the floating panel when detached. */
  readonly panel: HTMLElement;
  /** Receives the measured original size, shown by the placeholder. */
  readonly setPlaceholder: (size: SpatialSize) => void;
}

export interface WorkspaceController extends SpatialController {
  /** Connects an item's DOM host. Returns a disconnect function. */
  connect(id: SpatialItemId, host: ItemHost): () => void;
}

export function createController(
  registry: SpatialRegistry,
): WorkspaceController {
  const hosts = new Map<SpatialItemId, ItemHost>();

  return {
    connect(id, host) {
      hosts.set(id, host);
      return () => {
        if (hosts.get(id) === host) hosts.delete(id);
      };
    },

    detach(id) {
      const record = registry.get(id);
      const host = hosts.get(id);
      if (!record || !host || record.status === "detached") {
        // Let the registry report unknown IDs or capability errors, or
        // detach without measurements when no element is connected.
        return registry.detach(id);
      }
      const rect = host.slot.getBoundingClientRect();
      const original = { width: rect.width, height: rect.height };
      const position = record.layout.position ?? { x: rect.left, y: rect.top };
      // The placeholder is host-owned and re-measured on every detach; it
      // never goes into the registry, so resizing cannot change it. Set it
      // first so no render sees the item detached without a placeholder.
      host.setPlaceholder(original);
      return registry.detach(id, {
        position: clampToViewport(position, record.layout.size ?? original),
      });
    },

    attach(id) {
      return registry.attach(id);
    },

    move(id, position) {
      return registry.move(id, clampToViewport(position, panelSize(id)));
    },

    resize(id, size) {
      const position = registry.get(id)?.layout.position ?? { x: 0, y: 0 };
      const { clientWidth, clientHeight } = document.documentElement;
      const fit = (value: number, min: number, max: number) =>
        Math.round(Math.max(min, Math.min(value, max)));
      return registry.resize(id, {
        width: fit(size.width, MIN_PANEL_SIZE.width, clientWidth - position.x),
        height: fit(
          size.height,
          MIN_PANEL_SIZE.height,
          clientHeight - position.y,
        ),
      });
    },
  };

  function panelSize(id: SpatialItemId): SpatialSize {
    const panel = hosts.get(id)?.panel;
    if (panel) return panel.getBoundingClientRect();
    return registry.get(id)?.layout.size ?? { width: 0, height: 0 };
  }
}

export function clampToViewport(
  position: SpatialPosition,
  size: SpatialSize,
): SpatialPosition {
  const { clientWidth, clientHeight } = document.documentElement;
  const clamp = (value: number, max: number) =>
    Math.round(Math.min(Math.max(value, 0), Math.max(max, 0)));
  return {
    x: clamp(position.x, clientWidth - size.width),
    y: clamp(position.y, clientHeight - size.height),
  };
}
