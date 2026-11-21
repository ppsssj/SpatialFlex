# P1-09A: CSS context preservation spike

## Questions and method

Can a live React-managed card be repositioned without losing its CSS context, state, identity, focus and event behavior? Does copying resolved styles restore the effect? What happens if ancestry is kept and a transform is used? This is a characterization of one deliberately ancestor-dependent dashboard, not a CSS preservation engine or proof of general browser behavior.

The fixture uses a React 19 controlled input and counter, parent selectors, inherited custom property, grid, flex, a size container query and a 50% child width. `#root` contains the dashboard and delegated React event root; `#destination` is **outside** it. Controls select original, direct `append`, reparent with a snapshot of nine chosen computed properties on the card and descendants, or a CSS perspective/translate/rotate transform while keeping ancestry. Snapshot is taken before moving, inline styles are restored on return, and no live synchronization is implemented. A separate unsafe unmount deliberately moves before React unmount; the normal control restores first.

Reproduce from this checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @spatialflex/xr-lab exec playwright test -c playwright.css-context.config.ts
```

The isolated config starts its own Vite server on 4187 and targets Chromium and Firefox. Measurements below: Windows, Intel Core i5-9400F, Node 24.12.0, Playwright 1.65.1, headless Chromium 159.0.8154.6 and Firefox 159.0; viewport 1280×900, device scale 1. Values are fixture observations, not SDK benchmarks.

## Observations

| Approach                      | CSS probes, original theme | State / identity                                                             | Input and dynamic behavior                                                                                                     |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Original                      | baseline 6/6               | retained                                                                     | React events work; parent theme and container resize update styles                                                             |
| Direct append                 | 0/6 in both                | same node and prior state/value after move and after ancestor React rerender | focused input loses focus; outside React root click/input do not update React state; restore restores events and styles        |
| Append + selected snapshot    | 6/6 immediately in both    | same node                                                                    | captured inline properties do not update on theme or container resize; moving outside root still breaks delegated React events |
| Original ancestry + transform | 6/6                        | same node, state retained                                                    | event works in visible area; grid slot stays, parent overflow clips transformed pixels and hit testing                         |

The six probes are card background, color, padding-top, border-top color, button color and query font-size. A direct move drops `.dashboard .card` selectors, inherited `--accent` and the container query; it also changes the available grid/layout context. In this fixture the original card border-box is approximately 417×252 CSS px; direct reparenting changes it to approximately 300×169–170 px. The inline snapshot restores those six values and approximately the original dimensions, not the original relationships. Descendant pseudo-elements, states, CSS cascade, fonts/resources and other properties are not comprehensively copied or tested. The snapshot does not track a new theme, nor does it recompute when the original container changes width. The test restores the original 12px query result after a resize.

Unmount while moved is materially different from a safe restore before unmount: in both tested browsers React's effect cleanup ran but the card remained as an orphan in the destination. Normal restore followed by unmount removed it and produced no captured page or console warning/error. This does not prove every React reconciliation pattern is safe; removal/reordering, Strict Mode and portals need independent study. The direct move is not a supported React ownership transfer. `append` lost focus; no conclusion here is drawn about iframes or `moveBefore()`, which was not benchmarked. React delegation depends on the root and where the node is moved; these results must not be generalized to destinations inside the same root.

Transform preserves the original DOM, styles, layout slot and normal event handling where visible; moving a narrowed card outside its `overflow: hidden` ancestor demonstrates clipping and failed hit testing outside that ancestor in both browsers. Stacking contexts, containing blocks and 3D perspective can constrain compositing, but this fixture does not establish a general solution to them. A transform changes visual geometry, not the occupied grid slot.

## Exploratory measurement

The test prints actual samples: 30 consecutive move + forced layout + restore + forced layout cycles per method, median and P95 in ms. There is no warmup exclusion, isolation, GC control or confidence interval; Firefox rounds timer values. This is not a production performance claim.

| Browser / mode     | Matching probes | Median / P95 ms | Pixel difference in equal-size captures |
| ------------------ | --------------: | --------------: | --------------------------------------: |
| Chromium direct    |             0/6 |       0.6 / 0.9 |                         38,922 / 39,200 |
| Chromium snapshot  |             6/6 |       0.8 / 1.2 |                          1,890 / 39,200 |
| Chromium transform |             6/6 |       0.1 / 0.2 |                          9,262 / 39,200 |
| Firefox direct     |             0/6 |           1 / 3 |                         38,842 / 39,200 |
| Firefox snapshot   |             6/6 |           1 / 5 |                            902 / 39,200 |
| Firefox transform  |             6/6 |           0 / 1 |                          9,144 / 39,200 |

Pixel comparisons use equal-size 280 by 140 CSS-pixel viewport captures at each card's upper-left bounding-box origin and compare RGBA pixels; card dimensions, parent clipping, position, perspective and antialiasing differ. They therefore combine layout and visual effects and are **not** an isolated CSS-style error metric. Exact style probes and separately recorded bounds are used to distinguish the observed style and size changes; a controlled study that equalizes the element layout and its surrounding context is still needed. Timer samples include layout reads and, for snapshot, reading/applying computed properties. Browser-version and runtime behavior are observations for this run only.

## Answer and next research

There is a demonstrated technical need to preserve or deliberately recreate **context** if the SDK must reparent a live element outside its original React root: this fixture loses selectors, inheritance, container-query inputs, focus and event routing. This result does not show that a novel CSS engine is necessary or feasible. Existing CSS transform keeps context where ancestor clipping, stacking and containing blocks are acceptable. Existing React portals can express React-owned placement into a destination when the application can choose that architecture; they do not automatically recreate the old CSS ancestry. Feature-detected `Element.moveBefore()` may preserve more browser-managed state where supported, but does not by itself recreate ancestor selectors or React ownership; it was not tested here.

Next steps are an isolated moveBefore focus/lifecycle matrix; a React-supported portal/context adapter; explicit inheritance, selector, container-size and theme invalidation experiments; and controlled same-size screenshot comparisons. Reparent/unmount behavior, focus, event delegation and browser support need explicit contracts before any SDK feature. No claim of novelty or complete CSS preservation follows from this spike.
