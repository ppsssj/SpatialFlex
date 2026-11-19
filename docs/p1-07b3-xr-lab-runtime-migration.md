# P1-07B3 — XR Lab Migration to Shared PresentationRuntime

Tracking issue: #33. Baseline: `main` @ `999b17c7c06c8be0493b8c4e85d40a5a62eb27f5`
(409 unit/integration tests, 342 browser E2E tests, package smoke test passing).

P1-07B2 introduced `PresentationRuntime` (`@spatialflex/dom`) and its React
bindings (`@spatialflex/react/spatial`). The external React consumer used it,
but the XR Lab's SpatialFlex integration kept its own lifecycle. P1-07B3 moves
the XR Lab onto the same SDK-owned runtime. This is an architectural
consolidation and adds no XR features: everything the XR Lab did before still
works, and the existing tests pass unchanged except two, retargeted in §9.

## 1. Before/after architecture

### Before (P1-07B2)

```text
@spatialflex/core ← @spatialflex/dom ← @spatialflex/react(/spatial)
                                          ↑                 ↑
              XR Lab SpatialFlex adapter ─┘   external consumer
              (own lifecycle: usePresentation, instance maps,
               ItemManipulator sync)
              XR Lab surface (own NativeCompositor, anchors)
              XR Lab useNativeHandles (own handle binding)
```

### After (P1-07B3)

```text
@spatialflex/core
       ↑
@spatialflex/dom            PresentationRuntime (one per workspace)
       ↑
@spatialflex/react/spatial  useSpatialPresentations
       ↑                          ↑
XR Lab SpatialFlex adapter   external consumer
       ↓  (LabIntegration contract; connectNativeHost)
XR Lab shell / page surface  (page plane only; Native DOM host of the runtime)
       ↓
neutral renderer host contract (contracts/xrHost)
       ↓
Three.js / Babylon.js hosts (no SpatialFlex import)

Baseline adapter: independent (usePresentation, no SDK runtime)
```

There are no circular dependencies. Host packages still import only
`contracts/xrHost`. The Baseline adapter imports neither the runtime nor the
React bindings (M7).

## 2. Presentation lifecycle ownership

