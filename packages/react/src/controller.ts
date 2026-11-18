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
   * Native DOM extraction: detaches the original mounted element (the same
   * node and React instance) into an externally composited placement. The
   * source keeps its footprint (`placeholder`) or reflows (`collapse`), as
   * for a Move. Positioning belongs to the compositor that owns the
   * placement (see {@link SpatialController.nativeElement}); `attach`
   * restores the original layout.
   */
  extractNative(id: SpatialItemId, source: "placeholder" | "collapse"): boolean;
  /**
   * Where a detached item is placed: `viewport` (P0 floating panel) or
   * `external` (Native DOM extraction). `null` when attached or unknown.
   */
  placement(id: SpatialItemId): ItemPlacement | null;
  /**
   * The original panel element of a natively extracted item, for its
   * compositor to position. `null` for any other item.
   */
  nativeElement(id: SpatialItemId): HTMLElement | null;
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
  readonly setPlacement: (placement: ItemPlacement) => void;
}

/** Who positions a detached panel. */
export type ItemPlacement = "viewport" | "external";

export interface WorkspaceController extends SpatialController {
  /** Connects an item's DOM host. Returns a disconnect function. */
  connect(id: SpatialItemId, host: ItemHost): () => void;
}

export function createController(
  registry: SpatialRegistry,
): WorkspaceController {
  const hosts = new Map<SpatialItemId, ItemHost>();
  const external = new Set<SpatialItemId>();
  const placementOf = (id: SpatialItemId): ItemPlacement | null => {
    if (registry.get(id)?.status !== "detached") return null;
    return external.has(id) ? "external" : "viewport";
  };
  const setPlacementOf = (id: SpatialItemId, placement: ItemPlacement) => {
    if (placement === "external") external.add(id);
    else external.delete(id);
    hosts.get(id)?.setPlacement(placement);
  };

  return {
    connect(id, host) {
      hosts.set(id, host);
      return () => {
        if (hosts.get(id) !== host) return;
        hosts.delete(id);
        external.delete(id);
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
      // An already detached item (including a native extraction) keeps its
      // placement; the registry reports it unchanged.
      if (record?.status !== "detached") setPlacementOf(id, "viewport");
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
      const attached = registry.attach(id);
      if (attached) setPlacementOf(id, "viewport");
      return attached;
    },

    extractNative(id, source) {
      if (source !== "placeholder" && source !== "collapse")
        throw new SpatialFlexError(
          "UNSUPPORTED_STRATEGY",
          "Native DOM extraction reserves (placeholder) or collapses the source.",
        );
      const record = registry.get(id);
      const host = hosts.get(id);
      // Let the registry report unknown ids and capability errors.
      if (!record || !record.capabilities.detachable)
        return registry.detach(id);
      if (!host || record.status === "detached") return false;
      host.setSourcePolicy(source);
      // Layout size, unaffected by transformed ancestors (unlike
      // getBoundingClientRect inside a composited surface); fractional, so
      // the moved content keeps exactly its original width.
      const style = getComputedStyle(host.slot);
      host.setPlaceholder({
        width: parseFloat(style.width) || host.slot.offsetWidth,
        height: parseFloat(style.height) || host.slot.offsetHeight,
      });
      setPlacementOf(id, "external");
      return registry.detach(id);
    },

    placement: placementOf,

    nativeElement(id) {
      if (placementOf(id) !== "external") return null;
      return hosts.get(id)?.panel ?? null;
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
