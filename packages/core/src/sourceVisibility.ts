import { SpatialFlexError } from "./errors.js";

/**
 * Visual policy for an attached source component while an independent
 * presentation (for example a live XR mirror) represents it elsewhere.
 *
 * This is separate from {@link DetachmentStrategy}: it never moves, clones or
 * remounts the source. The component stays mounted in its original place and
 * keeps owning its local state; only its visual presentation changes.
 *
 * - `visible`: the original stays visible and interactive (Keep original).
 * - `reserved`: the original is visually hidden and non-interactive, but its
 *   layout footprint is kept, so the surrounding page does not reflow.
 */
export type SourceVisibility = "visible" | "reserved";

/** Policies a caller may request, including explicitly unsupported ones. */
export type SourceVisibilityRequest = SourceVisibility | "collapsed";

/** Validate untrusted input without coercing it. */
export function validateSourceVisibility(
  value: unknown,
):
  | { readonly supported: true; readonly visibility: SourceVisibility }
  | { readonly supported: false; readonly reason: string } {
  if (value === "visible" || value === "reserved")
    return { supported: true, visibility: value };
  if (value === "collapsed")
    return {
      supported: false,
      reason:
        "Collapsing a hidden source is not supported: the source stays mounted in place, so its footprint is either kept visible or reserved.",
    };
  return {
    supported: false,
    reason: "Source visibility must be 'visible' or 'reserved'.",
  };
}

export function assertSourceVisibility(value: unknown): SourceVisibility {
  const result = validateSourceVisibility(value);
  if (!result.supported)
    throw new SpatialFlexError("UNSUPPORTED_STRATEGY", result.reason);
  return result.visibility;
}
