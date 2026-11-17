import { SpatialFlexError } from "./errors";
import type {
  SpatialDetachOptions,
  SpatialItemCapabilities,
  SpatialItemDefinition,
  SpatialItemId,
  SpatialItemLayout,
  SpatialItemRecord,
  SpatialPosition,
  SpatialSize,
} from "./types";

export type SpatialRegistryListener = () => void;

/**
 * Handle returned by {@link SpatialRegistry.register}. It only affects the
 * registration it was created for: once that registration is removed, its
 * methods are no-ops, even if another item later registers the same ID.
 */
export interface SpatialItemRegistration {
  readonly id: SpatialItemId;
  /**
   * Updates capabilities of this registration. Removing `detachable` from a
   * detached item attaches it.
   */
  update(capabilities: Partial<SpatialItemCapabilities>): void;
  /** Removes this registration. Safe to call more than once. */
  unregister(): void;
}

const DEFAULT_CAPABILITIES: SpatialItemCapabilities = {
  detachable: false,
  movable: false,
  resizable: false,
};

/**
 * Workspace-scoped registry of SpatialItems.
 *
 * Create one registry per workspace; there is no global instance. Records are
 * immutable and replaced on change, so `get` and `list` results can be
 * compared by reference to detect updates.
 */
export class SpatialRegistry {
  readonly #items = new Map<SpatialItemId, SpatialItemRecord>();
  readonly #owners = new Map<SpatialItemId, object>();
  readonly #listeners = new Set<SpatialRegistryListener>();
  #snapshot: readonly SpatialItemRecord[] = Object.freeze([]);

