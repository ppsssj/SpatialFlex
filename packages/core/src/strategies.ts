import { SpatialFlexError } from "./errors.js";

export interface DetachmentStrategy {
  readonly mode: "move" | "mirror" | "snapshot";
  readonly source: "placeholder" | "collapse" | "visible";
  readonly target: "web" | "xr";
}

export type SupportedDetachmentStrategy =
  | {
      readonly mode: "move";
      readonly source: "placeholder" | "collapse";
      readonly target: "web";
    }
  | {
      readonly mode: "mirror";
      readonly source: "visible";
      readonly target: "xr";
    };

export const DEFAULT_DETACHMENT_STRATEGY: SupportedDetachmentStrategy =
  Object.freeze({
    mode: "move",
    source: "placeholder",
    target: "web",
  });
export const XR_MIRROR_STRATEGY: SupportedDetachmentStrategy = Object.freeze({
  mode: "mirror",
  source: "visible",
  target: "xr",
});

/** Validate untrusted options without silently changing their meaning. */
export function validateDetachmentStrategy(
  value: unknown,
):
  | { readonly supported: true; readonly strategy: SupportedDetachmentStrategy }
  | { readonly supported: false; readonly reason: string } {
  if (!value || typeof value !== "object")
    return {
      supported: false,
      reason: "A strategy must specify mode, source and target.",
    };
  const { mode, source, target } = value as Record<string, unknown>;
  if (
    typeof mode !== "string" ||
    typeof source !== "string" ||
    typeof target !== "string" ||
    !["move", "mirror", "snapshot"].includes(mode) ||
    !["placeholder", "collapse", "visible"].includes(source) ||
    !["web", "xr"].includes(target)
  )
    return {
      supported: false,
      reason: "Unknown strategy mode, source policy or destination.",
    };
  if (
    mode === "move" &&
    target === "web" &&
    (source === "placeholder" || source === "collapse")
  )
    return {
      supported: true,
      strategy: Object.freeze({ mode, source, target }),
    };
  if (mode === "mirror" && source === "visible" && target === "xr")
    return {
      supported: true,
      strategy: Object.freeze({ mode, source, target }),
    };
  return {
    supported: false,
    reason:
      mode === "snapshot"
        ? "Snapshots are not implemented. No arbitrary HTML capture is provided."
        : mode === "move" && target === "xr"
          ? "Original React DOM can move only within its current document; XR requires a declared mirror."
          : "Supported strategies are Move + Placeholder/Collapse + Web, or Mirror + Visible + XR.",
  };
}

export function assertDetachmentStrategy(
  value: unknown,
): SupportedDetachmentStrategy {
  const result = validateDetachmentStrategy(value);
  if (!result.supported)
    throw new SpatialFlexError("UNSUPPORTED_STRATEGY", result.reason);
  return result.strategy;
}