| Responsibility                   | Before (XR Lab SpatialFlex path)                                    | After                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Presentation instances           | Adapter: `presentation-N`, `native-N` counters, `instances` ref     | **SDK runtime** (`instancePrefix` keeps the lab's `presentation-N` ids)                                     |
| Registry registration identity   | Adapter compared view `registrationId`s                             | **SDK runtime** (`registry.registrationOf`, per instance)                                                   |
| XR view epochs                   | Adapter + `usePresentation(available)` pruning                      | **SDK runtime** (instance bound to its `viewRegistrationId`)                                                |
| Native DOM extraction            | Adapter `natives` map + `controller.extractNative`                  | **SDK runtime** (`extract(id, "native", …)`)                                                                |
| Native compositor targets        | Surface hook's own `NativeCompositor` + `nativeTargets()` + anchors | **SDK runtime** (its single `NativeCompositor`, page-surface mode)                                          |
| Adaptive panel visibility        | `usePresentation.shown`                                             | **SDK runtime** (live Adaptive instances); renderer draws them                                              |
| Panel slot positions and offsets | `usePresentation` anchors/offsets + manipulator sync                | **XR Lab** (`slot(index)`, per-instance `PanelLayout`) → `runtime.relocate`                                 |
| Manipulation poses and sessions  | Adapter-owned `ItemManipulator`, synced from React                  | **SDK runtime** (`runtime.manipulation`, synced on reconcile)                                               |
| Pointer and keyboard handlers    | `useNativeHandles` (lab) + host handles                             | **SDK runtime** (`bindNativeHandles` on its targets) + host handles (unchanged)                             |
| Camera frames                    | Surface hook (copy for rays)                                        | Surface hook places the page; forwards frames to the **runtime host** (authoritative source, rays)          |
| DOM clipping and occlusion       | Surface hook (page) + its compositor (elements)                     | Surface hook: page clip (keeps runtime footprints). **Runtime**: element clip with lab occluders            |
| Stale event rejection            | Adapter `capturedInstances` vs `instances` ref                      | Adapter compares the rendered SDK instance with the live one (+ registration, view epoch); `runtime.invoke` |
| Restore and disposal             | Adapter `endPresentation`, LabShell effect, compositor dispose      | **SDK runtime** (`restore`, registry reconcile, host disconnect, `connect()` cleanup)                       |

## 3. Page-surface integration contract (SDK changes)

All changes are additive, and viewport-mode consumers are unaffected: the
external consumer was not modified and its 12 E2E tests pass.

```ts
interface HostFrameOptions {
  occluders?: readonly Occluder[];
  /** Page-surface mode: the transformed page containing the native elements. */
  surface?: ContainingSurface; // { element, pose, resolution, border }
}
interface HostFrameResult {
  /** Native footprints in page pixels (page-surface mode). */
  keep: [number, number][][];
}
interface HostOptions {
  /** Default true. A Native-only host ends only Native presentations. */
  drawsAdaptive?: boolean;
}
interface PresentationHost {
  frame(frame: CameraFrame, options?: HostFrameOptions): HostFrameResult;
  rayAt(x: number, y: number): SpatialRay | null;
  disconnect(): void;
}
runtime.connectHost(options?: HostOptions): PresentationHost;
runtime.relocate(instanceId: string, position: Vec3): boolean;
new PresentationRuntime(registry, controller, { instancePrefix? });
useSpatialPresentations(options?: PresentationRuntimeOptions);
PresentationPlacement.extent // now also overrides the Native natural size
```

- **One compositor owner.** A page-surface frame calls the runtime's existing
  `NativeCompositor.composite(frame, { surface, occluders })`. No second
  compositor was created. The XR Lab's own `NativeCompositor` instance was
  removed. M1 shows that the transform is identical to the compositor's
  page-surface placement and that the page carries no SDK marks.
- **Containing block for support checks.** `nativeSupport` checks ancestors
  against the page element of the authoritative host's last frame, or against
  the viewport when there is none. This is the containing block that
  compositing assumes.
- **Frame authority.** The earliest connected host that reports frames is the
  authoritative frame source. Frames from other hosts are ignored (they return
  `keep: []`), and their `rayAt` returns `null`. When the source disconnects,
  the next host that reports a frame takes over. The runtime therefore never
  places elements, or derives handle rays, from a camera other than the
  authoritative one.
- **Host scope.** When the last host disconnects, Native presentations end,
  because nothing can composite them. When the last host that draws Adaptive
  panels disconnects, Adaptive presentations end. The external consumer's
  single host (`drawsAdaptive: true` by default) keeps the P1-07B2 behaviour:
  closing the view restores everything. The XR Lab's page surface connects
  with `drawsAdaptive: false`.

## 4. Renderer host ownership

| Layer                                         | Owns                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SDK runtime                                   | Native presentation state, compositor targets, poses and sessions, handle binding, lifecycle, issues |
| XR Lab page surface (`useSurfaceCompositor`)  | Page plane pose and scale, page `matrix3d`, page clip and visibility, layer box, occluder geometry   |
| Renderer adapter (Three.js / Babylon.js host) | Scene, camera frames (`onCameraFrame`), panel drawing, picking, 3D handles over `HostManipulation`   |

**Mode transitions**

| Transition                                                  | What happens                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Website ↔ split                                             | The surface host disconnects in split mode. Native presentations end; Adaptive panels stay (as before; M6).                                                                                                                                      |
| Workspace unmount/remount (renderer disposed and recreated) | The surface host disconnects: Native ends, Adaptive instances keep their identity and are drawn again (M6).                                                                                                                                      |
| Iframe bridge host                                          | Unchanged: no web surface (same-document compositing is impossible across realms), so no runtime host is connected. Adaptive panels and stale-action protection go through `actionOwners`, now `<viewEpoch>/<instanceId>` from the SDK instance. |
| IWER immersive emulation                                    | Unchanged: Adaptive panels only.                                                                                                                                                                                                                 |

## 5. Migration changes and removed duplication

| Removed / replaced                                                                                                         | Where                                               |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `instances` ref, `capturedInstances` state, generation counters, view-epoch subscription                                   | `integrations/spatialflex/index.tsx`                |
| `natives` map (source, instance, start pose, extent)                                                                       | same                                                |
| `ManipulablePresentation[]` construction + `ItemManipulator.sync` layout effect                                            | same (the runtime reconciles)                       |
| `usePresentation` use (shown, anchors, offsets, selection) in the SpatialFlex path                                         | same (Baseline still uses it)                       |
| Surface hook's own `NativeCompositor`, `nativeTargets`, anchors, `placeNative`, camera copy, `rayAt`, `nativeIssues` state | `surface/useSurfaceCompositor.ts` (322 → 208 lines) |
| `useNativeHandles` (63 lines)                                                                                              | deleted; the runtime binds the handles              |

The SpatialFlex adapter is about the same size (422 → 432 lines). Before, it
owned the lifecycle; now it only translates the `LabIntegration` contract:
strategies, source names, `surfaceItems` diagnostics, slots and offsets. The
added SDK code is about 160 lines in `presentationRuntime.ts`.

Kept on purpose:

- `integrations/common/presentation.ts`: used by Baseline.
- `integrations/spatialflex/manipulation.ts`: a stateless re-export of the
  SDK `ItemManipulator`, imported by the existing `manipulation.test.ts`.
- The LabShell effect that restores Native presentations outside the Spatial
  Website. It is now XR Lab policy rather than lifecycle: it only matters for
  a Native extraction requested through the API while no surface host is
  connected.

## 6. Slot/offset compatibility

The renderer-side layout policy stays in the XR Lab:

- `slot(index)` for panels that `show` opens.
- The explicit position for `extract`.
- Per-instance Move offsets.

The adapter computes each panel's layout origin and calls
`runtime.relocate(instanceId, origin)` from a layout effect. The runtime keeps
that origin as the start pose, and `ItemManipulator.sync` shifts the live pose
by the same delta. The user's manipulated pose relative to the origin is
preserved, movement is never applied twice, and Reset returns to the shifted
origin. Offsets are keyed by the SDK instance id, so a new instance starts
from its slot (M3, M5). Several Move clicks in one event accumulate
(functional state update).

The XR Lab's source policy names map explicitly to the SDK:

| Lab policy (`SurfaceItem.extraction.source`) | Presentation | SDK runtime source | Controller argument |
| -------------------------------------------- | ------------ | ------------------ | ------------------- |
| `reserved`                                   | Native DOM   | `placeholder`      | `placeholder`       |
| `collapsed`                                  | Native DOM   | `collapse`         | `collapse`          |
| `visible`                                    | XR Adaptive  | `visible`          | —                   |
| `reserved`                                   | XR Adaptive  | `reserved`         | —                   |

- 2D Move (Placeholder or Collapse) still goes through `controller.detach`.
- XR Mirror + Visible (`show`) is an Adaptive presentation with source
  `visible`.
- Unsupported combinations are still rejected with the SDK's reasons
  (`assertExtraction`, `assertDetachmentStrategy`).

## 7. Native DOM preservation

The original element is extracted by the controller and composited by the
runtime inside the transformed page; it is never moved, cloned or remounted.

| Invariant                                                                     | Test                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Same node; no React remount                                                   | M2, `counter-mounts` unchanged                                   |
| Local state, context, listeners and editable input preserved                  | M2, M1 (real click hits the original button)                     |
| Layout size unchanged by 3D manipulation                                      | M2                                                               |
| Restore removes only SDK-owned styles; the source's reserved visibility stays | M2, M6, `hardening.test.tsx`                                     |
| Handles at the projected position; listeners released                         | existing `manipulation.spec.ts`, `hardening-interaction.spec.ts` |
| A replaced element: old handles take no input, old element released           | retargeted `hardening.test.tsx`                                  |
| Containment diagnostics actionable                                            | existing `hardening-css.spec.ts`, M4 rollback                    |

## 8. Adaptive action routing

Host callbacks (`onPanelButton`, `onPanelSelect`, `onPanelClose`) take an
item id. The adapter accepts one only if all of these hold:

- the presentation the XR Lab rendered (from the SDK snapshot) is still the
  runtime's live instance for that item;
- its registration key equals `registry.registrationOf(id)`;
- its view epoch equals the current view's `registrationId`.

Buttons then go through `runtime.invoke(instanceId, action)`, which checks the
registration and view epoch again. `actionOwners` is
`<viewEpoch>/<instanceId>`, so the iframe bridge renews its authorization
whenever the instance changes. Reusable item ids alone are never trusted (M5).

## 9. Test evidence

| Suite                 | Baseline |                                                            P1-07B3 |
| --------------------- | -------: | -----------------------------------------------------------------: |
| Unit / integration    |      409 |                 420 (+5 dom page-surface/host, +6 XR Lab M4/M5/M7) |
| Playground E2E        |       38 |                                                                 38 |
| XR Lab E2E            |      292 | 308 (+16: M1, M2, M3, M6 × Three.js/Babylon.js × Chromium/Firefox) |
| External consumer E2E |       12 |                                                                 12 |
| Package smoke         |     pass |       pass (+ page-surface API in packed ESM and declarations, M8) |

New tests:

| Test | Where                                          | What it checks                                                                                                                                     |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1   | `e2e/runtime-migration.spec.ts`; SDK unit test | Page-surface composition; DOM box vs renderer projection < 2 px; `elementFromPoint` and a real click hit the original button; one compositor owner |
| M2   | `e2e/runtime-migration.spec.ts`                | Native extract, drag, restore, re-extract on the same node                                                                                         |
| M3   | `e2e/runtime-migration.spec.ts`                | Adaptive show, Move, hide, show: new instance, Move offset per instance, real 3D button runs the action once                                       |
| M4   | `src/evaluation/runtimeMigration.test.tsx`     | Native ↔ Adaptive switches; refused switch (containment, invalid source, duplicate) with rollback                                                  |
| M5   | `src/evaluation/runtimeMigration.test.tsx`     | Stale pointer session and stale button/select/close callbacks; Move offsets scoped to the instance                                                 |
| M6   | `e2e/runtime-migration.spec.ts`                | Website/split switch, workspace unmount and remount: Native ends, Adaptive is kept, no SDK marks, subscriptions balanced                           |
| M7   | `src/evaluation/runtimeMigration.test.tsx`     | Baseline neither constructs nor connects a runtime; positive control for SpatialFlex                                                               |
| M8   | `scripts/pack-smoke.mjs`                       | Packed packages: one runtime class behind both entry points, `relocate` and `connectHost`, page-surface types in the declarations                  |
| SDK  | `packages/dom/src/presentationRuntime.test.ts` | Page-surface transform equals `NativeCompositor`'s; frame authority; Native-only host scope; `relocate`; `instancePrefix`                          |

**Retargeted tests (not weakened).** In `hardening.test.tsx`, the tests
"Native DOM handles follow the element, not only the id" and "the compositor
releases a replaced element" drove the deleted XR Lab hooks directly. They
now assert the same invariants through the XR Lab's real path: a component is
extracted, unmounted, remounted and extracted again. The old handle takes no
input and the new one does, and the old element keeps no transform or marks.
No other existing test or tolerance was changed.

Evidence: `docs/evidence/p1-07b3/`.

- M1, M2, M3 and M6 JSON per engine and browser, plus `m1-page-surface.png`
  (Three.js, Chromium).
- The consumer's E1–E6 evidence and `pack-smoke.json`.

Historical evidence (P1-06 through P1-07B2) is not modified.

## 10. Remaining limitations

- **One page surface and one frame source per runtime.** A second frame
  reporter is ignored rather than routed.
- **Native support before the first surface frame.** The check uses the
  viewport as the containing block, so the page would be reported as a
  capturing ancestor. The XR Lab offers extraction only once the surface is
  visible.
- **The adapter is still a translation layer** of about 430 lines for the
  rich `LabIntegration` contract (diagnostics, legacy strategy API).
  `usePresentation` remains for Baseline.
- **Occlusion is plane-level** (rectangles); there is no per-pixel 3D
  occlusion.
- **The iframe bridge has no Native DOM path**, as before.
- **Main's CI run for the baseline commit** (run 44522877239) failed in the
  e2e job's `playwright install --with-deps` step on an apt network error
  (`Connection failed`, `SSL connection failed`). It was infrastructure, not
  code; the local baseline and this branch's CI were run separately.

## 11. Multi-surface extension considerations

These identities stay separate, and there are no global maps or singletons:

- Workspace: registry and controller.
- Registered item: id.
- Registration instance: `registrationOf`.
- Presentation instance: `instanceId`.
- Rendering host: a `PresentationHost` handle.
- Future surface: a `ContainingSurface` per frame.

Two workspaces are isolated (P1-07B2 tests).

Future extension points:

- **Multiple page surfaces:** a surface id on `PresentationPlacement`, with
  the runtime grouping targets per surface and compositing each group with its
  own `ContainingSurface`.
- **Host-specific cameras:** replace the single authoritative frame source
  with frames keyed by host, and bind each Native target to its host.
- **Cross-surface hit testing and event ownership:** handle rays per host
  frame; the instance and registration checks already scope events.
- **Independent document contexts:** one runtime per document (the iframe
  bridge keeps Adaptive-only routing); no cross-document event bridge is
  implied.
