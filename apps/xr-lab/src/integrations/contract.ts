import type { ComponentType, ReactNode } from "react";
import type { HostEvents, HostPanel, Vec3 } from "../contracts/xrHost";
import type { RenderWidget } from "../fixtures";
/** UI capability request. Structurally compatible with SDK strategies without
 * adding an SDK dependency to the baseline, shared shell or renderer contract. */
export interface LabStrategy {
  readonly mode: "move" | "mirror" | "snapshot";
  readonly source: "placeholder" | "collapse" | "visible";
  readonly target: "web" | "xr";
}

/**
 * Contract between the shared lab shell and an integration adapter.
 *
 * An adapter connects the application fixture (state and actions) to the
 * neutral XR host. Every mode implements this same interface and is driven by
 * the same shell, host, fixture and tests.
 */
export interface LabIntegration extends HostEvents {
  readonly actionOwners?: Readonly<Record<string, string>>;
  /** Items that can be shown in XR, in display order. */
  readonly items: readonly XRItemOption[];
  /** Where `items` come from, shown in the UI. */
  readonly source: string;
  /** Panels for the host. */
  readonly panels: readonly HostPanel[];
  /** Shows an item in XR. Returns false for unknown or unavailable ids. */
  show(id: string, strategy?: LabStrategy): boolean;
  validateStrategy?(
    strategy: unknown,
  ):
    | { readonly supported: true }
    | { readonly supported: false; readonly reason: string };
  /** Same-document Move, implemented only by SpatialFlex. */
  detach?(id: string, strategy: LabStrategy): boolean;
  attach?(id: string): boolean;
  /** Removes an item from XR. Returns false if it was not shown. */
  hide(id: string): boolean;
  /** Moves a shown item's panel by `delta` meters. */
  move(id: string, delta: Vec3): boolean;
  /** Wraps dashboard widgets, if the integration needs to. */
  readonly renderWidget?: RenderWidget;
  /**
   * Registered components that can be selected on a spatial web surface,
   * in registration order. Implemented only by SpatialFlex: eligibility
   * comes from component registrations, never from page selectors.
   */
  readonly surfaceItems?: readonly SurfaceItem[];
  /**
   * Extracts a registered component into space with an explicit
   * presentation strategy:
   * - `adaptive`: an independent renderer-native XR panel at `position`,
   *   built from the declared XR view. The original stays mounted in place
   *   (visible or reserved).
   * - `native`: the original mounted DOM element itself, presented in space
   *   by the same-document DOM compositor (which owns its pose). The
   *   source is reserved or collapsed. Nothing is cloned or remounted.
   */
  extract?(id: string, options: ExtractOptions): boolean;
  /** Ends the extraction and returns the original to its place. */
  restore?(id: string): boolean;
  /** Validates an untrusted presentation + source request for an item. */
  validateExtraction?(
    id: string,
    request: unknown,
  ):
    | { readonly supported: true }
    | { readonly supported: false; readonly reason: string };
  /** The original element of a natively extracted item, for its compositor. */
  nativeElement?(id: string): HTMLElement | null;
  /** Element of a registered component, for read-only selection geometry. */
  sourceElement?(id: string): HTMLElement | null;
  validateSourceVisibility?(
    value: unknown,
  ):
    | { readonly supported: true }
    | { readonly supported: false; readonly reason: string };
}

export interface ExtractOptions {
  /** Untrusted presentation strategy; defaults to `adaptive`. */
  readonly presentation?: unknown;
  /** Untrusted source layout policy, validated by the integration. */
  readonly source: unknown;
  /** World position of an adaptive panel. */
  readonly position: Vec3;
}

export type PresentationId = "native" | "adaptive";

export interface PresentationOption {
  readonly supported: boolean;
  readonly reason?: string;
}

export interface SurfaceItem {
  readonly id: string;
  readonly label: string;
  /** Whether any presentation strategy is available. */
  readonly extractable: boolean;
  /** Why the component cannot be extracted, if it cannot. */
  readonly reason?: string;
  /** Declared (or derived) default presentation strategy. */
  readonly defaultPresentation: PresentationId;
  /** Availability of each presentation strategy for this registration. */
  readonly presentations: Readonly<Record<PresentationId, PresentationOption>>;
  readonly extraction: {
    readonly presentation: PresentationId;
    readonly source: "visible" | "reserved" | "collapsed";
    /** Presentation instance identity (not the strategy). */
    readonly presentationId?: string;
    /** World position of an adaptive panel (native poses belong to the compositor). */
    readonly position?: Vec3;
  } | null;
}

export interface XRItemOption {
  readonly id: string;
  readonly label: string;
  readonly shown: boolean;
  readonly selected: boolean;
  readonly detached?: boolean;
  readonly presentationId?: string;
}

export type IntegrationId = "baseline" | "spatialflex";

export interface IntegrationModule {
  readonly id: IntegrationId;
  /** Context the integration needs above the dashboard and the XR host. */
  readonly Provider: ComponentType<{ children?: ReactNode }>;
  /** Builds the integration. Called inside `Provider` and the lab store context. */
  useIntegration(): LabIntegration;
}
