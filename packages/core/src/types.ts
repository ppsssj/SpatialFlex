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
 * Logical presentation state. Items always start `attached` (rendered in
 * their original layout); switching to `detached` is the responsibility of
 * the detach/attach lifecycle and is not implemented yet.
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
 * Units are interpreted by the host that renders the item. `null` means the
 * host has not assigned a value and the item follows its original layout.
 */
export interface SpatialItemLayout {
  readonly position: SpatialPosition | null;
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
