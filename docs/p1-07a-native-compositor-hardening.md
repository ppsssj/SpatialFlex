# P1-07A Native DOM and Spatial Compositor Hardening

Status: **stabilization of existing behavior.** No new spatial features. Follow-up to P1-06 ([spatial web surface](spatial-web-surface.md)), P1-06A ([Native DOM extraction](native-dom-spatial-extraction.md)) and P1-06B ([spatial panel manipulation](spatial-panel-manipulation.md)).

Baseline: `main` at `633570faa348bfaf63b7a5e8324ae357f0206946` (PR #27 merged). It had 338 unit/integration tests and 304 browser E2E tests passing (Three.js and Babylon.js, Chromium and Firefox).

## 1. Baseline state and limitations

What the baseline already guarded:

| Area                        | Existing safeguard                                                            | Gap found                                                                               |
| --------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| DOM identity                | Element never moved, cloned or remounted; E2E compares node references        | Covered only for the dashboard's plain layout                                           |
| Containing block            | Assumed: the surface page (transformed) is the fixed panel's containing block | Never checked. Any ancestor that captures fixed positioning breaks it silently (§3, D1) |
| Style cleanup               | `release()` removed `transform`, `clip-path` and `visibility` on restore      | Removed values it no longer owned (§3, D2)                                              |
| Native handle binding       | Listeners keyed by the native item **id list**                                | Stale when the element changed under an unchanged id list (§3, D3)                      |
| Compositor element tracking | Elements released when their id left the list                                 | A replaced element kept its transform forever (§3, D3)                                  |
| Input                       | P1-06B: real mouse drag, Escape, pointercancel and blur, keyboard steps       | Not exercised with real form controls, nested targets or Tab order                      |
| Occlusion                   | Plane-level centroid test; page clip united with native footprints            | Hit testing not checked against XR-in-front and back-facing cases                       |

Compatibility before this work, measured on the hardening fixture with real extraction (placement error = bounding box against the renderer's projection; hits = 5 interior points via `elementFromPoint`):

| Ancestor of the extracted component                                                                                                                                 | Chromium                          | Firefox                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------- |
| Plain flow, scroll container edge, `overflow: hidden` / `clip` edge, absolute + sticky, stacking context (`z-index`), `opacity: .85`, `container-type: inline-size` | 0.2 px, 5/5                       | 0.2 px, 5/5                  |
| `transform`                                                                                                                                                         | **178 px off, 0/5**               | **179 px off, 0/5**          |
| `filter`                                                                                                                                                            | **282 px off, 0/5**               | **282 px off, 0/5**          |
| `will-change: transform`                                                                                                                                            | **228 px off, 0/5**               | **228 px off, 0/5**          |
| `contain: paint`                                                                                                                                                    | **227 px off, 0/5, clipped**      | **227 px off, 0/5, clipped** |
| `clip-path`                                                                                                                                                         | 0.2 px but **0/5 (clipped away)** | same                         |

In every broken case the element was still reported as placed (`data-spatial-placed`), and its controls stayed clickable at the wrong position.

## 2. CSS/DOM compatibility matrix

The fixture is `?fixture=hardening`: every case wraps the same small component in plain application CSS. The browser columns are verified in Chromium and Firefox by `e2e/hardening-css.spec.ts`. The containing-block and clip behavior of each property is checked against the browser itself by the rule test.

| Configuration                                                                              | Classification                                                                  | Behavior                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Plain flow                                                                                 | SUPPORTED                                                                       | Placed within 2 px; 5/5 hits; real click fires once                                                                |
| Scroll container, component straddling its edge                                            | SUPPORTED                                                                       | Not clipped (the scroller is not in the containing-block chain); scroll position preserved through extract/restore |
| `overflow: hidden` / `overflow: clip`, component partly outside                            | SUPPORTED                                                                       | Not clipped, for the same reason                                                                                   |
| Absolute inside sticky inside relative                                                     | SUPPORTED                                                                       | Fixed positioning ignores these ancestors                                                                          |
| Stacking context (`position: relative; z-index: 1`), `isolation`                           | SUPPORTED (tested config)                                                       | Painted and hit-tested over the page. See §6 for the untested z-order case                                         |
| Translucent ancestor (`opacity < 1`)                                                       | SUPPORTED                                                                       | Placement correct; the opacity applies to the panel, as in the original page                                       |
| `container-type: inline-size` / `size`                                                     | SUPPORTED                                                                       | Not a containing block for fixed elements in either browser (measured)                                             |
| Interactive form (inputs, textarea, select, nested targets, subscription, dynamic height)  | SUPPORTED                                                                       | §4, input and focus                                                                                                |
| `transform`, `translate`, `rotate`, `scale`, `perspective`, `transform-style: preserve-3d` | UNSUPPORTED / DOCUMENTED, diagnosed (FIXED: was silently misplaced)             | Native DOM is refused with the reason                                                                              |
| `filter`, `backdrop-filter`, `will-change: transform/filter/…`                             | UNSUPPORTED / DOCUMENTED, diagnosed (FIXED: was silently misplaced)             | Same                                                                                                               |
| `contain: paint/layout/strict/content`, `content-visibility: auto`                         | UNSUPPORTED / DOCUMENTED, diagnosed (FIXED: was silently misplaced and clipped) | Same                                                                                                               |
| `clip-path`, `mask-image`                                                                  | UNSUPPORTED / DOCUMENTED, diagnosed (FIXED: was silently invisible)             | Same                                                                                                               |
| Any of the above **added after** extraction                                                | Diagnosed at runtime (containing block); see §6 for clipping                    | Hidden, marked and reported; recovers when removed                                                                 |
| Browser zoom                                                                               | BLOCKED for automation                                                          | §7, manual verification                                                                                            |

Why the unsupported cases are not fixed by an inverse transform: once an ancestor is the containing block, the element is laid out and clipped relative to that ancestor. Undoing it needs either:

- moving the node out (a remount, which is excluded), or
- reproducing every ancestor's transform, transform origin, scroll offset, border and clip per frame.

The second option is fragile, and a clip cannot be undone by any transform. So these cases are refused with a diagnostic, instead of approximated.

## 3. Reproduced defects and root causes

**D1. Native DOM silently misplaced or clipped by ancestor CSS.**

- _Cause:_ the compositor's math assumes the page is the fixed element's containing block. Transform, filter, `will-change`, containment and `content-visibility` ancestors become that block instead, and `clip-path`/mask ancestors clip every descendant.
- _Reproduction:_ measured in the table in §1.

**D2. Restore removed styles it no longer owned.**

- _Cause:_ `release()` removed inline `transform`, `clip-path` and `visibility` unconditionally. Suppose a native extraction ends and an XR Adaptive one with the source _reserved_ begins in one commit; that is the lab API's direct switch, `lab.extract(id, {presentation: "adaptive"})`. React commits the SDK's `visibility: hidden` for the reserved source, then the compositor's layout effect removes it. A source that must be hidden became visible.
- _Reproduction:_ `src/evaluation/hardening.test.tsx`, which renders the real `LabShell`, integration and compositor.

**D3. Element replaced under an unchanged id list.**

- _Cause:_ `useNativeHandles` and the compositor's release keyed only on the item id list.
  - If the element changed while the list stayed equal (for example a re-keyed component that is extracted again in the same commit), listeners stayed on the old element and the new one was unbound.
  - The compositor kept the old element's `matrix3d` and never released it.
- _Reachability:_ not reachable through the lab's UI, where ids change across separate commits. It is reachable through the lab API.
- _Reproduction:_ the same test file.

**Not product defects.** These came up while writing the tests:

- A fixture form wider than the canvas was clipped by the layer, which is by design.
- One window `pointerup` listener is Playwright's own injected hit-target interceptor; the listener counter now excludes it.

## 4. Implementation changes and rationale

**Style ownership** (`useSurfaceCompositor.ts`, `styles.css`):

- The compositor no longer writes inline `visibility`. It sets `data-spatial-visibility`, styled by the surface stylesheet, so React's own inline visibility is never touched.
- `transform` and `clip-path` are removed only while they still hold the value the compositor left (serialized by the browser). A value another owner set is kept.

**Element tracking:**

- The compositor releases every element that is not the current element of a native id in the latest frame.
- `useNativeHandles` binds to the resolved elements (and the manipulation), compared after each render, instead of the id list. The binding code itself is unchanged.

**Containment diagnostics** (`nativeContainment.ts`, `SpatialWebSurface.tsx`, compositor):

- One rule table, verified against both browsers.
- **Before extraction:** the selected component's ancestors are checked when it is picked and again right before extracting. Native DOM is shown as unsupported, with the ancestor, property, value and reason. Nothing is switched to XR Adaptive automatically.
- **At runtime:**
  - The compositor reads the browser's own containing block (`offsetParent`) every frame. Layout is already flushed by the existing `offsetWidth` read, so this costs nothing extra.
  - Ancestor styles are walked once when compositing starts.
  - A non-compositable element is hidden, so it takes no input at a wrong position, marked `data-spatial-issue`, and reported (`surface-native-issue`). It recovers when the style is removed.
  - It stays a Native DOM extraction until the user restores it.

**Public API:** unchanged. `@spatialflex/core` and `@spatialflex/react` are untouched; all changes are in the lab's compositor, a test fixture, styles and tests. `SpatialManipulator` remains renderer-neutral and its P1-06B semantics are unchanged.

## 5. Regression tests added

Totals on this branch: **372 unit/integration** tests (338 existing + 34 new) and **330 browser E2E** tests: 38 Playground and 292 XR Lab (304 existing + 26 new). All pass locally; the existing tests and their tolerances are unchanged.

Unit/integration (Vitest):

- `src/evaluation/hardening.test.tsx` (3): D2 and D3, in a real React tree (`LabShell` with a stub same-document host reporting Three.js camera frames).
- `src/surface/nativeContainment.test.ts` (31): every rule, non-breaking properties, ordering, reasons, boundaries.

Browser E2E (Playwright, Chromium and Firefox; the per-engine tests run for both Three.js and Babylon.js):

- `e2e/hardening-css.spec.ts`:
  - The CSS/DOM matrix: placement within 2 px, 5/5 hits, a real click fires once, footprint and CSS width unchanged, identity, state, surroundings untouched, no residue after restore; diagnosed cases refused with the reason.
  - Runtime detection of a style added after extraction.
  - Pose and layout stability: viewport resize, page and inner scroll, content height change, spatial resize without CSS reflow (a `ResizeObserver` sees no change), camera orbit and reset.
  - Browser truth of all 27 containment rules (engine-independent).
- `e2e/hardening-interaction.spec.ts`:
  - **Real controls after move, rotate and resize:** buttons fire once; nested targets each fire once; inputs, textarea and select keep and edit their values; typing and caret keys never manipulate; pressing a control never starts a session; Tab/Shift+Tab order through handles and content; keyboard Escape/Enter; Escape mid-drag; one delegated listener per type while extracted and none after restore; same nodes, mounts and subscriptions.
  - **Occlusion and hit testing:** native over the page; page moved in front (covers it, takes input); XR panel in front (cut out, the renderer picks the XR button through it); native in front of the XR panel (takes the click, the XR action does not run); rotation toward the back-facing boundary (hit-tested while facing, hidden and inert past it, restored by Reset); two native panels plus an XR panel stay independent.
  - **Lifecycle stress:** 4 cycles of native (commit, cancel) → restore → adaptive (drag) → restore, plus drags interrupted by a presentation switch, a component unmount and host disposal. Each checks unique presentation instances, start poses, window listeners at baseline, subscriptions, mounts and node identity, and that the camera responds afterwards.

## 6. Remaining unsupported scenarios

- The ancestor configurations classified UNSUPPORTED in §2. Use XR Adaptive, or move the style off the component's ancestors.
- A `clip-path`/mask added to an ancestor **after** extraction is not detected until the next extraction. The per-frame check covers containing-block changes only, since a full style walk per frame would cost too much.
- **Z-order inside an ancestor stacking context:** a native panel inside an ancestor stacking context whose `z-index` is lower than overlapping, later page content can paint under that content. This needs full stacking analysis, and is not diagnosed. The tested configuration (`z-index: 1`) works.
- **Occlusion is decided per plane, not per pixel:** an XR panel either cuts out of a native panel (its centroid is in front of the native plane) or not. Intersecting planes are not resolved.
- **Page under the native footprint** (from reading `pageClipPath`, not reproduced in a test): where an XR panel is in front of both the page and a native panel and overlaps the page box, the page clip keeps the native footprint, so page content may show there instead of the XR panel. Reaching this configuration needs a strong camera orbit.
- A native panel rotated past its back-facing boundary is hidden and cannot be grabbed again; use **Reset transform** in the inspector.
- IME/composition input was not automated: Playwright cannot drive an OS IME faithfully in Chromium and Firefox. The handles react only to keydown on the handle elements themselves (`event.target === handle`), so composition inside fields cannot reach them by construction; see §7 for manual verification.
- A native `select` popup is opened with `selectOption`, which sets the value and dispatches the input events; its OS popup is not automatable.
- The manipulator's native extent is fixed at extraction (`setExtent` is never called). Only its width is used (rotation radius), and the CSS width of a native panel cannot change while it is extracted, so this has no effect today.

## 7. Manual verification

```bash
pnpm install --frozen-lockfile
pnpm --filter @spatialflex/xr-lab dev --host 127.0.0.1 --port 5173 --strictPort
```

1. Open http://127.0.0.1:5173/?integration=spatialflex&engine=three&bridge=off&surface=website&fixture=hardening (also `engine=babylon`).
2. **Supported case:** Select elements → _Plain flow_ → Native DOM → Extract. It appears beside the page, and its button counts clicks.
3. **Diagnosed case:** Select _Transformed ancestor_. Native DOM is disabled, and the orange line names `div.hz-wrap.hz-transform` and `transform`.
4. **Input and focus:** Extract _Interactive form_ as Native DOM; move, rotate and resize it. Type in each field, use Tab, and click Card and Inner. Values and counters change exactly as typed and clicked.
5. **IME:** in that form, use an IME (for example Korean 2-beolsik): compose in **Controlled** and **Notes**, including arrow keys during composition. The panel must not move, and the text must commit normally.
6. **Browser zoom:** set the zoom to 80%, 125% and 150% (Ctrl +/−) with a native panel extracted. After each change the panel must stay attached to its world pose: it moves with the page when you orbit, its controls stay clickable, and Reset view restores the view. Device-scale-factor emulation is **not** a substitute and was not used as evidence.

## 8. CI evidence

The final remote run is linked in the PR. Local evidence:

- `docs/evidence/p1-07a/css-matrix-{chromium,firefox}.json`: per engine, each case's classification and diagnostic; the browser's answer for each containment rule.
- `docs/evidence/p1-07a/interaction-{chromium,firefox}.json`: occlusion hit results, lifecycle instances and listener baselines.
- `docs/evidence/p1-07a/d1-transformed-ancestor-{before,after}.{png,json}`: D1 on the transformed-ancestor case, Three.js, Chromium.
  - **Before:** a build of the fixture without the fixes (`ab49038`). The panel is reported as placed but lies 215 px from its pose, mostly outside the canvas; the expected area (dashed red, drawn by the capture) hit-tests to the canvas.
  - **After:** this branch. Native DOM is disabled with the diagnostic. The JSON holds the measured geometry; the screenshots are illustrations, not the pass criteria (those are the E2E assertions).
