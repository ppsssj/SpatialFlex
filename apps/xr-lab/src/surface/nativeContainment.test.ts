// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  containmentReason,
  describeElement,
  nativeContainmentIssues,
  type StyleOf,
} from "./nativeContainment";

/** Computed styles from a table (jsdom has no full cascade). */
const stylesFrom =
  (table: Map<Element, Record<string, string>>): StyleOf =>
  (element) => ({
    getPropertyValue: (property) => table.get(element)?.[property] ?? "",
  });

function tree() {
  const page = document.createElement("div");
  const outer = document.createElement("section");
  outer.className = "outer card";
  const inner = document.createElement("div");
  inner.id = "wrap";
  const slot = document.createElement("div");
  page.append(outer);
  outer.append(inner);
  inner.append(slot);
  return { page, outer, inner, slot };
}

describe("Native DOM containment diagnostics", () => {
  it("reports nothing for plain ancestors, and stops at the page", () => {
    const { page, outer, slot } = tree();
    const styles = new Map([
      [outer, { transform: "none", filter: "none", contain: "none" }],
      // The page itself is transformed: it is the intended containing block.
      [
        page,
        {
          transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
        },
      ],
    ]);
    expect(nativeContainmentIssues(slot, page, stylesFrom(styles))).toEqual([]);
  });

  it.each([
    ["transform", "matrix(1, 0, 0, 1, 6, 4)", "containing-block"],
    ["translate", "6px 4px", "containing-block"],
    ["rotate", "2deg", "containing-block"],
    ["scale", "1.1", "containing-block"],
    ["perspective", "800px", "containing-block"],
    ["transform-style", "preserve-3d", "containing-block"],
    ["filter", "drop-shadow(0 2px 2px #0004)", "containing-block"],
    ["backdrop-filter", "blur(2px)", "containing-block"],
    ["will-change", "opacity, transform", "containing-block"],
    ["will-change", "filter", "containing-block"],
    ["contain", "paint", "containing-block"],
    ["contain", "layout style", "containing-block"],
    ["contain", "strict", "containing-block"],
    ["content-visibility", "auto", "containing-block"],
    ["clip-path", "inset(0 round 8px)", "clip"],
    ["mask-image", "linear-gradient(black, transparent)", "clip"],
  ] as const)("%s: %s → %s", (property, value, effect) => {
    const { page, inner, slot } = tree();
    const styles = new Map([[inner, { [property]: value }]]);
    expect(nativeContainmentIssues(slot, page, stylesFrom(styles))).toEqual([
      { element: "div#wrap", property, value, effect },
    ]);
  });

  it.each([
    ["will-change", "opacity"],
    ["will-change", "auto"],
    ["contain", "style"],
    ["contain", "size"],
    ["content-visibility", "visible"],
    ["transform-style", "flat"],
    ["container-type", "inline-size"],
    ["opacity", "0.85"],
    ["isolation", "isolate"],
    ["overflow", "hidden"],
    ["overflow", "clip"],
    ["position", "sticky"],
  ])("%s: %s does not break containment", (property, value) => {
    const { page, inner, slot } = tree();
    const styles = new Map([[inner, { [property]: value }]]);
    expect(nativeContainmentIssues(slot, page, stylesFrom(styles))).toEqual([]);
  });

  it("lists every issue, nearest ancestor first, and explains the first", () => {
    const { page, outer, inner, slot } = tree();
    const styles = new Map([
      [inner, { "clip-path": "circle(50%)" }],
      [outer, { filter: "blur(1px)" }],
    ]);
    const issues = nativeContainmentIssues(slot, page, stylesFrom(styles));
    expect(issues.map((i) => [i.element, i.effect])).toEqual([
      ["div#wrap", "clip"],
      ["section.outer.card", "containing-block"],
    ]);
    expect(containmentReason(issues)).toMatch(
      /^Native DOM is not supported here: ancestor div#wrap has clip-path: circle\(50%\), which clips every descendant \(\+1 more\)\. Use XR Adaptive/,
    );
    expect(containmentReason([])).toBe("");
  });

  it("is empty outside the page and abbreviates long values", () => {
    const { page, inner, slot } = tree();
    expect(
      nativeContainmentIssues(document.createElement("div"), page),
    ).toEqual([]);
    expect(nativeContainmentIssues(null, page)).toEqual([]);
    const long = `matrix(${"1.23456789, ".repeat(6)}0)`;
    const [issue] = nativeContainmentIssues(
      slot,
      page,
      stylesFrom(new Map([[inner, { transform: long }]])),
    );
    expect(issue!.value).toHaveLength(46);
    expect(issue!.value.endsWith("…")).toBe(true);
    expect(describeElement(page)).toBe("div");
  });
});
