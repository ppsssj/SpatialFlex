import type {
  DetachmentStrategy,
  SourceVisibility,
  SpatialItemId,
  SpatialPosition,
  SpatialRegistry,
  SpatialSize,
} from "@spatialflex/core";
import {
  assertDetachmentStrategy,
  DEFAULT_DETACHMENT_STRATEGY,
  SpatialFlexError,
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
   * default placeholder (or released by Collapse), and the panel opens at its last position and size, or over
   * the original placement at its natural size the first time.
   */
  detach(id: SpatialItemId, strategy?: DetachmentStrategy): boolean;
  attach(id: SpatialItemId): boolean;
  move(id: SpatialItemId, position: SpatialPosition): boolean;
  /**
   * Resizes the detached panel, to at least {@link MIN_PANEL_SIZE} and at
   * most the space between its position and the viewport's bottom-right.
   */
  resize(id: SpatialItemId, size: SpatialSize): boolean;
  /**
   * Sets the visual policy of an attached item's original placement while
   * another presentation (such as a live XR mirror) represents it. The item
   * stays mounted; `reserved` hides it and keeps its footprint.
   */
  setSourceVisibility(id: SpatialItemId, visibility: SourceVisibility): boolean;
  /**
   * The in-flow element of a currently registered and connected item, for
   * read-only geometry (for example a selection outline). `null` for any
   * other id: only registered items are discoverable.
   */
  sourceElement(id: SpatialItemId): HTMLElement | null;
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
  readonly setSourcePolicy: (source: "placeholder" | "collapse") => void;
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

    detach(id, options = DEFAULT_DETACHMENT_STRATEGY) {
      const strategy = assertDetachmentStrategy(options);
      if (strategy.mode !== "move")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "The DOM controller accepts Move strategies only; show a mirror through an XR adapter.",
        );
      const record = registry.get(id);
      const host = hosts.get(id);
      // Validate capabilities before changing the host's source policy.
      if (record && !record.capabilities.detachable) return registry.detach(id);
      host?.setSourcePolicy(strategy.source);
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

    setSourceVisibility(id, visibility) {
      return registry.setSourceVisibility(id, visibility);
    },

    sourceElement(id) {
      return registry.has(id) ? (hosts.get(id)?.slot ?? null) : null;
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
