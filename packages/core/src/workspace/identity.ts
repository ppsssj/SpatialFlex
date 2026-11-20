/**
 * P1-08A Multi-Surface identity contract (package-internal, experimental:
 * not exported from `@spatialflex/core` until P1-08B has a consumer).
 *
 * Identities are STRUCTURED, never built by string concatenation:
 * `"a:b" + "c"` and `"a" + ":bc"` collide, a tuple does not. A string form
 * exists only for transport (a future Bridge) and is a JSON tuple with a
 * version tag, decoded with full validation.
 *
 * - `surfaceId`: chosen by the application; unique among the LIVE surfaces
 *   of one workspace (coordinator). Stable across re-renders.
 * - `epoch`: assigned by the coordinator each time a surface is added;
 *   never reused within it. A removed-and-re-added surface with the same id
 *   is a different `SurfaceRef`, so nothing addressed to the old one can
 *   reach the new one.
 * - `itemId`: unique within one surface's registry only (two surfaces may
 *   both register `"chart"`).
 * - `registrationKey`: `SpatialRegistry.registrationOf(itemId)`; never
 *   reused for a remount (P1-07B2). Unique across registries of one
 *   JavaScript realm only: across documents it is meaningful solely
 *   together with its surface (and, for a Bridge, its document runtime).
 */

/** One live incarnation of a surface in a workspace. */
export interface SurfaceRef {
  readonly surfaceId: string;
  readonly epoch: number;
}

/** A registered item of a surface, bound to one registration. */
export interface ScopedItemRef {
  readonly surface: SurfaceRef;
  readonly itemId: string;
  readonly registrationKey: string;
}

/** One presentation instance of a scoped item (ids are per surface runtime). */
export interface ScopedPresentationRef {
  readonly item: ScopedItemRef;
  readonly instanceId: string;
}

export const sameSurface = (a: SurfaceRef, b: SurfaceRef) =>
  a.surfaceId === b.surfaceId && a.epoch === b.epoch;

export const sameItem = (a: ScopedItemRef, b: ScopedItemRef) =>
  sameSurface(a.surface, b.surface) &&
  a.itemId === b.itemId &&
  a.registrationKey === b.registrationKey;

const ITEM_TAG = "sf-item/1";

/**
 * Transport form of a scoped item reference: `["sf-item/1", surfaceId,
 * epoch, itemId, registrationKey]` as JSON. Any string content round-trips
 * without ambiguity (no separators to escape).
 */
export function encodeItemRef(ref: ScopedItemRef): string {
  return JSON.stringify([
    ITEM_TAG,
    ref.surface.surfaceId,
    ref.surface.epoch,
    ref.itemId,
    ref.registrationKey,
  ]);
}

/** Decodes {@link encodeItemRef}; `null` for anything malformed. */
export function decodeItemRef(text: string): ScopedItemRef | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 5 || value[0] !== ITEM_TAG)
    return null;
  const [, surfaceId, epoch, itemId, registrationKey] = value as unknown[];
  if (
    typeof surfaceId !== "string" ||
    surfaceId === "" ||
    typeof epoch !== "number" ||
    !Number.isSafeInteger(epoch) ||
    epoch < 1 ||
    typeof itemId !== "string" ||
    itemId === "" ||
    typeof registrationKey !== "string" ||
    registrationKey === ""
  )
    return null;
  return { surface: { surfaceId, epoch }, itemId, registrationKey };
}
