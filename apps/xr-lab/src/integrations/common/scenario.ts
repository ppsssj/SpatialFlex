import type { HostButton, HostPanelBody, Vec3 } from "../../contracts/xrHost";
import {
  IMAGE_COLORS,
  WIDGETS,
  type ImageVariant,
  type LabActions,
  type LabState,
  type WidgetId,
} from "../../fixtures";

/**
 * The XR scenario, shared by every integration so that both modes render the
 * same panels at the same coordinates with the same content and actions.
 */
export interface XRViewSpec {
  readonly label: string;
  /** Default panel center, in meters. */
  readonly position: Vec3;
  readonly buttons: readonly HostButton[];
  body(state: LabState): HostPanelBody;
  /** Panel button id -> the application's own domain action. */
  readonly actions: Readonly<
    Record<string, (actions: LabActions, state: LabState) => void>
  >;
}

const VARIANTS = Object.keys(IMAGE_COLORS) as ImageVariant[];

export const XR_VIEWS: Readonly<Record<WidgetId, XRViewSpec>> = {
  [WIDGETS.counter]: {
    label: "Shared counter",
    position: [0, 1.4, -1.2],
    buttons: [{ id: "increment", label: "+1" }],
    body: (state) => ({
      kind: "value",
      label: "Shared count",
      value: String(state.sharedCount),
    }),
    actions: { increment: (actions) => actions.increment() },
  },
  [WIDGETS.chart]: {
    label: "Live chart",
    position: [-0.75, 1.4, -1.0],
    buttons: [],
    body: (state) => ({
      kind: "bars",
      label: "Recent counts",
      values: state.history,
    }),
    actions: {},
  },
  [WIDGETS.image]: {
    label: "Image",
    position: [0.75, 1.4, -1.0],
    buttons: [{ id: "next-variant", label: "Next" }],
    body: (state) => ({
      kind: "swatch",
      color: IMAGE_COLORS[state.imageVariant],
      caption: state.imageVariant,
    }),
    actions: {
      "next-variant": (actions, state) =>
        actions.setImageVariant(
          VARIANTS[
            (VARIANTS.indexOf(state.imageVariant) + 1) % VARIANTS.length
          ]!,
        ),
    },
  },
};

export function hasXRView(id: string): id is WidgetId {
  return Object.hasOwn(XR_VIEWS, id);
}
