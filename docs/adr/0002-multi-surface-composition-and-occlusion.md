# ADR 0002 — Multi-Surface DOM composition and occlusion

- **Status:** Accepted for P1-08B, with one open blocker (interpenetrating Surfaces)
- **Amendment proposed:** [ADR 0003](0003-unified-depth-ownership.md) (P1-08A2)
  would replace rule 4 and the centroid occluder test with
  geometry-authoritative split regions. This ADR stays in force until 0003
  is accepted.
- **Date:** 2026-11-20
- **Context documents:** [`docs/p1-08a-multi-surface-architecture.md`](../p1-08a-multi-surface-architecture.md) §10, §14; evidence `docs/evidence/p1-08a/`

## Context

**How a Surface is drawn today:**

- Each Surface is live DOM transformed by a per-frame CSS `matrix3d`
  homography (`surfaceTransform`), drawn above the renderer's WebGL canvas.
- The homography maps every page to CSS z = 0. CSS therefore has no depth
  relation between two pages.
- Renderer-drawn (Adaptive) panels in front of a page are cut out of it with
  an even-odd `clip-path` (`occlusionClipPath`).
- Native DOM presentations remain descendants of their page, whose transform
  they cancel (`nativePanelTransform`).

**Lessons from earlier milestones:**

- P1-07C: a `path()` clip on a transformed page with 3D-transformed
  descendants was the dominant Native DOM cost. It is now written only when
  it cuts something.
- P1-07D: re-uploading canvas textures into a format with an expensive
  upload path is costly. That argues against texture-backed page
  representations for live content.

## Measured browser behavior

Two-Surface spike (`apps/xr-lab/e2e/multi-surface-spike.spec.ts`), run in
Chromium 159 and Firefox 159. It uses the SDK's real projection functions, a
WebGL canvas, and real mouse clicks.

| case                                                                                | observed (both browsers unless noted)                                                                                               |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S2 two overlapping page layers, farther one later in the DOM                        | The later layer is painted and hit **although it is farther**: CSS does not depth-test the planes.                                  |
| S3 same, with coordinator `z-index` by depth (painter's order)                      | Correct paint, hit and click.                                                                                                       |
| S4 interpenetrating pages, painter's order                                          | Correct on one side of the intersection, wrong on the other.                                                                        |
| S4b interpenetrating pages in one `preserve-3d` context with depth-encoded matrices | **Chromium:** split correctly, paint = hit. **Firefox:** paints one page over the other but hit-tests by depth, so **paint ≠ hit**. |
| S5 WebGL panel in front of a page, no hole                                          | The page hides the panel and takes its clicks.                                                                                      |
| S5 with an `occlusionClipPath` hole                                                 | Panel visible; clicks reach the canvas.                                                                                             |
| S6 Native element of Surface A in front of Surface B (B ordered above A)            | B covers it and takes its clicks (it is in A's stacking context).                                                                   |
| S6 with a hole in B for A's element (cross-surface occluder)                        | Visible and clickable.                                                                                                              |
| every asserted case                                                                 | Painted layer = `elementFromPoint` = click receiver.                                                                                |

## Options

- **O1 — independent CSS-transformed layers in DOM order:** wrong whenever DOM
  order ≠ depth order (S2).
- **O2 — coordinator-ordered layers:**
  - Per frame, sort Surface layers by depth (`z-index`, painter's order).
  - Cut cross-surface occluders where something of a lower layer is in
    front: Adaptive panels (already) and Native elements of other Surfaces
    (new).
- **O2b — a shared `preserve-3d` context with depth-encoded matrices:**
  correct in Chromium; in Firefox paint and hit-testing disagree (S4b).
- **O3 — texture-backed pages:** depth-correct in the renderer, but loses live
  DOM identity, input, accessibility, media/DRM and freshness. Upload cost
  (P1-07D) scales with page size.

## Decision

**O2 for P1-08B.**

**Rules:**

1. Each Surface keeps its own layer (`overflow: hidden`, canvas-sized), and
   its page keeps `surfaceTransform`.
2. The coordinator sorts layers far-to-near every frame by the Surface's
   depth along the camera's view direction (ties by surface id, then epoch)
   and writes `z-index` only when the order changes.
3. Each Surface's page clip receives, as `occluders`, every renderer panel
   and every Native footprint of _other_ Surfaces that lies in front of it.
   - The existing `occlusionClipPath` / `pageClipPath` path is reused.
   - P1-07C's rule stays: write a clip only when it cuts something.
4. **Interpenetrating Surfaces are not supported in P1-08B (blocker for
   arbitrary placement).**
   - The coordinator detects intersecting page rectangles.
   - It reports them as a composition issue (like `NativeIssues`), and the
     Workspace policy keeps Surfaces apart: minimum separation along the
     view direction, or rejecting a move that would intersect.
   - O2b is not adopted, because of the Firefox paint/hit mismatch.

**Not chosen:**

- **O3** may appear later as an explicit, non-interactive "snapshot" mode.
  It is never a substitute for live Native DOM.

## Consequences

- **Correct paint, hit and click** for non-intersecting Surfaces in both
  browsers, by construction tested in S3, S5 and S6.
- **Per-frame cost:**
  - A depth sort of S Surfaces: trivial.
  - Up to S × (panels + other Surfaces' Native footprints) occluder tests:
    the P1-07C cost centre.
  - P1-08B B6 must measure clip writes, clip loops and composite CPU per
    Surface (architecture doc §15).
- **A Native element of Surface A can only appear above Surface B** through
  a hole in B. That is a `path()` clip on B when B has Native descendants
  itself, the expensive kind. Mitigations to measure in B6:
  - Polygon clips when B has no Native descendants (as in S6).
  - Ordering by the nearest content depth when that alone resolves the
    overlap.
- **Interpenetration stays an open decision** for P1-08B and later:
  - per-Surface clip splitting along the intersection line, or
  - the O2b path once Firefox's hit-testing matches its painting (re-test
    with the spike).
