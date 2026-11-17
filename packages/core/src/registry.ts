import { SpatialFlexError } from "./errors";
import type {
  SpatialItemCapabilities,
  SpatialItemDefinition,
  SpatialItemId,
  SpatialItemRecord,
} from "./types";

export type SpatialRegistryListener = () => void;

/**
 * Handle returned by {@link SpatialRegistry.register}. It only affects the
 * registration it was created for: once that registration is removed, its
 * methods are no-ops, even if another item later registers the same ID.
 */
export interface SpatialItemRegistration {
  readonly id: SpatialItemId;
  /** Updates capabilities of this registration. */
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
    // registration that reuses the same ID.
    let current: SpatialItemRecord | undefined = record;

    return {
      id,
      update: (capabilities) => {
        if (!current || this.#items.get(id) !== current) return;
        const next = { ...current.capabilities, ...capabilities };
        if (sameCapabilities(current.capabilities, next)) return;
        current = Object.freeze({
          ...current,
          capabilities: Object.freeze(next),
        });
        this.#items.set(id, current);
        this.#commit();
      },
      unregister: () => {
        if (!current || this.#items.get(id) !== current) return;
        current = undefined;
        this.#items.delete(id);
        this.#commit();
      },
    };
  }

  /** Removes the item with this ID. Returns whether an item was removed. */
  unregister(id: SpatialItemId): boolean {
    if (!this.#items.delete(id)) return false;
    this.#commit();
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
