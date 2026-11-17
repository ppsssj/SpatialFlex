import type { ComponentType, ReactNode } from "react";
import type { HostEvents, HostPanel, Vec3 } from "../host";
import type { RenderWidget } from "../fixtures";

/**
 * Contract between the shared lab shell and an integration adapter.
 *
 * An adapter connects the application fixture (state and actions) to the
 * neutral XR host. Every mode implements this same interface and is driven by
 * the same shell, host, fixture and tests.
 */
export interface LabIntegration extends HostEvents {
  /** Items that can be shown in XR, in display order. */
  readonly items: readonly XRItemOption[];
  /** Where `items` come from, shown in the UI. */
  readonly source: string;
  /** Panels for the host. */
  readonly panels: readonly HostPanel[];
  /** Shows an item in XR. Returns false for unknown or unavailable ids. */
  show(id: string): boolean;
  /** Removes an item from XR. Returns false if it was not shown. */
  hide(id: string): boolean;
  /** Moves a shown item's panel by `delta` meters. */
  move(id: string, delta: Vec3): boolean;
  /** Wraps dashboard widgets, if the integration needs to. */
  readonly renderWidget?: RenderWidget;
}

export interface XRItemOption {
  readonly id: string;
  readonly label: string;
  readonly shown: boolean;
  readonly selected: boolean;
}

export type IntegrationId = "baseline" | "spatialflex";

export interface IntegrationModule {
  readonly id: IntegrationId;
  /** Context the integration needs above the dashboard and the XR host. */
  readonly Provider: ComponentType<{ children?: ReactNode }>;
  /** Builds the integration. Called inside `Provider` and the lab store context. */
  useIntegration(): LabIntegration;
}
