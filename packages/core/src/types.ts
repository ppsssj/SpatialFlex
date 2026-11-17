/**
 * Stable, developer-defined identifier of a logical UI component.
 *
 * It names the component, not where it is shown: the same ID is kept while
 * the item moves between hosts or layouts.
 */
export type SpatialItemId = string;

/** Which user operations a SpatialItem allows. All default to `false`. */
export interface SpatialItemCapabilities {
  readonly detachable: boolean;
  readonly movable: boolean;
  readonly resizable: boolean;
}

/**
 * Where an item is presented. `attached` items render in their original
 * layout; `detached` items render as an independent panel positioned by the
 * workspace. Items always start `attached`.
 */
export type AttachmentStatus = "attached" | "detached";

export interface SpatialPosition {
  readonly x: number;
  readonly y: number;
}

export interface SpatialSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Serializable layout data owned by the workspace, never by the application.
 *
 * Units and origin are defined by the host that renders the item. The React
 * DOM host uses CSS pixels relative to the top-left corner of the viewport.
 */
export interface SpatialItemLayout {
  /**
   * Top-left corner of the detached panel. Kept while attached, so detaching
   * again restores the last position. `null` until first detached.
   */
  readonly position: SpatialPosition | null;
  /** Size of the item in its original layout, measured when detached. */
  readonly size: SpatialSize | null;
  readonly visible: boolean;
}

/**
 * Immutable, JSON-serializable snapshot of a registered item.
 *
 * It holds identity and presentation metadata only. Domain data, business
 * logic and actions stay in the application that registered the item.
 */
export interface SpatialItemRecord {
  readonly id: SpatialItemId;
  readonly capabilities: SpatialItemCapabilities;
  readonly status: AttachmentStatus;
  readonly layout: SpatialItemLayout;
}

export interface SpatialItemDefinition {
  readonly id: SpatialItemId;
  readonly capabilities?: Partial<SpatialItemCapabilities>;
}

/** Layout values a host can provide when detaching an item. */
export interface SpatialDetachOptions {
  readonly position?: SpatialPosition;
  readonly size?: SpatialSize;
}
