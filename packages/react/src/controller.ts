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
 * with x to the right and y down. Positions are rounded and clamped so the
 * panel stays inside the viewport when it fits.
 */
export interface SpatialController {
  /**
   * Detaches the item. Its original size is measured for the placeholder,
   * and the panel opens at its last position, or over the original
   * placement the first time.
   */
  detach(id: SpatialItemId): boolean;
  attach(id: SpatialItemId): boolean;
  move(id: SpatialItemId, position: SpatialPosition): boolean;
}

export interface ItemElements {
  /** In-flow element that keeps the original placement (the placeholder). */
  readonly slot: HTMLElement;
  /** Element that becomes the floating panel when detached. */
  readonly panel: HTMLElement;
}

export interface WorkspaceController extends SpatialController {
  /** Connects an item's DOM elements. Returns a disconnect function. */
  connect(id: SpatialItemId, elements: ItemElements): () => void;
}

export function createController(
  registry: SpatialRegistry,
): WorkspaceController {
  const elements = new Map<SpatialItemId, ItemElements>();

  return {
    connect(id, item) {
      elements.set(id, item);
      return () => {
        if (elements.get(id) === item) elements.delete(id);
      };
    },

    detach(id) {
      const record = registry.get(id);
      const slot = elements.get(id)?.slot;
      if (!record || !slot || record.status === "detached") {
        // Let the registry report unknown IDs or capability errors, or
        // detach without measurements when no element is connected.
        return registry.detach(id);
      }
      const rect = slot.getBoundingClientRect();
      const size = { width: rect.width, height: rect.height };
      const position = record.layout.position ?? { x: rect.left, y: rect.top };
      return registry.detach(id, {
        position: clampToViewport(position, size),
        size,
      });
    },

    attach(id) {
      return registry.attach(id);
    },

    move(id, position) {
      const panel = elements.get(id)?.panel;
      const size = panel
        ? panel.getBoundingClientRect()
        : (registry.get(id)?.layout.size ?? { width: 0, height: 0 });
      return registry.move(id, clampToViewport(position, size));
    },
  };
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
