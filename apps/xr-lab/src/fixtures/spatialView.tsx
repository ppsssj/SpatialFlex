import { createContext, useContext, type ReactNode } from "react";

// This SDK-free fixture contract is structurally checked by SpatialItem.xr.
// It lets baseline use precisely the same application without importing SDK code.
export interface WidgetView {
  readonly title: string;
  readonly body:
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
  readonly actions?: readonly {
    readonly id: string;
    readonly label: string;
    readonly invoke: () => void;
  }[];
}
export type RenderWidget = (
  id: string,
  widget: ReactNode,
  view?: WidgetView,
) => ReactNode;
export const WidgetRendererContext = createContext<RenderWidget>(
  (_, widget) => widget,
);
export const useWidgetRenderer = () => useContext(WidgetRendererContext);
