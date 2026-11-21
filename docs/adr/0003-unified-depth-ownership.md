# ADR 0003: Geometry-authoritative depth ownership for intersecting Surfaces

- **Status:** Proposed (P1-08A2, issue #42). Needs review before P1-08B.
- **Date:** 2026-11-21
- **Amends:** [ADR 0002](0002-multi-surface-composition-and-occlusion.md).
  Its rule 4 ("interpenetrating Surfaces are not supported") and its
  centroid-based occluder test would be replaced. Its layer model and its
  "clip only when it cuts" rule stay.
- **Evidence:** [`docs/p1-08a2-unified-depth-feasibility.md`](../p1-08a2-unified-depth-feasibility.md)
  and `docs/evidence/p1-08a2/`.

## Context

ADR 0002 orders Surface layers by depth (`z-index`) and rejects layouts
where Surfaces intersect.

P1-08A2 measured two candidate mechanisms in real browsers (Chromium 159,
Firefox 159), using real mouse and keyboard input, on two independently
mounted React roots that cross in an X:

- **Native HTML-in-Canvas (Chromium only).**
  - WebGL depth makes the pixels correct.
  - The browser hit-tests drawable elements in one global order: the order
    of `updateElementGeometry` calls, not depth. On the side where the
    earlier-registered Surface is in front, the click goes to the wrong
    Surface.
  - Reordering cannot express a crossing, because which Surface is on top
    differs by region.
  - A `canvasClip` rectangle is honored, but a rectangle cannot describe a
    split region.
- **Depth-aware DOM composition (all browsers).**
  - CSS layer order paints the crossing wrongly on one side. It is wrong
    in a consistent way: what is painted is also what receives the click.

In both mechanisms, the fix that made all three agree (visible owner =
depth owner = interaction owner) was the same: clip each participant to
the region where it is the geometric depth owner. Those regions are
computed by a renderer-neutral resolver from the P1-08A coordinate
contract.

## Decision (proposed)

### 1. Ownership is decided by geometry

- A renderer-neutral **depth resolver** computes, per frame, the visible
  region of every participant: Surface pages, Native elements and Adaptive
  panels.
- A participant T's visible region is its rectangle minus the union of
  the parts of other planes that lie on the eye's side of T's plane,
  projected onto T.
- Regions are disjoint convex pieces in T's CSS pixels.
- The same resolver answers "who owns this ray" for the `InputRouter`.

### 2. Every rendering adapter applies the same regions

- **DOM compositor** (default, every browser):
  - Each page and each Native element gets `clip-path: path(nonzero, …)`
    built from its pieces.
  - A page keeps the visible footprint of its own extracted Native
    descendants.
  - `z-index` order remains only a tie-breaker.
- **HTML-in-Canvas** (optional, Chromium 157+, when detected):
  - WebGL depth paints.
  - The same clips restrict each drawable's hit region.

### 3. Occluder tests are per region, not per centroid

ADR 0002's rule ("the occluder's centroid is in front of the page") is
replaced by clipping each occluder to the page's eye-side half-space.

### 4. Holes are not even-odd loops

- Visible pieces are emitted as disjoint same-orientation loops under
  `nonzero`.
- Overlapping occluders would otherwise toggle back to visible (even-odd)
  or wind to −1 (nonzero).

### 5. Scope

- Planar rectangles only.
- Curved or non-planar content and arbitrary meshes are out of scope.

## Consequences

- **Lifted restriction:** intersecting Surfaces become supported for
  planar content. ADR 0002's rule 4 restriction is lifted once P1-08B
  implements this rule.
- **Clip cost (the P1-07C cost centre):**
  - Clips change whenever a pose or the camera changes, so this is the
    cost centre P1-07C identified.
  - P1-08A2 measurements are in the feasibility document §12. P1-08B must
    re-measure on hardware.
- **Seam:** pieces meet exactly on the projected intersection line.
  Anti-aliased edges can show a sub-pixel seam. A ≥ 0.5 px overlap policy
  is an open item.
- **Keyboard focus is not occlusion-aware:** Tab can still focus a fully
  hidden control. This is unresolved (§17 of the feasibility document).
- **Three.js integration** needs either r188+ (upstream PR #34732,
  unmerged at the time of writing) or the measured `ExternalTexture`
  adapter pattern.
- **Babylon.js 9.36 `HtmlInteractionManager`** uses screen-aligned affine
  hit quads and DOM order. It is not depth-correct for oblique or crossing
  planes, so a SpatialFlex Babylon path must drive the hit regions itself.
