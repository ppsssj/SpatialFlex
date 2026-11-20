import type { SurfaceGeometry } from "./coordinates.js";
import {
  sameSurface,
  type ScopedItemRef,
  type SurfaceRef,
} from "./identity.js";

/**
 * What a surface's owner exposes to the workspace: its registry's
 * registration lookup (`SpatialRegistry` satisfies it). Structural, so the
 * workspace never holds the owner's DOM, React tree or document.
 */
export interface SurfaceOwner {
  registrationOf(itemId: string): string | undefined;
}

/**
 * Contract violation of the experimental workspace primitives. Kept apart
 * from the public `SpatialFlexError` codes until the API is published.
 */
export class WorkspaceContractError extends Error {
  readonly code: "INVALID_SURFACE_ID" | "DUPLICATE_SURFACE_ID";
  constructor(code: WorkspaceContractError["code"], message: string) {
    super(message);
    this.name = "WorkspaceContractError";
    this.code = code;
  }
}

export interface SurfaceRecord {
  readonly ref: SurfaceRef;
  readonly geometry: SurfaceGeometry;
  readonly owner: SurfaceOwner;
}

export type SurfaceListener = (event: {
  readonly type: "added" | "removed" | "moved";
  readonly ref: SurfaceRef;
}) => void;

/**
 * P1-08A: the live surfaces of one workspace (package-internal,
 * experimental). Not a singleton; one per workspace coordinator.
 *
 * It owns surface identity and lifecycle only. Each surface keeps its own
 * registry, controller and presentation runtime (ADR 0001): removing a
 * surface here tells listeners to tear that surface down, and nothing of
 * another surface.
 */
export class SurfaceTable {
  readonly #live = new Map<string, SurfaceRecord>();
  readonly #listeners = new Set<SurfaceListener>();
  #epoch = 0;

  /**
   * Adds a surface; returns its new incarnation.
   *
   * @throws {WorkspaceContractError} `DUPLICATE_SURFACE_ID` while a surface with
   *   the same id is live; `INVALID_SURFACE_ID` for an empty id.
   */
  add(
    surfaceId: string,
    geometry: SurfaceGeometry,
    owner: SurfaceOwner,
  ): SurfaceRef {
    if (typeof surfaceId !== "string" || surfaceId.trim() === "")
      throw new WorkspaceContractError(
        "INVALID_SURFACE_ID",
        `Surface id must be a non-empty string, received ${JSON.stringify(surfaceId)}.`,
      );
    if (this.#live.has(surfaceId))
      throw new WorkspaceContractError(
        "DUPLICATE_SURFACE_ID",
        `Surface "${surfaceId}" is already live in this workspace.`,
      );
    const ref: SurfaceRef = Object.freeze({ surfaceId, epoch: ++this.#epoch });
    this.#live.set(surfaceId, { ref, geometry, owner });
    this.#emit({ type: "added", ref });
    return ref;
  }

  /** Removes exactly this incarnation. A stale ref is a no-op (`false`). */
  remove(ref: SurfaceRef): boolean {
    const record = this.#live.get(ref.surfaceId);
    if (!record || !sameSurface(record.ref, ref)) return false;
    this.#live.delete(ref.surfaceId);
    this.#emit({ type: "removed", ref: record.ref });
    return true;
  }

  isLive(ref: SurfaceRef): boolean {
    const record = this.#live.get(ref.surfaceId);
    return !!record && sameSurface(record.ref, ref);
  }

  get(ref: SurfaceRef): SurfaceRecord | undefined {
    const record = this.#live.get(ref.surfaceId);
    return record && sameSurface(record.ref, ref) ? record : undefined;
  }

  /** Live surfaces, in insertion order. */
  list(): SurfaceRecord[] {
    return [...this.#live.values()];
  }

  /** Moves a live surface (its pose or size). Stale refs are rejected. */
  setGeometry(ref: SurfaceRef, geometry: SurfaceGeometry): boolean {
    const record = this.get(ref);
    if (!record) return false;
    this.#live.set(ref.surfaceId, { ...record, geometry });
    this.#emit({ type: "moved", ref: record.ref });
    return true;
  }

  /**
   * Whether a scoped item still designates a live registration: its
   * surface incarnation is live and that surface's registry still holds
   * the same registration of the item id. Every routed action and
   * presentation message must pass this before reaching an owner.
   */
  isCurrent(item: ScopedItemRef): boolean {
    const record = this.get(item.surface);
    return (
      !!record &&
      record.owner.registrationOf(item.itemId) === item.registrationKey
    );
  }

  /** Scoped reference to the current registration of an item, if any. */
  itemRef(surface: SurfaceRef, itemId: string): ScopedItemRef | undefined {
    const record = this.get(surface);
    const registrationKey = record?.owner.registrationOf(itemId);
    return record && registrationKey
      ? { surface: record.ref, itemId, registrationKey }
      : undefined;
  }

  subscribe(listener: SurfaceListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(event: Parameters<SurfaceListener>[0]) {
    for (const listener of [...this.#listeners]) listener(event);
  }
}
