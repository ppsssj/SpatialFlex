/** Experimental, explicit spatial content. No DOM, React or engine types. */
export type SpatialViewBody =
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

export interface SpatialViewAction {
  readonly id: string;
  readonly label: string;
  /** Parent-realm callback; never included in a serializable view record. */
  readonly invoke: () => void;
}

/** @experimental Supply alongside the component whose state this describes. */
export interface SpatialViewBinding {
  readonly title?: string;
  readonly body: SpatialViewBody;
  readonly actions?: readonly SpatialViewAction[];
}

/** Immutable data only; functions and renderer transforms are stored elsewhere. */
export interface SpatialViewRecord {
  readonly id: string;
  readonly registrationId: string;
  readonly title: string;
  readonly body: SpatialViewBody;
  readonly actions: readonly { readonly id: string; readonly label: string }[];
}

const text = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 256;
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Copy an allowlisted vocabulary; caller input cannot mutate published data. */
export function prepareView(id: string, binding: SpatialViewBinding) {
  const title = binding.title ?? id;
  const b = binding.body;
  if (!text(id) || !text(title) || !b || typeof b !== "object")
    throw new Error("Invalid spatial view title/body");
  let body: SpatialViewBody;
  switch (b.kind) {
    case "value":
      if (!text(b.label) || typeof b.value !== "string" || b.value.length > 256)
        throw new Error("Invalid spatial value");
      body = Object.freeze({ kind: b.kind, label: b.label, value: b.value });
      break;
    case "bars":
      if (
        !text(b.label) ||
        !Array.isArray(b.values) ||
        b.values.length > 64 ||
        !Array.from(b.values).every(finite)
      )
        throw new Error("Invalid spatial bars");
      body = Object.freeze({
        kind: b.kind,
        label: b.label,
        values: Object.freeze([...b.values]),
      });
      break;
    case "swatch":
      if (
        typeof b.color !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(b.color) ||
        !text(b.caption)
      )
        throw new Error("Invalid spatial swatch");
      body = Object.freeze({
        kind: b.kind,
        color: b.color,
        caption: b.caption,
      });
      break;
    default:
      throw new Error("Unsupported spatial view body");
  }
  const actions = binding.actions ?? [];
  if (!Array.isArray(actions) || actions.length > 8)
    throw new Error("Invalid spatial actions");
  const handlers = new Map<string, () => void>();
  const data = Array.from(actions, (action) => {
    if (
      !action ||
      !text(action.id) ||
      !text(action.label) ||
      typeof action.invoke !== "function" ||
      handlers.has(action.id)
    )
      throw new Error("Invalid or duplicate spatial action");
    handlers.set(action.id, action.invoke);
    return Object.freeze({ id: action.id, label: action.label });
  });
  return { data: { title, body, actions: Object.freeze(data) }, handlers };
}
