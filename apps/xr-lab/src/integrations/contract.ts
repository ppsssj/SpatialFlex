import type { ComponentType, ReactNode } from "react";
import type {
  HostCameraFrame,
  HostEvents,
  HostManipulationMode,
  HostPanel,
  HostRay,
  Quat,
  Vec3,
} from "../contracts/xrHost";
// Type-only: the surface geometry types (the SDK's projection types, which
// the lab surface already uses). Nothing is imported at run time.
import type { ContainmentIssue } from "../surface/nativeContainment";
import type { ContainingSurface, Occluder } from "../surface/surfaceMath";
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
  /** The original element of a natively extracted item (read-only). */
  nativeElement?(id: string): HTMLElement | null;
  /**
   * Connects the Spatial Website's page surface as the Native DOM host of
   * the integration's presentation runtime, which owns every natively
   * extracted element's transform, clip, visibility and input handles.
   * The surface reports camera frames with its page context; when it
   * disconnects, Native presentations end (XR Adaptive panels, drawn by the
   * renderer host, stay). Stable across renders. SpatialFlex only.
   */
  readonly connectNativeHost?: () => LabNativeHost;
  /** Native presentations that cannot be composited, with the reasons. */
  readonly nativeIssues?: ReadonlyMap<string, readonly ContainmentIssue[]>;
  /** Element of a registered component, for read-only selection geometry. */
  sourceElement?(id: string): HTMLElement | null;
  validateSourceVisibility?(
    value: unknown,
  ):
    | { readonly supported: true }
    | { readonly supported: false; readonly reason: string };
  /**
   * Spatial manipulation of extracted presentations (Native DOM and XR
   * Adaptive alike), implemented only by SpatialFlex. Stable across renders.
   */
  readonly manipulation?: LabManipulation;
}

/** World pose of a presentation: meters, unit quaternion, uniform scale. */
export interface LabPose {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: number;
}

export interface LabManipulationTarget {
  /** Registered component (and its panel id). */
  readonly itemId: string;
  /** Presentation instance (`native-N` or `presentation-N`, from the SDK runtime). */
  readonly presentationId: string;
  readonly registrationId: string;
  readonly kind: PresentationId;
  readonly transform: LabPose;
  /** Pose the instance started with; Reset returns here. */
  readonly initial: LabPose;
}

export interface LabManipulationSnapshot {
  /** Changes whenever a pose, the session or the selection changes. */
  readonly version: number;
  readonly active: {
    readonly token: number;
    readonly itemId: string;
    readonly presentationId: string;
    readonly mode: HostManipulationMode;
    readonly input: "pointer" | "keyboard";
  } | null;
  /** Item selected for manipulation (last manipulated or picked). */
  readonly selected: string | null;
}

export type NudgeDirection = "left" | "right" | "up" | "down";

/**
 * Renderer-neutral manipulation of the current presentation of each item.
 * Input arrives as world rays (hosts, DOM handles) or keyboard steps; poses
 * are read back per frame by the compositor and the host adapter.
 */
export interface LabManipulation {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LabManipulationSnapshot;
  targets(): readonly LabManipulationTarget[];
  /** Current pose of an item's presentation, if it is manipulable. */
  poseOf(itemId: string): LabPose | undefined;
  /** Natural (scale 1) size of a Native DOM presentation, in meters. */
  setExtent(itemId: string, extent: { width: number; height: number }): void;
  begin(
    itemId: string,
    mode: HostManipulationMode,
    pointerId: number,
    ray: HostRay,
  ): number | null;
  update(token: number, ray: HostRay): void;
  end(token: number, commit: boolean): void;
  /** One keyboard step; starts or continues a keyboard session. */
  nudge(
    itemId: string,
    mode: HostManipulationMode,
    direction: NudgeDirection,
    large: boolean,
  ): number | null;
  /** Ends a keyboard session on the item, keeping (or reverting) its steps. */
  endKeyboard(itemId: string, commit: boolean): boolean;
  /** Cancels whatever session is active (Escape). */
  cancel(): boolean;
  reset(itemId: string): boolean;
  select(itemId: string | null): boolean;
}

/** The page surface's connection to the Native DOM presentation runtime. */
export interface LabNativeHost {
  /**
   * After each rendered frame: composites the native elements through the
   * page. Returns their footprints in page pixels (kept out of the page's
   * occlusion clip, which would clip them too).
   */
  frame(
    frame: HostCameraFrame,
    options: {
      readonly surface: ContainingSurface;
      readonly occluders: readonly Occluder[];
    },
  ): { readonly keep: [number, number][][] };
  disconnect(): void;
}

export interface ExtractOptions {
  /** Untrusted presentation strategy; defaults to `adaptive`. */
  readonly presentation?: unknown;
  /** Untrusted source layout policy, validated by the integration. */
  readonly source: unknown;
  /** Initial world position of the presentation. */
  readonly position: Vec3;
  /** Initial facing of a Native DOM presentation (XYZ Euler radians). */
  readonly rotation?: Vec3;
  /** Natural world size of a Native DOM presentation, in meters. */
  readonly extent?: { readonly width: number; readonly height: number };
  /** World meters per CSS pixel of a Native DOM presentation (page scale). */
  readonly metersPerPixel?: number;
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
    /**
     * Layout origin: an Adaptive panel's slot or extraction position (plus
     * Move offsets), a Native DOM presentation's start position. The
     * manipulated pose is `manipulation.poseOf`.
     */
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
