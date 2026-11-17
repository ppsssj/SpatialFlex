import type { ComponentType } from "react";

/**
 * Renderer-neutral XR host contract.
 *
 * Every XR host (Three.js, Babylon.js, ...) renders the panels it is given
 * and reports user interaction as events. It knows nothing about the
 * application, its state, or any integration SDK: panels are plain data and
 * ids are opaque strings. This module must not import any rendering engine.
 */

/** Position in meters, world space: y up, -z forward (right-handed). */
export type Vec3 = readonly [x: number, y: number, z: number];

/** What a panel shows. A small, generic vocabulary drawn by every host. */
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

export interface XRHostProps extends HostEvents {
  /** Panels to render. A host keeps no copy of their content. */
  readonly panels: readonly HostPanel[];
}

export type EngineId = "three" | "babylon";

/** A rendering engine's host, loaded on demand. */
export interface HostModule {
  readonly id: EngineId;
  readonly label: string;
  readonly Host: ComponentType<XRHostProps>;
}

/** Panel geometry, identical for every panel, engine and integration. */
export const PANEL_SIZE = { width: 0.6, height: 0.4 } as const;
export const BUTTON_SIZE = { width: 0.16, height: 0.08 } as const;
export const CLOSE_SIZE = 0.06;
/** Offset of buttons in front of the panel face, in meters. */
export const PART_DEPTH = 0.005;

/**
 * Deterministic desktop camera. An immersive user starts at the origin
 * looking down -z, so content is placed about 1.2 m in front of the origin
 * and the desktop camera sits behind the origin for an overview.
 */
export const CAMERA = {
  position: [0, 1.5, 1.0] as Vec3,
  target: [0, 1.4, -1.2] as Vec3,
  /** Vertical field of view, in degrees. */
  fov: 60,
} as const;

/** A part of a panel, in the panel's local coordinates (meters). */
export interface PanelPart {
  /** `background`, `close` or `button:<id>`. Reported by the host probe. */
  readonly part: string;
  readonly center: Vec3;
  readonly width: number;
  readonly height: number;
  readonly label?: string;
  readonly buttonId?: string;
}

/** Where every part of a panel goes. Shared so all hosts lay out alike. */
export function panelLayout(panel: HostPanel): readonly PanelPart[] {
  const rowY = -PANEL_SIZE.height / 2 + BUTTON_SIZE.height / 2 + 0.03;
  const spacing = BUTTON_SIZE.width + 0.03;
  const firstX = -((panel.buttons.length - 1) * spacing) / 2;
  return [
    {
      part: "background",
      center: [0, 0, 0],
      width: PANEL_SIZE.width,
      height: PANEL_SIZE.height,
    },
    ...panel.buttons.map((button, i) => ({
      part: `button:${button.id}`,
      center: [firstX + i * spacing, rowY, PART_DEPTH] as Vec3,
      width: BUTTON_SIZE.width,
      height: BUTTON_SIZE.height,
      label: button.label,
      buttonId: button.id,
    })),
    {
      part: "close",
      center: [
        PANEL_SIZE.width / 2 - CLOSE_SIZE / 2 - 0.015,
        PANEL_SIZE.height / 2 - CLOSE_SIZE / 2 - 0.015,
        PART_DEPTH,
      ],
      width: CLOSE_SIZE,
      height: CLOSE_SIZE,
      label: "x",
    },
  ];
}
