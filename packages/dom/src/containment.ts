/**
 * Native DOM containment diagnostics (P1-07A).
 *
 * The compositor places a natively extracted element with
 * `position: fixed` and a transform relative to its intended containing
 * block (a transformed spatial page, or the viewport), and no ancestor in
 * between may clip it. Some ancestor styles break that, and no transform of
 * the element alone can undo them:
 *
 * - **containing-block**: the ancestor becomes the containing block of
 *   fixed-position descendants (CSS Transforms, Filter Effects, Containment
 *   and `will-change`), so the element is positioned and clipped relative to
 *   that ancestor. Undoing it would need either moving the node (which would
 *   remount the React component, so it is excluded) or reproducing every
 *   ancestor's transform, scroll offset and clip per frame, which is fragile.
 * - **clip**: the ancestor clips all of its descendants whatever their
 *   containing block (`clip-path`, masks).
 *
 * Such configurations are reported and refused rather than shown
 * misplaced: Native DOM never claims a fidelity it does not achieve, and is
 * never silently replaced by XR Adaptive. Observed browser behavior is
 * recorded in docs/p1-07a-native-compositor-hardening.md.
 */

export type ContainmentEffect = "containing-block" | "clip";

export interface ContainmentIssue {
  /** Short description of the ancestor (`div#id.class`). */
  readonly element: string;
  readonly property: string;
  readonly value: string;
  readonly effect: ContainmentEffect;
}

/** The computed style properties the analysis reads. */
export type StyleOf = (element: Element) => {
  getPropertyValue(property: string): string;
};

const tokens = (value: string) =>
  value
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);

/** Rules, each with the effect it has on fixed-position descendants. */
const RULES: readonly {
  readonly property: string;
  readonly effect: ContainmentEffect;
  readonly applies: (value: string) => boolean;
}[] = [
  { property: "transform", effect: "containing-block", applies: notNone },
  { property: "translate", effect: "containing-block", applies: notNone },
  { property: "rotate", effect: "containing-block", applies: notNone },
  { property: "scale", effect: "containing-block", applies: notNone },
  { property: "perspective", effect: "containing-block", applies: notNone },
  {
    property: "transform-style",
    effect: "containing-block",
    applies: (v) => v === "preserve-3d",
  },
  { property: "filter", effect: "containing-block", applies: notNone },
  { property: "backdrop-filter", effect: "containing-block", applies: notNone },
  {
    property: "will-change",
    effect: "containing-block",
    applies: (v) =>
      tokens(v).some((t) =>
        [
          "transform",
          "translate",
          "rotate",
          "scale",
          "perspective",
          "filter",
          "backdrop-filter",
        ].includes(t),
      ),
  },
  {
    property: "contain",
    effect: "containing-block",
    applies: (v) =>
      tokens(v).some((t) =>
        ["paint", "layout", "strict", "content"].includes(t),
      ),
  },
  {
    property: "content-visibility",
    effect: "containing-block",
    applies: (v) => v === "auto" || v === "hidden",
  },
  { property: "clip-path", effect: "clip", applies: notNone },
  { property: "mask-image", effect: "clip", applies: notNone },
];

function notNone(value: string) {
  return value !== "" && value !== "none";
}

export function describeElement(element: Element) {
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList]
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("");
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

/**
 * Issues of the ancestors from `from` (inclusive) up to `boundary`
 * (exclusive), nearest first. With a `null` boundary the viewport must be
 * the containing block, and every ancestor up to the root is checked.
 * Empty when the boundary is not an ancestor (nothing to composite
 * against) or nothing breaks containment.
 */
export function nativeContainmentIssues(
  from: Element | null,
  boundary: Element | null,
  styleOf: StyleOf = (element) => getComputedStyle(element),
): ContainmentIssue[] {
  if (!from || (boundary && !boundary.contains(from))) return [];
  const issues: ContainmentIssue[] = [];
  for (
    let node: Element | null = from;
    node && node !== boundary;
    node = node.parentElement
  ) {
    const style = styleOf(node);
    for (const rule of RULES) {
      const value = style.getPropertyValue(rule.property).trim();
      if (rule.applies(value))
        issues.push({
          element: describeElement(node),
          property: rule.property,
          value: value.length > 48 ? `${value.slice(0, 45)}…` : value,
          effect: rule.effect,
        });
    }
  }
  return issues;
}

/** One human-readable reason for a list of issues (empty: none). */
export function containmentReason(issues: readonly ContainmentIssue[]) {
  if (issues.length === 0) return "";
  const first = issues[0]!;
  const why =
    first.effect === "clip"
      ? "which clips every descendant"
      : "which captures the element's fixed positioning (it would be placed and clipped relative to that ancestor)";
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
  return `Native DOM is not supported here: ancestor ${first.element} has ${first.property}: ${first.value}, ${why}${more}. Use XR Adaptive, or remove that style.`;
}