  /**
   * Registers an item.
   *
   * @throws {SpatialFlexError} `INVALID_ITEM_ID` if the ID is not a non-empty
   *   string, `DUPLICATE_ITEM_ID` if the ID is already registered.
   */
  register(definition: SpatialItemDefinition): SpatialItemRegistration {
    const { id } = definition;
    if (typeof id !== "string" || id.trim() === "") {
      throw new SpatialFlexError(
        "INVALID_ITEM_ID",
        `SpatialItem id must be a non-empty string, received ${JSON.stringify(id)}.`,
      );
    }
    if (this.#items.has(id)) {
      throw new SpatialFlexError(
        "DUPLICATE_ITEM_ID",
        `SpatialItem "${id}" is already registered in this workspace.`,
      );
    }

    const record = createRecord(id, {
      ...DEFAULT_CAPABILITIES,
      ...definition.capabilities,
    });
    this.#items.set(id, record);
    this.#commit();

    // Identifies this registration, so its handle cannot touch a later
    // registration that reuses the same ID. Records are replaced on every
    // change, so ownership is tracked by token rather than record identity.
    const token = {};
    this.#owners.set(id, token);
    const isCurrent = () => this.#owners.get(id) === token;

    return {
      id,
      update: (capabilities) => {
        const record = this.#items.get(id);
        if (!record || !isCurrent()) return;
        const next = { ...record.capabilities, ...capabilities };
        if (sameCapabilities(record.capabilities, next)) return;
        this.#items.set(
          id,
          Object.freeze({
            ...record,
            capabilities: Object.freeze(next),
            status: next.detachable ? record.status : "attached",
          }),
        );
        this.#commit();
      },
      unregister: () => {
        if (!isCurrent()) return;
        this.unregister(id);
      },
    };
  }

  /** Removes the item with this ID. Returns whether an item was removed. */
  unregister(id: SpatialItemId): boolean {
    if (!this.#items.delete(id)) return false;
    this.#owners.delete(id);
    this.#commit();
    return true;
  }

  /**
   * Shows the item as an independent panel. `options` sets the panel's
   * position and size; omitted values keep the previous layout.
   *
   * Changes presentation only: the application keeps owning the item's data
   * and actions. Returns `false` without notifying if already detached.
   *
   * @throws {SpatialFlexError} `UNKNOWN_ITEM_ID`, `NOT_DETACHABLE`, or
   *   `INVALID_LAYOUT` for non-finite values or a non-positive size.
   */
  detach(id: SpatialItemId, options: SpatialDetachOptions = {}): boolean {
    const record = this.#require(id);
    if (!record.capabilities.detachable) {
      throw new SpatialFlexError(
        "NOT_DETACHABLE",
        `SpatialItem "${id}" is not detachable.`,
      );
    }
    if (options.position) assertPosition(options.position);
    if (options.size) assertSize(options.size);
    if (record.status === "detached") return false;

    this.#replace(record, "detached", {
      ...record.layout,
      position: options.position ?? record.layout.position,
      size: options.size ?? record.layout.size,
    });
    return true;
  }

  /**
   * Returns the item to its original layout. The layout is kept, so detaching
   * again restores the panel position. Returns `false` without notifying if
   * already attached.
   *
   * @throws {SpatialFlexError} `UNKNOWN_ITEM_ID`.
   */
  attach(id: SpatialItemId): boolean {
    const record = this.#require(id);
    if (record.status === "attached") return false;
    this.#replace(record, "attached", record.layout);
    return true;
  }

  /**
   * Moves a detached item's panel. Returns `false` without notifying if the
   * position is unchanged.
   *
   * @throws {SpatialFlexError} `UNKNOWN_ITEM_ID`, `NOT_MOVABLE`,
   *   `NOT_DETACHED`, or `INVALID_LAYOUT`.
   */
  move(id: SpatialItemId, position: SpatialPosition): boolean {
    const record = this.#require(id);
    if (!record.capabilities.movable) {
      throw new SpatialFlexError(
        "NOT_MOVABLE",
        `SpatialItem "${id}" is not movable.`,
      );
    }
    if (record.status !== "detached") {
      throw new SpatialFlexError(
        "NOT_DETACHED",
        `SpatialItem "${id}" must be detached before it can move.`,
      );
    }
    assertPosition(position);
    const previous = record.layout.position;
    if (previous && previous.x === position.x && previous.y === position.y) {
      return false;
    }
    this.#replace(record, "detached", { ...record.layout, position });
    return true;
  }

  /**
   * Resizes a detached item's panel. Returns `false` without notifying if
   * the size is unchanged.
   *
   * @throws {SpatialFlexError} `UNKNOWN_ITEM_ID`, `NOT_RESIZABLE`,
   *   `NOT_DETACHED`, or `INVALID_LAYOUT` for non-finite or non-positive
   *   dimensions.
   */
  resize(id: SpatialItemId, size: SpatialSize): boolean {
    const record = this.#require(id);
    if (!record.capabilities.resizable) {
      throw new SpatialFlexError(
        "NOT_RESIZABLE",
        `SpatialItem "${id}" is not resizable.`,
      );
    }
    if (record.status !== "detached") {
      throw new SpatialFlexError(
        "NOT_DETACHED",
        `SpatialItem "${id}" must be detached before it can be resized.`,
      );
    }
    assertSize(size);
    const previous = record.layout.size;
    if (
      previous &&
      previous.width === size.width &&
      previous.height === size.height
    ) {
      return false;
    }
    this.#replace(record, "detached", { ...record.layout, size });
    return true;
  }

  get(id: SpatialItemId): SpatialItemRecord | undefined {
    return this.#items.get(id);
  }

  has(id: SpatialItemId): boolean {
    return this.#items.has(id);
  }

  /**
   * Registered items in registration order. Returns the same array instance
   * until the registry changes.
   */
  list(): readonly SpatialItemRecord[] {
    return this.#snapshot;
  }

  /** Calls `listener` after every change. Returns an unsubscribe function. */
  subscribe(listener: SpatialRegistryListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #require(id: SpatialItemId): SpatialItemRecord {
    const record = this.#items.get(id);
    if (!record) {
      throw new SpatialFlexError(
        "UNKNOWN_ITEM_ID",
        `SpatialItem "${id}" is not registered in this workspace.`,
      );
    }
    return record;
  }

  // Replaces the record, keeping its position in registration order.
  #replace(
    record: SpatialItemRecord,
    status: SpatialItemRecord["status"],
    layout: SpatialItemLayout,
  ): void {
    this.#items.set(
      record.id,
      Object.freeze({
        ...record,
        status,
        layout: Object.freeze({
          position: layout.position && Object.freeze({ ...layout.position }),
          size: layout.size && Object.freeze({ ...layout.size }),
          visible: layout.visible,
        }),
      }),
    );
    this.#commit();
  }

  #commit(): void {
    this.#snapshot = Object.freeze([...this.#items.values()]);
    for (const listener of [...this.#listeners]) listener();
  }
}

function createRecord(
  id: SpatialItemId,
  capabilities: SpatialItemCapabilities,
): SpatialItemRecord {
  return Object.freeze({
    id,
    capabilities: Object.freeze(capabilities),
    status: "attached",
    layout: Object.freeze({ position: null, size: null, visible: true }),
  });
}

function sameCapabilities(
  a: SpatialItemCapabilities,
  b: SpatialItemCapabilities,
): boolean {
  return (
    a.detachable === b.detachable &&
    a.movable === b.movable &&
    a.resizable === b.resizable
  );
}

function assertPosition(position: SpatialPosition): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new SpatialFlexError(
      "INVALID_LAYOUT",
      `Position must have finite x and y, received ${JSON.stringify(position)}.`,
    );
  }
}

function assertSize(size: SpatialSize): void {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new SpatialFlexError(
      "INVALID_LAYOUT",
      `Size must have finite, positive width and height, received ${JSON.stringify(size)}.`,
    );
  }
}
