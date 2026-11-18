import { SpatialFlexError } from "./errors";

/**
 * How an extracted component is presented. This is independent of the
 * source layout policy (what happens to the original placement).
 *
 * - `native`: the original mounted DOM element itself is presented in space
 *   by a same-document DOM compositor. Same node, same React instance, same
 *   CSS and event handlers; only its presentation (position and transform)
 *   changes. Requires a host that composites the document's DOM.
 * - `adaptive`: a separate renderer-native representation built from the
 *   component's declared `SpatialItem xr` view. It shares application
 *   state and semantic actions but has its own (XR) design.
 */
export type PresentationStrategy = "native" | "adaptive";

/** Original placement while extracted (a source layout policy). */
export type ExtractionSource = "visible" | "reserved" | "collapsed";

export interface ExtractionRequest {
  readonly presentation: PresentationStrategy;
  readonly source: ExtractionSource;
}

export type SupportedExtraction =
  | {
      readonly presentation: "native";
      /** The single original instance leaves its place: reserve or collapse. */
      readonly source: "reserved" | "collapsed";
    }
  | {
      readonly presentation: "adaptive";
      readonly source: "visible" | "reserved";
    };

/** What the component and the current host offer. */
export interface ExtractionContext {
  /** The registration allows its original DOM to leave its place. */
  readonly detachable: boolean;
  /** The registration declares an XR view (`SpatialItem xr`). */
  readonly hasView: boolean;
  /** The host can composite this document's DOM in space. */
  readonly nativeHost: boolean;
}

type Validation<T> =
  | { readonly supported: true; readonly value: T }
  | { readonly supported: false; readonly reason: string };

export function validatePresentationStrategy(
  value: unknown,
): Validation<PresentationStrategy> {
  return value === "native" || value === "adaptive"
    ? { supported: true, value }
    : {
        supported: false,
        reason: "Presentation must be 'native' or 'adaptive'.",
      };
}

export function assertPresentationStrategy(
  value: unknown,
): PresentationStrategy {
  const result = validatePresentationStrategy(value);
  if (!result.supported)
    throw new SpatialFlexError("UNSUPPORTED_STRATEGY", result.reason);
  return result.value;
}

/**
 * The presentation used when a component does not declare one: `adaptive`
 * when it declares an XR view (the pre-P1-06A behavior), otherwise `native`.
 */
export function defaultPresentation(
  declared: PresentationStrategy | undefined,
  hasView: boolean,
): PresentationStrategy {
  return declared ?? (hasView ? "adaptive" : "native");
}

/** Whether a presentation is available at all, independent of the source. */
export function presentationSupport(
  presentation: PresentationStrategy,
  context: ExtractionContext,
):
  | { readonly supported: true }
  | { readonly supported: false; readonly reason: string } {
  if (presentation === "adaptive")
    return context.hasView
      ? { supported: true }
      : {
          supported: false,
          reason:
            "XR Adaptive needs a declared XR view (SpatialItem xr); none is declared.",
        };
  if (!context.detachable)
    return {
      supported: false,
      reason: "Native DOM needs a detachable SpatialItem.",
    };
  if (!context.nativeHost)
    return {
      supported: false,
      reason:
        "Native DOM needs a same-document DOM compositor; this host renders elsewhere.",
    };
  return { supported: true };
}

/** Validate an untrusted extraction request without coercing it. */
export function validateExtraction(
  value: unknown,
  context: ExtractionContext,
): Validation<SupportedExtraction> {
  if (!value || typeof value !== "object")
    return {
      supported: false,
      reason: "An extraction must specify presentation and source.",
    };
  const { presentation, source } = value as Record<string, unknown>;
  const strategy = validatePresentationStrategy(presentation);
  if (!strategy.supported) return strategy;
  if (source !== "visible" && source !== "reserved" && source !== "collapsed")
    return {
      supported: false,
      reason: "Source must be 'visible', 'reserved' or 'collapsed'.",
    };
  const available = presentationSupport(strategy.value, context);
  if (!available.supported) return available;
  if (strategy.value === "native") {
    if (source === "visible")
      return {
        supported: false,
        reason:
          "Native DOM moves the one original instance, so it cannot also stay in place. Use XR Adaptive to keep the original visible.",
      };
    return {
      supported: true,
      value: Object.freeze({ presentation: "native", source }),
    };
  }
  if (source === "collapsed")
    return {
      supported: false,
      reason:
        "XR Adaptive keeps the original mounted in place, so its footprint is kept visible or reserved; it cannot collapse.",
    };
  return {
    supported: true,
    value: Object.freeze({ presentation: "adaptive", source }),
  };
}

export function assertExtraction(
  value: unknown,
  context: ExtractionContext,
): SupportedExtraction {
  const result = validateExtraction(value, context);
  if (!result.supported)
    throw new SpatialFlexError("UNSUPPORTED_STRATEGY", result.reason);
  return result.value;
}
