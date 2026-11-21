# P1-08A2: Unified depth compositing feasibility

**Status:** research milestone (issue #42). It produces evidence and a
proposed architecture ([ADR 0003](adr/0003-unified-depth-ownership.md)). It
is **not** a production Multi-Surface feature and changes no public SDK API.

**Baseline:** main `fd719e6` (P1-08A merged): 452 unit/integration tests,
398 browser E2E tests, package smoke.

**Browsers:**

| Browser             | Version      | Headless renderer | Headed renderer       |
| ------------------- | ------------ | ----------------- | --------------------- |
| Playwright Chromium | 159.0.8154.6 | SwiftShader       | NVIDIA GT 710 (D3D11) |
| Playwright Firefox  | 159.0        | —                 | —                     |

Firefox's renderer string is privacy-masked ("GTX 480 … or similar") in both
modes, so its GPU is not identified.

**Hardware:** a Windows 11 workstation. Software WebGL is not representative
of hardware XR, and no headset was used.

## 1. Executive summary

**The question:** can SpatialFlex keep live React DOM, native browser
interaction and correct 3D occlusion at the same time when two web Surfaces
physically intersect (an "X")?

**Verified results** (real mouse and keyboard input; four independent
observations per probe):

1. **Chromium 159 ships the stable HTML-in-Canvas API.** It has
   `content="drawable"`, `paint`, `texElementSubImage2D` and
   `updateElementGeometry`. It does not have `texElementImage2D`. Firefox 159
   has none of it.
2. **Three.js r187's `HTMLTexture` silently fails on Chromium 159.** It tests
   for `texElementImage2D`, so it never adopts the element, never uploads,
   and renders black planes. No error is reported.
3. **Babylon.js 9.36 renders correctly on the current API.** Its
   `HtmlInteractionManager` hit-tests a screen-aligned affine quad in DOM
   order, so it misroutes on oblique and crossing planes.
4. **Native HTML-in-Canvas gets pixels right but not ownership.** WebGL depth
   makes the pixels correct. The browser, however, hit-tests drawables in one
   global order (the most recent `updateElementGeometry` call wins), never by
   depth. On the side of the crossing where the earlier-registered Surface is
   visible, the click goes to the other Surface:
   - _visible owner ≠ interaction owner_.
   - Reordering cannot represent a crossing.
   - A `canvasClip` rectangle is honored, but a rectangle cannot describe a
     split region.
5. **The depth-aware DOM baseline (ADR 0002 `z-index` order) is consistent
   but wrong.** It paints one side of the crossing wrongly, but what is
   painted is also what is clicked:
   - _depth owner ≠ visible owner = interaction owner_.
   - Its centroid occluder test also fails when a Native element or an
     Adaptive panel crosses a page.
6. **One shared fix satisfies the invariant in every tested scenario, on
   both tracks and in both browsers.** A renderer-neutral depth resolver
   computes each plane's depth-owner region from the P1-08A coordinate
   contract, as disjoint convex pieces, and each track applies the regions as
   `clip-path`:
   - In the DOM compositor, the clips cut both pixels and hit-testing.
   - In HTML-in-Canvas, the clips restrict hit regions while WebGL depth
     paints.

   Result: _visible owner = intended depth owner = interaction owner_, for
   every probe away from an ownership boundary.

7. **React state and DOM identity are preserved.** This holds both for roots
   mounted directly into a drawable canvas and for already-mounted pages moved
   into one. Removal during a gesture delivers no stale action.
8. **Cost:** while poses move, the split clips change every frame.
   - DOM compositor: about 120–225 clip writes/s.
   - HTML-in-Canvas: every clip change forces a re-capture and upload of the
     page (headless: 116 uploads/s, 14 Mpx/s; headed: 207/s, 25 Mpx/s,
     versus 20/s without clips).
   - It stays inside the frame budget for two 400×300 pages. It is the
     P1-07C cost centre and grows with page count and size.

**Recommended direction ([ADR 0003](adr/0003-unified-depth-ownership.md), proposed):**

- **Geometry-authoritative ownership** (Design 2) is the contract.
- **The DOM split compositor** is the default renderer path.
- **HTML-in-Canvas** is an optional Chromium path that consumes the same
  regions.

**Limitations of the result:** it holds for **planar rectangles** only.
Native HTML-in-Canvas works for **pages the app mounts or moves into the
canvas**, which is not arbitrary webpages.

## 2. Browser capability matrix

These results come from feature detection (`detectHtmlInCanvas()`), not from
user-agent strings. They are recorded in `results-*.json` by the capability
E2E test.

| Feature                                                           | Chromium 159                       | Firefox 159 |
| ----------------------------------------------------------------- | ---------------------------------- | ----------- |
| `canvas.content === "drawable"` after setting the attribute       | ✅                                 | ❌          |
| `requestPaint()`, `onpaint`, `paint` event with `changedElements` | ✅                                 | ❌          |
| `getElementImageDefaultSize()`                                    | ✅                                 | ❌          |
| `captureElementImage()`                                           | ✅ (see the `ElementImage` row)    | ❌          |
| `ElementImage.width/height` (documented in Chrome's guide)        | ❌ only `close()`                  | ❌          |
| WebGL2 `texElementSubImage2D()`                                   | ✅                                 | ❌          |
| WebGL2 `texElementImage2D()` (pre-157 name)                       | ❌                                 | ❌          |
| `updateElementGeometry()` / `clearElementGeometry()`              | ✅                                 | ❌          |
| `updateElementGeometry({ canvasClip })`                           | honored; semantics unclear (§4.4)  | ❌          |
| `getElementTransform()`                                           | ✅                                 | ❌          |
| 2D `drawElementImage()`                                           | ✅                                 | ❌          |
| WebGPU `drawElementImageToTexture`                                | not tested (no WebGPU in this run) | ❌          |
| `layoutSubtree` property (pre-157)                                | ❌                                 | ❌          |
| CSS `matrix3d`, `clip-path: path(nonzero, …)`                     | ✅                                 | ✅          |

**Two documentation discrepancies:**

- **`ElementImage` size:** Chrome's WebGL guide sizes textures from
  `captureElementImage().width/height`. In Chromium 159 these properties do
  not exist, so the size is `NaN`. Babylon's typings mark them "removed from
  the proposal". Size must come from `getElementImageDefaultSize()`.
- **Origin-trial note:** the "interactive content in 3D scenes" guide still
  says the feature is in an origin trial. The blog says it is stable in
  Chrome 157. Chromium 159 exposes it without a flag or token.

**Not used:** `layoutsubtree`, `texElementImage2D` and the old WebGPU names.

## 3. Three.js 0.187 compatibility

**Installed source:** `three/src/renderers/webgl/WebGLTextures.js`, around
lines 1319–1383:

```js
} else if ( texture.isHTMLTexture ) {
  if ( 'texElementImage2D' in _gl ) {          // false on Chromium 157+
    … canvas.setAttribute( 'layoutsubtree', 'true' ); canvas.appendChild( image ); …
    _gl.texElementImage2D( … );
  }
}                                               // else: nothing, no warning
```

The same guard exists in `webgl-fallback/utils/WebGLTextureUtils.js`.

**What the stock path does on Chromium 159**, tested with
`new HTMLTexture(element)` plus the r187 `InteractionManager`, exactly as
documented:

- The canvas never receives `layoutsubtree` or `content`, and the element
  never becomes a canvas child.
- Nothing is uploaded. The planes render black (pixel `[0,0,0,255]`, in the
  `s3-three-stock-*` screenshots).
- No error or warning appears.
- The r187 `InteractionManager` writes CSS `matrix3d` to the elements. It
  does not call `updateElementGeometry`, and because the elements are not in
  the canvas, nothing is interactive.
- Evidence: test "Three.js r187 stock HTMLTexture does not upload with the
  stable API".

**Upstream:** mrdoob/three.js PR #34732 ("Support the Chromium 155+
HTML-in-Canvas API changes").

- It switches to `content="drawable"`, a `drawable` child,
  `getElementImageDefaultSize`, mutable `texImage2D` storage and
  `texElementSubImage2D`.
- Its `InteractionManager` calls `updateElementGeometry` with the MVP as the
  `canvasTransform`.
- It was **open and unmerged** when checked (2026-11-21). The milestone is
  r188, and the PR is blocked on the `three-html-render` polyfill fallback.

**Research adapter** (`src/research/unified-depth/threeTrack.ts`, mode
`adapter`):

- **No renderer patching and no dependency change.**
  - The page owns a `WebGLTexture`.
  - It uploads with `texElementSubImage2D` in the canvas `paint` event, only
    for `changedElements`.
  - It passes the texture to Three.js through the public `THREE.ExternalTexture`.
  - It calls `renderer.resetState()` after its raw GL calls.
  - It calls `updateElementGeometry` with
    `viewport · projection · view · mesh.matrixWorld · elementToPlane`.
- **Colour caveat:** r187 ignores `colorSpace` on an `ExternalTexture`, which
  makes page colours look washed out. The adapter sets
  `outputColorSpace = LinearSRGBColorSpace`, which is acceptable only because
  this scene is unlit.
  - The alternative is `SRGB8_ALPHA8` storage. That is the slow upload format
    P1-07D measured.
  - A production integration needs r188+ or a deliberate colour policy.
- **Result:** depth-correct pixels, and the same hit-order problem as raw
  WebGL (§4). With geometric hit clips there are zero mismatches (§11).

**Verdict:** stock r187 is **BLOCKED** on Chromium 157+. The narrow adapter
is **FEASIBLE**, as research code.

## 4. Native WebGL HTML-in-Canvas experiment (Track A)

### 4.1 Minimal proof (A1)

The minimal proof used raw HTML and WebGL2: a `<canvas content="drawable">`
with two `drawable` div children. Each frame:

1. The `paint` event fires.
2. Each changed child is uploaded with `texElementSubImage2D` into mutable
   `texImage2D(RGBA8)` storage, sized by `getElementImageDefaultSize`.
3. Two textured quads cross in an X, drawn into one depth buffer.
4. `updateElementGeometry(el, { canvasTransform: viewport · VP · model })` is
   called for each child.

**Results:**

- The texture is uploaded upright (row 0 = top of the element).
- The rendered pixels show the crossing correctly. They come from the WebGL
  draw: there is no HTML overlay, and the drawables are not visible as CSS
  boxes.

The research page (`research-depth.html?track=hic`) is the formalized
version, using real React roots.

### 4.2 Hit-testing order (A2): measured, not depth-based

These are exploratory micro-experiments, using real clicks and
`elementFromPoint`:

| Experiment                                           | Result                                                                                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register A then B; click where A is visibly in front | B receives it (43 of 135 probes misrouted)                                                                                                                                                     |
| Register B then A                                    | A receives it where B is in front (34 of 135 misrouted)                                                                                                                                        |
| `preserveHitTestOrder: true`                         | Order = DOM order (B after A) → same as the first row                                                                                                                                          |
| `canvasTransform` carrying clip-space z (depth)      | Ignored for ordering                                                                                                                                                                           |
| `updateElementGeometry(A)` outside `paint`           | A moves to the top. `elementFromPoint` changes only after the next real pointer event at that position; the press can then reach A                                                             |
| Same, with a continuous `requestPaint` loop          | Same lag                                                                                                                                                                                       |
| Reorder on `pointermove` to the geometric owner      | 43 → 9 misroutes. The remaining 9 are the first press after an ownership change: pointerdown is hit-tested with the old order and pointerup with the new one, so the click lands on the canvas |
| `clip-path` on each drawable from the depth resolver | **0** misroutes away from the intersection line (`hit=clip`)                                                                                                                                   |

**Conclusion:**

- In Chromium 159, the drawable hit order is a single global stack of
  elements. A crossing needs region-dependent ownership, which a global stack
  cannot express.
- Clipping each drawable to its depth-owner region works, because the
  browser respects `clip-path` in hit-testing.

### 4.3 Real interaction (A2)

All verified with Playwright mouse and keyboard; no synthetic events:

- Button activation; focus and typing in two controlled inputs (one per
  Surface); double-click word selection in an input.
- Keydown targets are the focused inputs only.
- Clicks on both sides of the intersection.

Test: "real keyboard, focus, typing and text selection reach drawable DOM".

### 4.4 `canvasClip`

- **Honored:** an empty rectangle removes the element from hit-testing (every
  probe went to the canvas).
- **Coordinate space unclear:** a bounding rectangle of the depth-owner
  region, given either in element space or in canvas space, did **not**
  reproduce the expected region. The coordinate space is not documented in
  Chrome's guides.
- **Too limited:** even with the space resolved, a rectangle cannot express
  general split regions.
- This is recorded as an open question (§17), not a path forward.

### 4.5 Native element as a nested drawable

A's extracted Native element:

- stays in A's React tree (same DOM node);
- is marked `drawable` inside A's drawable host;
- gets its own capture, upload, quad and `updateElementGeometry`.

**Result:** it renders and hit-tests at its own 3D placement, in front of,
behind or crossing B (S5), with 0 misroutes in clip mode.

**Pitfall:** React 19's `createRoot().render()` is asynchronous, so the
nested element does not exist yet when the host is adopted. The track
discovers it during `paint`. A first version that looked it up at adoption
silently never registered it.

## 5. Three.js adapter findings

See §3. Measured in S3:

| Mode                 | Painted = depth owner | Click = painted                       |
| -------------------- | --------------------- | ------------------------------------- |
| Adapter, `hit=order` | ✅                    | ❌ (20 of 377, the same as raw WebGL) |
| Adapter, `hit=clip`  | ✅                    | ✅ (0 mismatches)                     |

The adapter's cost equals the raw track's (§12), plus about 0.3 ms of
Three.js render per frame.

## 6. Babylon.js control findings

Babylon 9.36's `HtmlTexture` and `HtmlInteractionManager` were used
unmodified.

- **API support:** it already targets the current API (`content="drawable"`,
  `texElementSubImage2D`, `updateElementGeometry` with
  `preserveHitTestOrder: true`). It marks the element `inert` until an
  interaction manager is attached.
- **Rendering:** correct (`s3-babylon-chromium.png`).
- **Input:**
  - The manager registers a **screen-aligned 2D affine** `canvasTransform`
    (projected centre, half-axes and in-plane rotation, with no
    perspective).
  - Ordering is DOM order.
  - On the S3 crossing, 46 of 377 safe probes misroute (evidence run).
    Misroutes happen both outside the true quad and on the wrong side of
    the crossing.
  - In the benchmark, presses at the geometric location of A's button reached
    it 0 of 5 times in most scenes (§12).
- **Lifecycle:** `dispose()` restores the element's original parent and
  `inert` state.
- **Firefox 159 (no API):** Babylon uses its built-in fallback.
  - The planes show only each page's background colour, with no controls or
    text (`s3-babylon-firefox.png`).
  - The hosts are canvas children without `drawable`, so they are not
    hit-tested. Every page press reaches the canvas.
  - **Hypothesis, not verified:** the static snapshot is taken before the
    React root commits, and is never refreshed because Firefox emits no
    `paint` event.

**Verdict:**

- Chromium rendering is **FEASIBLE**.
- Depth-correct interaction is **not provided** by Babylon's manager, so a
  SpatialFlex Babylon path must drive hit regions itself.
- In Firefox, the fallback is **not usable** for live interactive pages.

## 7. Firefox DOM composition experiment (Track B)

**Setup** (`research-depth.html?track=dom`):

- Each Surface host is a CSS-transformed page (`surfaceTransform`, as the
  SDK does today) in its own full-viewport layer, above a WebGL canvas that
  draws only the Adaptive panel.
- A's Native element stays a DOM descendant of A's page, placed with
  `nativePanelTransform`.

**Modes:**

- **`order`:** the ADR 0002 baseline. Layers get a far-to-near `z-index`
  plus the SDK's `occlusionClipPath` for the panel and the Native element.
  Front/back is decided by each occluder's centroid.
- **`split`:**
  - Each page gets `clip-path: path(nonzero, …)` from the resolver's
    visible pieces.
  - A's page clip keeps the visible footprint of its Native descendant,
    mapped into A's CSS space by casting rays through A's plane.
  - The Native element gets its own clip.

**Results:**

- **Pixels and hit-testing:** in both browsers, the split clips cut pixels
  and hit-testing identically. `elementFromPoint` equals the pointerdown
  target, which equals the click target, for every safe probe.
- **Native descendants:** a page's `clip-path` also clips its descendants,
  so the "keep" region is required. Without it, an extracted Native element
  outside the page's visible pieces disappears.

**Firefox limitation found:**

- Mouse selection inside a perspective-transformed `<input>` is unreliable:
  - double-click selects no word (Windows and Linux CI);
  - mouse-drag selects only partially on Windows and selects nothing in
    Linux CI (headed, under Xvfb).
- Both happen in the baseline too, which is the control run, so they are not
  caused by split clips. The test asserts that split mode behaves the same
  as the baseline.
- Keyboard selection (Shift+Home) works everywhere and is asserted.

## 8. X-shaped Surface intersection test

**Scene (S3):** A and B are both turned ±0.6 rad about the vertical line
x = 0, z = −1.3. A is lifted and B lowered, so these regions all exist:

- A in front;
- B in front;
- only A;
- only B;
- the intersection boundary;
- outside both.

**Probing:**

- Probes are every grid point (100 px in CI, with only S3, S5-cross, S6 and the lifecycle tests; every scenario is probed in the 40 px evidence runs or with `P1_08A2_FULL=1`, 40 px in evidence runs) whose
  expected target stays the same within a 6 px ring. Points nearer to an
  ownership boundary are excluded and counted as _boundary_ probes.
- Exact screen coordinates come from the P1-08A contract (`viewportRay`,
  `intersectSurface`).

**Screenshots** (`docs/evidence/p1-08a2/`): both sides of the intersection
are visible in each one.

- `s3-hic-order`, `s3-hic-clip`, `s3-dom-order`, `s3-dom-split`,
  `s3-three-stock`, `s3-three-adapter-clip` and `s3-babylon`.
- Each is available for `-chromium` and `-firefox` where supported.

**Boundary note:**

- In split modes the two clips meet exactly on the projected intersection
  line. On the line, ownership is a tie and one side wins by 0.1 px
  rounding.
- Anti-aliased clip edges can show a hairline seam of the background.

## 9. Native and Adaptive interaction checks

| Scenario                                   | HIC `clip` | DOM `split` | DOM `order` (baseline)                                                        |
| ------------------------------------------ | ---------- | ----------- | ----------------------------------------------------------------------------- |
| S5-front: A's Native element in front of B | ✅         | ✅          | ✅ (hole in B)                                                                |
| S5-behind: behind B                        | ✅         | ✅          | ✅                                                                            |
| S5-cross: crossing B's plane               | ✅         | ✅          | ❌ misroutes on the side where the Native element is in front (centroid rule) |
| S6: Adaptive WebGL panel crossing B        | ✅         | ✅          | ❌ wrong on one side (centroid rule)                                          |

**Adaptive panel:** it is renderer-drawn. Its input arrives at the canvas
and is routed geometrically, as `InputRouter` specifies (P1-08A). With split
clips, the page is cut exactly where the panel is in front, so clicks reach
the canvas there and stay on the page elsewhere.

Exact counts per scenario are in §11.

## 10. React lifecycle evidence

These are E2E tests run on both tracks and both browsers where supported.

**S7 (state, identity, no remount):**

- Three clicks on A's button and two on B's give `L 3` and `R 2`. State is
  independent per root.
- The same DOM nodes stay connected.
- Exactly 2 mounts and 0 unmounts.

**A5, mounted directly vs moved in (HIC):**

- Roots mounted directly into drawable hosts work.
- An ordinary, already-mounted page was used with a click counter at 2 and
  typed input. Its host was then moved into the drawable canvas:
  - same `#A-left` node;
  - label `L 2`;
  - input value kept;
  - 0 unmounts;
  - a real press at the page's new 3D location reaches its existing React
    handler.
- **Limitation:** this is a page _the app owns and moves_. Converting an
  arbitrary third-party or cross-origin webpage is not possible: the Chrome
  docs say cross-origin content in a canvas is not supported. It was not
  attempted.

**S9 (removal during a gesture):**

1. Press on A's button.
2. Remove Surface A (unmount the root, end the `SurfaceRef`), then add A
   again (new epoch).
3. Release.

**Result:**

- No handler runs: not the old incarnation, not the new one, not B.
- `isCurrent(old)` is false and `isCurrent(new)` is true.
- The lifecycle shows the old unmount and the new mount.
- HIC: the removed texture is deleted (`texturesDeleted ≥ 1`) and two are
  live.
- The next press reaches only the new epoch.

**S8 (10 Hz content while poses swing):**

- Ticks advance; HIC uploads ≥ ticks, so content stays fresh.
- 8 presses, each re-targeted at the button's current geometric location:
  at least 7 of 8 reach A's button.

## 11. Measured visual / input mismatches

Counts come from the evidence-mode E2E run (40 px grid, safe probes only).
The source is `docs/evidence/p1-08a2/results-<browser>.json`.

Columns:

- **depth≠visual:** the geometric owner is not the painted owner.
- **visual≠click:** the painted owner is not the owner of the pointerdown
  target.
- **click:** the expected control is not the pointerdown or click target.
- **efp≠down:** `elementFromPoint` disagrees with the pointerdown target.

| browser  | test                                 | query                                             | safe probes | depth≠visual | visual≠click | click | efp≠down |
| -------- | ------------------------------------ | ------------------------------------------------- | ----------- | ------------ | ------------ | ----- | -------- |
| chromium | A/S3/order                           | `track=hic&scenario=S3&hit=order`                 | 377         | 0            | 20           | 20    | 0        |
| chromium | A/S3/clip                            | `track=hic&scenario=S3&hit=clip`                  | 377         | 0            | 0            | 0     | 0        |
| chromium | A/S1/clip                            | `track=hic&scenario=S1&hit=clip`                  | 353         | 0            | 0            | 0     | 0        |
| chromium | A/S2/clip                            | `track=hic&scenario=S2&hit=clip`                  | 374         | 0            | 0            | 0     | 0        |
| chromium | A/S4/clip                            | `track=hic&scenario=S4&hit=clip`                  | 374         | 0            | 0            | 0     | 0        |
| chromium | A/S5-front/clip                      | `track=hic&scenario=S5-front&hit=clip`            | 370         | 0            | 0            | 0     | 0        |
| chromium | A/S5-behind/clip                     | `track=hic&scenario=S5-behind&hit=clip`           | 380         | 0            | 0            | 0     | 0        |
| chromium | A/S5-cross/clip                      | `track=hic&scenario=S5-cross&hit=clip`            | 379         | 0            | 0            | 0     | 0        |
| chromium | A/S6/clip                            | `track=hic&scenario=S6&hit=clip`                  | 380         | 0            | 0            | 0     | 0        |
| chromium | A/S3/canvasClip (element-space rect) | `track=hic&scenario=S3&hit=rect`                  | 377         | 0            | 20           | 20    | 0        |
| chromium | A/S3/canvasClip (canvas-space rect)  | `track=hic&scenario=S3&hit=rect&rectspace=canvas` | 377         | 0            | 92           | 92    | 0        |
| chromium | B/S3/order                           | `track=dom&scenario=S3&compose=order`             | 377         | 20           | 0            | 20    | 0        |
| chromium | B/S3/split                           | `track=dom&scenario=S3&compose=split`             | 377         | 0            | 0            | 0     | 0        |
| chromium | B/S1 (order)                         | `track=dom&scenario=S1&compose=order`             | 353         | 0            | 0            | 0     | 0        |
| chromium | B/S1 (split)                         | `track=dom&scenario=S1&compose=split`             | 353         | 0            | 0            | 0     | 0        |
| chromium | B/S2 (order)                         | `track=dom&scenario=S2&compose=order`             | 374         | 0            | 0            | 0     | 0        |
| chromium | B/S2 (split)                         | `track=dom&scenario=S2&compose=split`             | 374         | 0            | 0            | 0     | 0        |
| chromium | B/S4 (order)                         | `track=dom&scenario=S4&compose=order`             | 374         | 0            | 0            | 0     | 0        |
| chromium | B/S4 (split)                         | `track=dom&scenario=S4&compose=split`             | 374         | 0            | 0            | 0     | 0        |
| chromium | B/S5-front (order)                   | `track=dom&scenario=S5-front&compose=order`       | 370         | 0            | 0            | 0     | 0        |
| chromium | B/S5-front (split)                   | `track=dom&scenario=S5-front&compose=split`       | 370         | 0            | 0            | 0     | 0        |
| chromium | B/S5-behind (order)                  | `track=dom&scenario=S5-behind&compose=order`      | 380         | 0            | 0            | 0     | 0        |
| chromium | B/S5-behind (split)                  | `track=dom&scenario=S5-behind&compose=split`      | 380         | 0            | 0            | 0     | 0        |
| chromium | B/S5-cross (order)                   | `track=dom&scenario=S5-cross&compose=order`       | 379         | 2            | 0            | 2     | 0        |
| chromium | B/S5-cross (split)                   | `track=dom&scenario=S5-cross&compose=split`       | 379         | 0            | 0            | 0     | 0        |
| chromium | B/S6 (order)                         | `track=dom&scenario=S6&compose=order`             | 380         | 6            | 0            | 6     | 0        |
| chromium | B/S6 (split)                         | `track=dom&scenario=S6&compose=split`             | 380         | 0            | 0            | 0     | 0        |
| chromium | three/adapter (order)                | `track=three&scenario=S3&three=adapter&hit=order` | 377         | 0            | 20           | 20    | 0        |
| chromium | three/adapter (clip)                 | `track=three&scenario=S3&three=adapter&hit=clip`  | 377         | 0            | 0            | 0     | 0        |
| chromium | babylon                              | `track=babylon&scenario=S3`                       | 377         | 0            | 45           | 46    | 0        |
| firefox  | B/S3/order                           | `track=dom&scenario=S3&compose=order`             | 377         | 20           | 0            | 20    | 0        |
| firefox  | B/S3/split                           | `track=dom&scenario=S3&compose=split`             | 377         | 0            | 0            | 0     | 0        |
| firefox  | B/S1 (order)                         | `track=dom&scenario=S1&compose=order`             | 353         | 0            | 0            | 0     | 0        |
| firefox  | B/S1 (split)                         | `track=dom&scenario=S1&compose=split`             | 353         | 0            | 0            | 0     | 0        |
| firefox  | B/S2 (order)                         | `track=dom&scenario=S2&compose=order`             | 374         | 0            | 0            | 0     | 0        |
| firefox  | B/S2 (split)                         | `track=dom&scenario=S2&compose=split`             | 374         | 0            | 0            | 0     | 0        |
| firefox  | B/S4 (order)                         | `track=dom&scenario=S4&compose=order`             | 374         | 0            | 0            | 0     | 0        |
| firefox  | B/S4 (split)                         | `track=dom&scenario=S4&compose=split`             | 374         | 0            | 0            | 0     | 0        |
| firefox  | B/S5-front (order)                   | `track=dom&scenario=S5-front&compose=order`       | 370         | 0            | 0            | 0     | 0        |
| firefox  | B/S5-front (split)                   | `track=dom&scenario=S5-front&compose=split`       | 370         | 0            | 0            | 0     | 0        |
| firefox  | B/S5-behind (order)                  | `track=dom&scenario=S5-behind&compose=order`      | 380         | 0            | 0            | 0     | 0        |
| firefox  | B/S5-behind (split)                  | `track=dom&scenario=S5-behind&compose=split`      | 380         | 0            | 0            | 0     | 0        |
| firefox  | B/S5-cross (order)                   | `track=dom&scenario=S5-cross&compose=order`       | 379         | 2            | 0            | 2     | 0        |
| firefox  | B/S5-cross (split)                   | `track=dom&scenario=S5-cross&compose=split`       | 379         | 0            | 0            | 0     | 0        |
| firefox  | B/S6 (order)                         | `track=dom&scenario=S6&compose=order`             | 380         | 6            | 0            | 6     | 0        |
| firefox  | B/S6 (split)                         | `track=dom&scenario=S6&compose=split`             | 380         | 0            | 0            | 0     | 0        |
| firefox  | babylon                              | `track=babylon&scenario=S3`                       | 377         | 0            | 98           | 98    | 0        |

**Reading it:**

- **HTML-in-Canvas without hit clips (`A/S3/order`) and the Three adapter
  without clips:** pixels follow depth (0 depth≠visual), but 20 of 377 safe
  probes are delivered to the other Surface (visual≠click).
- **DOM baseline (`B/* (order)`):** it is wrong in the _visual_ sense
  (depth≠visual: 20 on S3, 2 on S5-cross, 6 on S6), and it is consistent
  (visual≠click = 0).
- **Split and clip modes:** 0 in every column, in both browsers, in every
  scenario.
- **`canvasClip`:** the element-space reading reproduces the unclipped
  failure (20). The canvas-space reading makes it worse (92).
- **Babylon:** in Chromium, pixels are correct, with 46 of 377 click
  mismatches. In Firefox, the fallback paints only each page's background
  colour (colours match the owner, but no controls or text are visible;
  `s3-babylon-firefox.png`), and every probe on a page goes to the canvas
  (98 of 377).
- **`elementFromPoint`:** agrees with the pointerdown target in every
  recorded run. The probe hovers two frames before pressing; §4.2 shows it
  can be stale without that hover.

## 12. Performance data

**Method:** `pnpm research:depth` in apps/xr-lab, with
`playwright.research.config.ts` and a cross-origin isolated preview.

- Each configuration is run 3 times: 1.5 s warm-up, then a 4 s window with 5
  real presses.
- Values are medians of the 3 runs.
- "compose" is the track's own per-frame JS.
- Style and layout figures are CDP `Performance` deltas (Chromium only).
- "press→frame" is the time from a pointerdown's `timeStamp` to the next
  rAF.

**Raw data:** `perf-<browser>-<headless|headed>.json`. To regenerate the
tables: `node scripts/summarize-p1-08a2-perf.mjs`.

**Caveats:**

- **Presses delivered** in `two-dynamic` (2/5) is not an input-correctness
  measure. The benchmark aims at a fixed point while the button moves. The
  S8 E2E test re-targets each press, and there presses reach the button.
- **Babylon** presses are 0/5 in most scenes. That is the affine
  hit-geometry finding of §6.
- **Babylon upload counts** are not instrumented (shown as 0).

#### chromium 159.0.8154.6 (headless); WebGL: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver); 3× 4000 ms

| track              | scene                | frame median / P95 / P99 (ms) | compose P95 (ms) | uploads/s | upload Mpx/s | clip writes/s | clip vertices | texture MB | style recalc (count / ms) | layout (count / ms) | press→frame median (ms) | presses delivered |
| ------------------ | -------------------- | ----------------------------- | ---------------- | --------- | ------------ | ------------- | ------------- | ---------- | ------------------------- | ------------------- | ----------------------- | ----------------- |
| dom-order          | one-surface          | 16.7 / 16.7 / 16.7            | 0.10             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.3                  | 5 / 0.4             | 5.2                     | 5/5               |
| dom-order          | two-side-by-side     | 16.7 / 16.7 / 16.7            | 0.12             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.3                  | 5 / 0.4             | 7.8                     | 5/5               |
| dom-order          | two-overlapping      | 16.7 / 16.7 / 16.7            | 0.16             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.4                  | 5 / 0.5             | 10.8                    | 5/5               |
| dom-order          | two-interpenetrating | 16.7 / 16.7 / 16.7            | 0.09             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.3                  | 5 / 0.4             | 10.7                    | 5/5               |
| dom-order          | two-dynamic          | 16.7 / 16.7 / 16.7            | 0.14             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 248 / 19.3                | 53 / 6.5            | 11.1                    | 2/5               |
| dom-split          | one-surface          | 16.7 / 16.7 / 16.7            | 0.11             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.3                  | 5 / 0.5             | 11.3                    | 5/5               |
| dom-split          | two-side-by-side     | 16.7 / 16.7 / 16.7            | 0.13             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.3                  | 5 / 0.5             | 7.3                     | 5/5               |
| dom-split          | two-overlapping      | 16.7 / 16.7 / 16.7            | 0.23             | 0.0       | 0.00         | 0.0           | 8             | 0.00       | 11 / 0.3                  | 5 / 0.4             | 7.2                     | 5/5               |
| dom-split          | two-interpenetrating | 16.7 / 16.7 / 16.7            | 0.18             | 0.0       | 0.00         | 0.0           | 16            | 0.00       | 11 / 0.4                  | 5 / 0.5             | 10.3                    | 5/5               |
| dom-split          | two-dynamic          | 16.7 / 16.7 / 16.7            | 0.26             | 0.0       | 0.00         | 119.6         | 16            | 0.00       | 248 / 20.7                | 46 / 5.3            | 6.6                     | 2/5               |
| hic-order          | one-surface          | 16.7 / 16.7 / 16.7            | 0.29             | 1.2       | 0.15         | 0.0           | 0             | 0.48       | 11 / 0.7                  | 5 / 0.9             | 3.9                     | 5/5               |
| hic-order          | two-side-by-side     | 16.7 / 16.7 / 16.7            | 0.30             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.7                  | 5 / 0.8             | 4.4                     | 5/5               |
| hic-order          | two-overlapping      | 16.7 / 16.7 / 16.7            | 0.30             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.6                  | 5 / 0.9             | 5.0                     | 5/5               |
| hic-order          | two-interpenetrating | 16.7 / 16.7 / 16.7            | 0.31             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.6                  | 5 / 0.8             | 2.3                     | 5/5               |
| hic-order          | two-dynamic          | 16.7 / 16.7 / 16.7            | 1.59             | 20.4      | 2.45         | 0.0           | 0             | 0.96       | 7 / 0.3                   | 62 / 9.7            | 3.8                     | 2/5               |
| hic-clip           | one-surface          | 16.7 / 16.7 / 16.7            | 0.25             | 1.2       | 0.15         | 0.0           | 0             | 0.48       | 11 / 0.5                  | 5 / 0.5             | 7.3                     | 5/5               |
| hic-clip           | two-side-by-side     | 16.7 / 16.7 / 16.7            | 0.36             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.7                  | 5 / 0.8             | 7.1                     | 5/5               |
| hic-clip           | two-overlapping      | 16.7 / 16.7 / 16.7            | 0.45             | 1.2       | 0.15         | 0.0           | 8             | 0.96       | 11 / 0.6                  | 5 / 0.8             | 4.1                     | 5/5               |
| hic-clip           | two-interpenetrating | 16.7 / 16.7 / 16.7            | 0.45             | 1.2       | 0.15         | 0.0           | 16            | 0.96       | 11 / 0.6                  | 5 / 0.7             | 4.3                     | 5/5               |
| hic-clip           | two-dynamic          | 16.7 / 16.7 / 33.3            | 4.21             | 115.6     | 13.87        | 115.6         | 16            | 0.96       | 240 / 28.9                | 72 / 9.6            | 5.3                     | 2/5               |
| three-adapter-clip | one-surface          | 16.7 / 16.7 / 16.7            | 0.56             | 1.2       | 0.15         | 0.0           | 0             | 0.48       | 11 / 0.5                  | 5 / 0.6             | 5.4                     | 5/5               |
| three-adapter-clip | two-side-by-side     | 16.7 / 16.7 / 16.7            | 0.63             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.7                  | 5 / 0.8             | 4.0                     | 5/5               |
| three-adapter-clip | two-overlapping      | 16.7 / 16.7 / 16.7            | 0.72             | 1.2       | 0.15         | 0.0           | 8             | 0.96       | 11 / 0.8                  | 5 / 0.7             | 1.0                     | 5/5               |
| three-adapter-clip | two-interpenetrating | 16.7 / 16.7 / 16.7            | 0.72             | 1.2       | 0.15         | 0.0           | 16            | 0.96       | 11 / 0.4                  | 5 / 0.6             | 6.3                     | 5/5               |
| three-adapter-clip | two-dynamic          | 16.7 / 16.7 / 33.3            | 4.44             | 117.6     | 14.11        | 117.3         | 16            | 0.96       | 242 / 30.4                | 73 / 10.3           | 5.0                     | 2/5               |
| babylon            | one-surface          | 16.7 / 16.7 / 16.7            | 0.73             | 0.0       | 0.00         | 0.0           | 0             | 0.48       | 1 / 0.1                   | 0 / 0.0             | 4.5                     | 0/5               |
| babylon            | two-side-by-side     | 16.7 / 16.7 / 16.7            | 0.63             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 1 / 0.1                   | 0 / 0.0             | 2.1                     | 0/5               |
| babylon            | two-overlapping      | 16.7 / 16.7 / 16.7            | 0.61             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 11 / 0.7                  | 5 / 0.8             | 1.6                     | 5/5               |
| babylon            | two-interpenetrating | 16.7 / 16.7 / 16.7            | 0.62             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 1 / 0.1                   | 0 / 0.0             | 7.5                     | 0/5               |
| babylon            | two-dynamic          | 16.7 / 16.7 / 16.7            | 0.72             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 1 / 0.1                   | 63 / 9.7            | 7.0                     | 0/5               |

#### chromium 159.0.8154.6 (headed); WebGL: ANGLE (NVIDIA, NVIDIA GeForce GT 710 (0x0000128B) Direct3D11 vs_5_0 ps_5_0, D3D11); 3× 4000 ms

| track              | scene                | frame median / P95 / P99 (ms) | compose P95 (ms) | uploads/s | upload Mpx/s | clip writes/s | clip vertices | texture MB | style recalc (count / ms) | layout (count / ms) | press→frame median (ms) | presses delivered |
| ------------------ | -------------------- | ----------------------------- | ---------------- | --------- | ------------ | ------------- | ------------- | ---------- | ------------------------- | ------------------- | ----------------------- | ----------------- |
| dom-order          | one-surface          | 9.7 / 10.3 / 10.5             | 0.15             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.5                  | 5 / 0.8             | 3.2                     | 5/5               |
| dom-order          | two-side-by-side     | 9.5 / 10.3 / 10.5             | 0.19             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.4                  | 5 / 0.7             | 5.9                     | 5/5               |
| dom-order          | two-overlapping      | 9.6 / 10.3 / 10.5             | 0.18             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.4                  | 5 / 0.6             | 3.9                     | 5/5               |
| dom-order          | two-interpenetrating | 9.5 / 10.3 / 10.5             | 0.20             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.5                  | 5 / 0.8             | 5.8                     | 5/5               |
| dom-order          | two-dynamic          | 9.5 / 10.3 / 10.5             | 0.24             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 423 / 48.1                | 45 / 7.9            | 5.9                     | 2/5               |
| dom-split          | one-surface          | 9.5 / 10.4 / 10.5             | 0.13             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.5                  | 5 / 0.7             | 2.3                     | 5/5               |
| dom-split          | two-side-by-side     | 9.5 / 10.3 / 10.5             | 0.22             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | 11 / 0.5                  | 5 / 0.7             | 6.0                     | 5/5               |
| dom-split          | two-overlapping      | 9.5 / 10.4 / 10.5             | 0.31             | 0.0       | 0.00         | 0.0           | 8             | 0.00       | 11 / 0.5                  | 5 / 0.7             | 7.0                     | 5/5               |
| dom-split          | two-interpenetrating | 9.5 / 10.3 / 10.5             | 0.34             | 0.0       | 0.00         | 0.0           | 16            | 0.00       | 11 / 0.5                  | 5 / 0.7             | 5.5                     | 5/5               |
| dom-split          | two-dynamic          | 9.4 / 10.2 / 10.3             | 0.26             | 0.0       | 0.00         | 207.2         | 16            | 0.00       | 425 / 41.9                | 47 / 6.2            | 5.1                     | 2/5               |
| hic-order          | one-surface          | 9.5 / 10.4 / 10.6             | 0.22             | 1.2       | 0.15         | 0.0           | 0             | 0.48       | 11 / 0.6                  | 5 / 0.6             | 3.6                     | 5/5               |
| hic-order          | two-side-by-side     | 9.5 / 10.3 / 10.5             | 0.25             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.5                  | 5 / 0.6             | 5.5                     | 5/5               |
| hic-order          | two-overlapping      | 9.5 / 10.3 / 10.5             | 0.26             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.6                  | 5 / 0.8             | 6.5                     | 5/5               |
| hic-order          | two-interpenetrating | 9.5 / 10.4 / 10.5             | 0.28             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.6                  | 5 / 0.6             | 4.0                     | 5/5               |
| hic-order          | two-dynamic          | 9.5 / 10.3 / 10.5             | 0.48             | 20.5      | 2.45         | 0.0           | 0             | 0.96       | 7 / 0.4                   | 45 / 6.8            | 4.4                     | 2/5               |
| hic-clip           | one-surface          | 9.5 / 10.3 / 10.5             | 0.20             | 1.2       | 0.15         | 0.0           | 0             | 0.48       | 11 / 0.6                  | 5 / 0.7             | 5.1                     | 5/5               |
| hic-clip           | two-side-by-side     | 9.6 / 10.3 / 10.5             | 0.32             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.5                  | 5 / 0.6             | 2.7                     | 5/5               |
| hic-clip           | two-overlapping      | 9.5 / 10.3 / 10.5             | 0.38             | 1.2       | 0.15         | 0.0           | 8             | 0.96       | 11 / 0.6                  | 5 / 0.7             | 6.2                     | 5/5               |
| hic-clip           | two-interpenetrating | 9.5 / 10.3 / 10.5             | 0.42             | 1.2       | 0.15         | 0.0           | 16            | 0.96       | 11 / 0.6                  | 5 / 0.6             | 4.7                     | 5/5               |
| hic-clip           | two-dynamic          | 9.4 / 10.2 / 10.3             | 0.59             | 207.4     | 24.89        | 207.1         | 16            | 0.96       | 424 / 35.2                | 46 / 4.6            | 3.0                     | 2/5               |
| three-adapter-clip | one-surface          | 9.5 / 10.4 / 10.6             | 0.42             | 1.2       | 0.15         | 0.0           | 0             | 0.48       | 11 / 0.7                  | 5 / 0.8             | 3.7                     | 5/5               |
| three-adapter-clip | two-side-by-side     | 9.6 / 10.4 / 10.6             | 0.47             | 1.2       | 0.15         | 0.0           | 0             | 0.96       | 11 / 0.4                  | 5 / 0.7             | 6.4                     | 5/5               |
| three-adapter-clip | two-overlapping      | 9.5 / 10.3 / 10.5             | 0.52             | 1.2       | 0.15         | 0.0           | 8             | 0.96       | 11 / 0.5                  | 5 / 0.7             | 4.2                     | 5/5               |
| three-adapter-clip | two-interpenetrating | 9.5 / 10.3 / 10.5             | 0.58             | 1.2       | 0.15         | 0.0           | 16            | 0.96       | 11 / 0.5                  | 5 / 0.7             | 4.0                     | 5/5               |
| three-adapter-clip | two-dynamic          | 9.4 / 10.2 / 10.4             | 0.68             | 208.2     | 24.98        | 207.9         | 16            | 0.96       | 426 / 35.7                | 51 / 5.9            | 4.3                     | 2/5               |
| babylon            | one-surface          | 9.5 / 10.3 / 10.5             | 0.37             | 0.0       | 0.00         | 0.0           | 0             | 0.48       | 1 / 0.1                   | 0 / 0.0             | 3.7                     | 0/5               |
| babylon            | two-side-by-side     | 9.5 / 10.3 / 10.6             | 0.43             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 1 / 0.1                   | 0 / 0.0             | 4.5                     | 0/5               |
| babylon            | two-overlapping      | 9.5 / 10.3 / 10.5             | 0.44             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 11 / 0.5                  | 5 / 0.7             | 4.7                     | 5/5               |
| babylon            | two-interpenetrating | 9.5 / 10.4 / 10.6             | 0.43             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 1 / 0.1                   | 0 / 0.0             | 6.1                     | 0/5               |
| babylon            | two-dynamic          | 9.5 / 10.3 / 10.4             | 0.50             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | 1 / 0.1                   | 77 / 10.1           | 5.7                     | 0/5               |

#### firefox 159.0 (headless); WebGL: ANGLE (NVIDIA, NVIDIA GeForce GTX 480 Direct3D11 vs_5_0 ps_5_0), or similar; 3× 4000 ms

| track              | scene                | frame median / P95 / P99 (ms) | compose P95 (ms) | uploads/s | upload Mpx/s | clip writes/s | clip vertices | texture MB | style recalc (count / ms) | layout (count / ms) | press→frame median (ms) | presses delivered |
| ------------------ | -------------------- | ----------------------------- | ---------------- | --------- | ------------ | ------------- | ------------- | ---------- | ------------------------- | ------------------- | ----------------------- | ----------------- |
| dom-order          | one-surface          | 8.2 / 14.3 / 17.0             | 0.18             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 6.4                     | 5/5               |
| dom-order          | two-side-by-side     | 8.2 / 14.8 / 16.8             | 0.24             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 6.6                     | 5/5               |
| dom-order          | two-overlapping      | 8.2 / 12.3 / 17.0             | 0.22             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 6.8                     | 5/5               |
| dom-order          | two-interpenetrating | 8.2 / 13.1 / 17.0             | 0.22             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 6.6                     | 5/5               |
| dom-order          | two-dynamic          | 8.2 / 14.3 / 16.9             | 0.38             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 6.8                     | 2/5               |
| dom-split          | one-surface          | 8.1 / 11.4 / 16.7             | 0.20             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 6.4                     | 5/5               |
| dom-split          | two-side-by-side     | 8.1 / 13.2 / 17.0             | 0.34             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 6.4                     | 5/5               |
| dom-split          | two-overlapping      | 8.2 / 10.1 / 16.5             | 0.36             | 0.0       | 0.00         | 0.0           | 8             | 0.00       | n/a                       | n/a                 | 5.8                     | 5/5               |
| dom-split          | two-interpenetrating | 8.2 / 9.7 / 16.7              | 0.42             | 0.0       | 0.00         | 0.0           | 16            | 0.00       | n/a                       | n/a                 | 6.2                     | 5/5               |
| dom-split          | two-dynamic          | 8.5 / 14.8 / 17.6             | 0.44             | 0.0       | 0.00         | 222.7         | 16            | 0.00       | n/a                       | n/a                 | 1.4                     | 2/5               |
| hic-order          | —                    | UNSUPPORTED                   |                  |           |              |               |               |            |                           |                     |                         |                   |
| hic-clip           | —                    | UNSUPPORTED                   |                  |           |              |               |               |            |                           |                     |                         |                   |
| three-adapter-clip | —                    | UNSUPPORTED                   |                  |           |              |               |               |            |                           |                     |                         |                   |
| babylon            | one-surface          | 8.5 / 14.9 / 16.9             | 0.96             | 0.0       | 0.00         | 0.0           | 0             | 0.48       | n/a                       | n/a                 | 6.7                     | 0/5               |
| babylon            | two-side-by-side     | 8.4 / 12.3 / 17.0             | 1.08             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 6.9                     | 0/5               |
| babylon            | two-overlapping      | 8.3 / 14.7 / 16.9             | 0.92             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 7.2                     | 0/5               |
| babylon            | two-interpenetrating | 8.4 / 15.0 / 17.2             | 1.00             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 7.3                     | 0/5               |
| babylon            | two-dynamic          | 8.5 / 11.0 / 16.7             | 1.30             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 7.7                     | 0/5               |

#### firefox 159.0 (headed); WebGL: ANGLE (NVIDIA, NVIDIA GeForce GTX 480 Direct3D11 vs_5_0 ps_5_0), or similar; 3× 4000 ms

| track              | scene                | frame median / P95 / P99 (ms) | compose P95 (ms) | uploads/s | upload Mpx/s | clip writes/s | clip vertices | texture MB | style recalc (count / ms) | layout (count / ms) | press→frame median (ms) | presses delivered |
| ------------------ | -------------------- | ----------------------------- | ---------------- | --------- | ------------ | ------------- | ------------- | ---------- | ------------------------- | ------------------- | ----------------------- | ----------------- |
| dom-order          | one-surface          | 8.4 / 13.8 / 17.2             | 0.20             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 7.5                     | 5/5               |
| dom-order          | two-side-by-side     | 8.4 / 11.9 / 18.1             | 0.26             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 8.1                     | 5/5               |
| dom-order          | two-overlapping      | 8.4 / 11.5 / 16.8             | 0.26             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 7.4                     | 5/5               |
| dom-order          | two-interpenetrating | 8.5 / 14.6 / 17.0             | 0.26             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 7.6                     | 5/5               |
| dom-order          | two-dynamic          | 8.5 / 11.4 / 17.1             | 0.36             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 7.8                     | 2/5               |
| dom-split          | one-surface          | 8.4 / 14.8 / 16.9             | 0.16             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 8.2                     | 5/5               |
| dom-split          | two-side-by-side     | 8.4 / 13.0 / 16.6             | 0.30             | 0.0       | 0.00         | 0.0           | 0             | 0.00       | n/a                       | n/a                 | 7.6                     | 5/5               |
| dom-split          | two-overlapping      | 8.4 / 14.8 / 17.4             | 0.36             | 0.0       | 0.00         | 0.0           | 8             | 0.00       | n/a                       | n/a                 | 7.7                     | 5/5               |
| dom-split          | two-interpenetrating | 8.4 / 11.8 / 17.0             | 0.44             | 0.0       | 0.00         | 0.0           | 16            | 0.00       | n/a                       | n/a                 | 7.9                     | 5/5               |
| dom-split          | two-dynamic          | 8.4 / 11.2 / 16.6             | 0.60             | 0.0       | 0.00         | 224.9         | 16            | 0.00       | n/a                       | n/a                 | 7.9                     | 2/5               |
| hic-order          | —                    | UNSUPPORTED                   |                  |           |              |               |               |            |                           |                     |                         |                   |
| hic-clip           | —                    | UNSUPPORTED                   |                  |           |              |               |               |            |                           |                     |                         |                   |
| three-adapter-clip | —                    | UNSUPPORTED                   |                  |           |              |               |               |            |                           |                     |                         |                   |
| babylon            | one-surface          | 8.5 / 15.1 / 16.9             | 0.86             | 0.0       | 0.00         | 0.0           | 0             | 0.48       | n/a                       | n/a                 | 7.8                     | 0/5               |
| babylon            | two-side-by-side     | 8.5 / 15.2 / 16.8             | 0.88             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 7.7                     | 0/5               |
| babylon            | two-overlapping      | 8.5 / 12.2 / 16.9             | 0.92             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 7.6                     | 0/5               |
| babylon            | two-interpenetrating | 8.5 / 13.7 / 16.6             | 0.78             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 7.9                     | 0/5               |
| babylon            | two-dynamic          | 8.5 / 13.5 / 16.9             | 1.16             | 0.0       | 0.00         | 0.0           | 0             | 0.96       | n/a                       | n/a                 | 7.6                     | 0/5               |

**Reading the numbers:**

- **Static scenes:** every approach stays at the display rate. Split clips
  are written once (16 vertices for the crossing), and compose CPU stays
  below 0.5 ms.
- **Dynamic scenes** (two poses swinging every frame, 10 Hz content):
  - **DOM split** writes two clips per frame (Chromium headless about
    120/s, headed about 207/s, Firefox about 220/s). Style recalcs match the
    baseline order mode (the transforms already change every frame), and
    compose P95 stays at 0.3–0.6 ms.
  - **HTML-in-Canvas with clips** changes each drawable's `clip-path` every
    frame. That is a content change, so each Surface is re-captured and
    re-uploaded every frame:
    - headless: 116 uploads/s, 14 Mpx/s, compose P95 4.2 ms, frame P99
      33 ms;
    - headed: 207 uploads/s, 25 Mpx/s, compose P95 0.6 ms;
    - versus 20/s and 2.5 Mpx/s in order mode (10 Hz × 2 Surfaces).

    Upload volume therefore scales with page area × frame rate × Surfaces
    whenever anything moves. This is the HTML-in-Canvas analogue of the
    P1-07C clip cost and P1-07D upload cost.
- **Texture memory:** 0.48 MB per 400×300 Surface (RGBA8, level 0) on the
  HTML-in-Canvas and Babylon tracks. The DOM compositor allocates none.

## 13. Failure cases and browser limitations

1. HTML-in-Canvas hit order is per element, not per pixel depth (§4.2).
2. `elementFromPoint` and hover targets are stale after a geometry change
   until the next real pointer event (§4.2). `elementFromPoint` is not a
   reliable oracle right after a reorder.
3. A press during an ownership change can split pointerdown and pointerup
   across elements. The click then lands on their common ancestor, the
   canvas.
4. Three.js r187 `HTMLTexture` silently does nothing (§3).
5. `ExternalTexture` colour space is ignored (§3).
6. Babylon's interaction manager is affine and DOM-ordered (§6).
7. Firefox 159 has no HTML-in-Canvas. Babylon's fallback shows page
   backgrounds only and is not interactive.
8. Firefox 159 mouse selection (double-click, drag) in a
   perspective-transformed input is unreliable. This happens in the
   baseline too.
9. Split clips create a ≤ 0.2 px seam on the intersection line.
10. Clip changes force HTML-in-Canvas re-captures (§12).
11. Tab focus ignores occlusion: a fully hidden control is still focusable
    (not mitigated; §17).
12. A page's `clip-path` clips its Native descendants. "Keep" regions are
    mandatory (DOM track).
13. The documentation is inconsistent about `ElementImage` size and the
    origin trial (§2).

## 14. Candidate compositor architectures

**Design 1: renderer-authoritative depth.** WebGL paints everything, and
HTML-in-Canvas maps input back to the DOM.

- **Measured:** pixels are correct, but input is **not**. The browser's hit
  order is independent of WebGL depth. Design 1 alone fails the invariant on
  any crossing or overlap where registration order ≠ depth.
- **Browser support:** Chromium only.

**Design 2: geometry-authoritative depth.** A renderer-neutral resolver
computes visibility regions and hit ownership. Rendering adapters apply
them, and the input system enforces the same owner.

- **Measured:** it satisfies the invariant in both tracks, in both browsers,
  in every scenario.

**Hybrid (recommended):**

- Design 2 decides ownership.
- The DOM split compositor is the default renderer (all browsers).
- HTML-in-Canvas is an optional Chromium renderer: WebGL depth paints, and
  hit clips come from the same resolver.

| Criterion                 | Design 1                                                          | Design 2                                               | Hybrid                                                |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Correctness (measured)    | pixels only                                                       | pixels + input                                         | pixels + input                                        |
| Browser portability       | Chromium 157+                                                     | all tested                                             | all, with an optional enhancement                     |
| DOM state preservation    | ✅ (owned pages)                                                  | ✅                                                     | ✅                                                    |
| Performance when moving   | uploads ∝ area × fps                                              | 2 clip writes per Surface per frame                    | per path (§12)                                        |
| WebXR compatibility       | WebGL only, no DOM overlay in immersive XR; the texture path fits | DOM layers are not visible inside an immersive session | XR uses texture plus ray input (Adaptive), regardless |
| Implementation complexity | low (but wrong)                                                   | moderate (resolver + clips)                            | moderate + adapter                                    |
| P1-08A `InputRouter`      | needs the browser's order                                         | the resolver supplies its hits                         | ✅                                                    |
| P1-08A `FrameAuthority`   | one renderer canvas                                               | camera frame from the authoritative host               | ✅                                                    |
| Native / Adaptive         | nested drawables / quads                                          | keep regions / holes                                   | ✅                                                    |

## 15. Recommended architecture

**Hybrid, geometry-authoritative.** Proposed in
[ADR 0003](adr/0003-unified-depth-ownership.md).

1. **Depth resolver** (renderer-neutral, next to `packages/core/src/workspace/`
   in P1-08B):
   - Input: the planes of all participants and the authoritative camera
     frame.
   - Output, per participant: hidden regions, disjoint convex visible pieces
     and a nonzero `path()` clip.
   - Output, per ray: the depth owner, which feeds `InputRouter.resolveOwner`.
2. **DOM compositor:**
   - Applies the pieces as page and Native element clips, with keep regions
     for Native descendants.
   - Writes a clip only when it changes, the P1-07C rule.
3. **HTML-in-Canvas adapter** (optional, feature-detected):
   - Uploads changed drawables and lets WebGL depth paint.
   - Applies the same pieces as hit clips.
   - Integrates with Three.js through r188+ or an `ExternalTexture` adapter.
4. **ADR 0002:**
   - Rule 4 ("interpenetrating Surfaces unsupported") is replaced by split
     regions for planar content.
   - The centroid occluder test is replaced by half-space clipping.
   - `z-index` order remains only as a tie-breaker.

## 16. P1-08B implementation implications

| Stage                            | Change from the P1-08A plan                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 Surface registration          | unchanged (`SurfaceTable`)                                                                                                                                            |
| B2 Shared coordinates and scene  | adds the depth resolver to core workspace (internal), with property tests against ray casting (as `depthResolver.test.ts`)                                            |
| B3 Camera and frame routing      | the resolver runs on the authoritative frame only (`FrameAuthority`)                                                                                                  |
| B4 Input ownership               | `InputRouter` hits come from the resolver; ownership changes cancel gestures (S9 rule)                                                                                |
| B5 Native / Adaptive per Surface | keep regions for Native descendants; Native clips; Adaptive holes from half-space clipping                                                                            |
| B6 Occlusion and performance     | replace `occlusionClipPath`'s centroid test internally (public API unchanged); measure clip writes per frame for N > 2 Surfaces on hardware; decide on a seam overlap |

**Minimal path:** the resolver plus the DOM split compositor (B2, B5, B6).
HTML-in-Canvas stays out of P1-08B unless Three.js r188 lands.

## 17. Unresolved research questions

1. **Occlusion-aware focus:** should Tab skip fully hidden controls (`inert`
   on hidden pieces?) without breaking accessibility?
2. **`canvasClip`:** what coordinate space does it use, and will a polygon
   form be added? It would avoid the re-capture cost of `clip-path` in
   HTML-in-Canvas.
3. **Depth-aware hit order in Chromium:** will drawable hit-testing ever
   consider the `canvasTransform` depth? The E2E test asserts the current
   behavior, so a change will be noticed.
4. **Seam policy:** what is the right overlap width, and is the overlap
   attributed to the nearer plane?
5. **Scale:** clip complexity and write rate for N > 2 Surfaces and many
   Native elements, on hardware and on a headset (no headset was used here).
6. **Curved or non-planar content:** out of scope for the resolver.
7. **Pointer reorder lag (§4.2, row 7):** a browser-side "commit geometry
   now" primitive would make a dynamic reorder viable.
8. **Babylon:** a hit-region-driven alternative to `HtmlInteractionManager`.
9. **Firefox:** HTML-in-Canvas status and timeline.

## Reproduction

```bash
# Regression and research tests (CI runs these as part of the suite).
pnpm --filter @spatialflex/xr-lab exec vitest run src/research
pnpm --filter @spatialflex/xr-lab exec playwright test e2e/unified-depth.spec.ts

# Evidence (dense grid, writes docs/evidence/p1-08a2).
cd apps/xr-lab && P1_08A2_EVIDENCE=1 pnpm exec playwright test e2e/unified-depth.spec.ts

# Performance (opt-in; never in CI).
cd apps/xr-lab && pnpm research:depth                 # headless
cd apps/xr-lab && BENCH_HEADED=1 pnpm research:depth  # headed (hardware GPU)
node scripts/summarize-p1-08a2-perf.mjs

# Manual exploration.
cd apps/xr-lab && pnpm build && pnpm preview
#   /research-depth.html?track=hic|dom|three|babylon&scenario=S1…S9
#                        &hit=order|clip|rect&compose=order|split
#                        &three=stock|adapter&mount=direct|moved&tick=1&animate=1
```
