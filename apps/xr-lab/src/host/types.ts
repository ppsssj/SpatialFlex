/**
 * Neutral XR Host contract.
 *
 * The host renders whatever panels it is given and reports user interaction
 * as events. It knows nothing about the application, its state, or any
 * integration SDK: panels are plain data, and ids are opaque strings.
 */

/** Position in meters, in the scene's world space (y up, -z forward). */
export type Vec3 = readonly [x: number, y: number, z: number];

/** What a panel shows. A small, generic vocabulary drawn by the host. */
export type HostPanelBody =
  | { readonly kind: "value"; readonly label: string; readonly value: string }
  | {
      readonly kind: "bars";
      readonly label: string;
      readonly values: readonly number[];
    }
  | {
      readonly kind: "swatch";
      readonly color: string;
      readonly caption: string;
    };

export interface HostButton {
  /** Opaque id, reported back in {@link HostEvents.onPanelButton}. */
  readonly id: string;
  readonly label: string;
}

export interface HostPanel {
  /** Opaque, unique id, reported back in events. */
  readonly id: string;
  readonly title: string;
  /** Center of the panel, in meters. */
  readonly position: Vec3;
  readonly body: HostPanelBody;
  readonly buttons: readonly HostButton[];
  readonly selected: boolean;
}

export interface HostEvents {
  /** A panel button was activated (mouse click or XR select). */
  onPanelButton(panelId: string, buttonId: string): void;
  /** The panel background was activated. */
  onPanelSelect(panelId: string): void;
  /** The panel's close control was activated. */
  onPanelClose(panelId: string): void;
}

/** Panel geometry, identical for every panel and every integration. */
export const PANEL_SIZE = { width: 0.6, height: 0.4 } as const;
export const BUTTON_SIZE = { width: 0.16, height: 0.08 } as const;

/**
 * Deterministic desktop camera. An immersive user starts at the origin
 * looking down -z, so content is placed about 1.2 m in front of the origin
 * and the desktop camera sits behind the origin for an overview.
 */
export const CAMERA = {
  position: [0, 1.5, 1.0] as Vec3,
  target: [0, 1.4, -1.2] as Vec3,
  fov: 60,
} as const;
