# P1-07B External React Integration and SDK Boundary Extraction

Status: **experimental, desktop.** An independent React application now integrates SpatialFlex through package entry points only. It also builds and runs from packed artifacts installed outside this repository.

Baseline: `main` at `8a0ead1757208c3f125416df499b1435f71ff2d4` (P1-07A merged; 372 unit/integration and 330 browser E2E tests).

## 1. Architecture audit (before)

Dependency direction:

```text
@spatialflex/core  ←  @spatialflex/react  ←  apps/xr-lab (integration, surface, manipulation, hosts)
                                          ←  apps/playground
```

| Capability                                                                                                                | Where it was                                                        | Class                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------- |
| Registration, detach/attach, `SpatialItem`, semantic `xr` views, `useSpatialViews`, `registry.invokeView`                 | `@spatialflex/react`, `@spatialflex/core`                           | **A** public              |
| `controller.extractNative`, `placement`, `nativeElement`, `sourceElement`; manipulation handles rendered by `SpatialItem` | `@spatialflex/react`                                                | **A** public              |
| `SpatialManipulator` (poses, sessions, rays)                                                                              | `@spatialflex/core`                                                 | **A** public              |
| Item-addressed manipulation (`ManipulationAdapter`: item ↔ presentation instance, stale-input rejection)                  | `apps/xr-lab/src/integrations/spatialflex`                          | **B** reusable, trapped   |
| Projection math: world pose → CSS `matrix3d`, visibility, occlusion clips, rays from client points                        | `apps/xr-lab/src/surface/surfaceMath.ts`                            | **B**                     |
| Containment diagnostics (P1-07A rule table)                                                                               | `apps/xr-lab/src/surface/nativeContainment.ts`                      | **B**                     |
| Native element placement per frame (ownership-aware release, element replacement, `offsetParent` check)                   | inside `useSurfaceCompositor` (lab hook, coupled to the lab's page) | **B**                     |
| Handle input binding (`useNativeHandles` → `bind`) and pointer lifecycle                                                  | `apps/xr-lab/src/manipulation`, `hosts/shared`                      | **B**                     |
| Camera frame contract (`HostCameraFrame`)                                                                                 | `apps/xr-lab/src/contracts/xrHost.ts`                               | **D** missing from SDK    |
| Spatial web surface (whole page in 3D), inspector UI, fixtures, Three.js/Babylon.js hosts, bridge                         | `apps/xr-lab`                                                       | **C** lab-specific        |
| XR Adaptive presentation lifecycle (instance ids, show/hide, stale-action rejection)                                      | `apps/xr-lab/src/integrations` (`usePresentation`)                  | **B**, not extracted (§7) |

Audit questions, answered against the baseline:

1. **Register and detach components?** Yes: `SpatialWorkspace`, `SpatialItem`, the controller.
2. **Native DOM spatial extraction?** Only half. `extractNative` detached the element, but placing it at a world pose (the compositor) existed only inside the lab.
3. **Manipulate poses independently of the XR Lab?** Only with raw `SpatialManipulator`. Item addressing and DOM handle binding were in the lab.
4. **Connect an external camera or renderer?** No public contract: `HostCameraFrame` was a lab type.
5. **XR Adaptive through a reusable contract?** The data contract yes (`xr` views, `invokeView`); the presentation lifecycle no.
6. **Built and consumed without workspace resolution?** **No.**
   - The emitted ESM used extensionless relative imports. Node rejected the built core: `ERR_MODULE_NOT_FOUND: …/dist/strategies`.
   - Every app consumed sources through the `source` export condition.
7. **What had to be extracted?** The B rows above, except the Adaptive lifecycle.

## 2. Boundary (after)

```text
@spatialflex/core      no React, no DOM, no renderer      SpatialManipulator, ItemManipulator (new), registry, strategies
@spatialflex/dom (new) DOM only; depends on core          NativeCompositor, containment diagnostics, bindNativeHandles,
                                                          trackManipulationPointer, projection math, CameraFrame
@spatialflex/react     React; depends on core             SpatialWorkspace, SpatialItem, controller, hooks (unchanged API)

apps/xr-lab                 → core, react, dom (its old modules are now re-exports)
examples/external-react-consumer → core, react, dom (+ three, MUI, Recharts) through package exports only
```

Invariant kept: **the application owns behavior, SpatialFlex owns spatial placement and presentation lifecycle, and the renderer owns drawing.**

- The consumer's Three.js view reports camera frames and rays.
- `ItemManipulator` → `SpatialManipulator` is the only manipulation engine.
- A lint rule and a unit test (`packages/dom/src/boundary.test.ts`) keep core and dom free of React, Three.js and Babylon.js.

### Public API changes (additive)

| Package                  | Added                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@spatialflex/core`      | `ItemManipulator`, `ManipulablePresentation`, `ItemManipulationSnapshot`, `ItemManipulationTarget`, `NudgeDirection`                                                                                                                                                                                                                                                                                                                                          |
| `@spatialflex/dom` (new) | `NativeCompositor` (`setTargets`, `composite`, `issues`, `dispose`), `NativeTarget`, `NativePlacement`, `ContainingSurface`, `CompositeOptions`, `NativeIssues`; `nativeContainmentIssues`, `containmentReason`, `describeElement`, `ContainmentIssue`; `bindNativeHandles`, `NativeHandleManipulation`; `trackManipulationPointer`; `CameraFrame`, `viewportRay`, `viewportPanelTransform`, `viewportClipPath`, `transformedQuad` and the projection helpers |
| `@spatialflex/react`     | none                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

New behavior in the moved code: **viewport mode**. Without a containing surface, `NativeCompositor` places an element whose containing block is the viewport. That is an ordinary page with a canvas, not the lab's transformed page. It clips the element to the canvas and to occluders in front of it. The containment check then walks every ancestor up to the root.

### Packaging changes

- Relative imports in the SDK sources carry `.js` extensions, so the emitted ESM loads in Node and in any bundler.
- `examples/*` joined the pnpm workspace.
- Unchanged: `private: true`, version `0.0.0`, no publication. `pnpm pack` rewrites `workspace:*` to `0.0.0`, which is verified.
- The `source` export condition still points to `./src`, which is not packed. Only tooling that opts into that condition (the lab, the playground) uses it; default resolution never does. This is verified by the smoke test.
- Peer dependencies: `@spatialflex/react` → `react ^19`. `@spatialflex/dom` and `@spatialflex/core` have none.

## 3. Minimal usage (as implemented)

The consumer's integration, condensed from `examples/external-react-consumer/src/spatial/useSpatialRuntime.ts`:

```tsx
import { ItemManipulator } from "@spatialflex/core";
import {
  NativeCompositor,
  bindNativeHandles,
  nativeContainmentIssues,
  containmentReason,
  viewportRay,
} from "@spatialflex/dom";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialController,
  useSpatialItems,
} from "@spatialflex/react";

// 1. Wrap components (application code otherwise unchanged).
<SpatialWorkspace>
  <SpatialItem id="incident-counter" detachable presentation="native">
    <IncidentCounter />
  </SpatialItem>
</SpatialWorkspace>;

// 2. Extract, after checking compatibility.
const reason = containmentReason(
  nativeContainmentIssues(controller.sourceElement(id), null),
);
if (!reason) controller.extractNative(id, "placeholder");

// 3. One manipulator and one compositor; targets and handles per extraction.
items.sync([
  {
    itemId: id,
    presentationId: "native-1",
    registrationId: id,
    kind: "native",
    initial: { position: [0, 1.5, -1], rotation: [0, 0, 0, 1], scale: 1 },
    extent,
  },
]);
compositor.setTargets([
  {
    id,
    element: controller.nativeElement(id)!,
    placement: () => ({ ...items.poseOf(id)!, metersPerPixel: 0.0022 }),
  },
]);
const binding = bindNativeHandles(items, [{ id, element }], (x, y) =>
  viewportRay(lastFrame, x, y),
);

// 4. The renderer adapter, after each rendered frame:
compositor.composite({ viewProjection, viewport: canvasRect, eye });

// 5. Restore and clean up.
controller.attach(id);
binding.dispose();
compositor.setTargets([]);
```

## 4. Build, pack and install outside the workspace

```bash
pnpm install --frozen-lockfile
pnpm smoke:pack            # node scripts/pack-smoke.mjs
```

`scripts/pack-smoke.mjs` (also run in CI) does the following:

1. Builds and `pnpm pack`s core, dom and react.
2. Checks each tarball: no `workspace:` specifiers, export targets present, no `src/`.
3. Copies the consumer's **application sources only** into a new directory under the OS temp dir, and checks that it is outside the repository.
4. Installs the tarballs with `npm`. npm `overrides` make the inter-package `0.0.0` dependencies resolve to the same tarballs.
5. Checks Node ESM resolution. All three packages import, and each resolves into that directory's `node_modules`.
6. Runs `tsc --noEmit` against the emitted declarations, with `skipLibCheck: false`.
7. Runs `vite build` and checks the bundle for repository paths.
8. Serves the build and runs the consumer's E1 and E5 browser tests against it.

Reference consumer in the repository (resolves the SDK's `dist`, never sources):

```bash
pnpm -r --filter "./packages/*" build
pnpm --filter external-react-consumer dev
```

## 5. What works and what is refused

| Feature (consumer)                                                                                                 | Status                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Normal rendering; registration of 4 components                                                                     | ✅                                                                                                                            |
| Select a component; Native DOM compatibility shown before extraction                                               | ✅                                                                                                                            |
| Native DOM extraction of the original node                                                                         | ✅ Same nodes, local state, Context, handlers; one store subscription per subscriber; CSS width unchanged; reserved footprint |
| Move, yaw, uniform scale (pointer and keyboard), Escape/Enter                                                      | ✅ Placement within 2 px of the app's own Three.js projection                                                                 |
| Camera orbit keeps committed poses; handles never move the camera                                                  | ✅                                                                                                                            |
| MUI TextField, Switch, Select (menu in a portal) inside a native panel                                             | ✅                                                                                                                            |
| Recharts `LineChart` inside a native panel, updating from the store                                                | ✅                                                                                                                            |
| XR Adaptive panels drawn by the app's renderer from `xr` views; drag and the semantic action                       | ✅ The action runs once                                                                                                       |
| Re-extraction gives a new presentation instance; unmount mid-drag ends it; renderer disposal restores and releases | ✅                                                                                                                            |
| A component in a `will-change: transform` carousel                                                                 | **Refused before placement**, naming `div.carousel` and `will-change: transform`. XR Adaptive stays an explicit choice.       |
| Immersive WebXR, hand or controller input                                                                          | ❌ Out of scope (desktop only)                                                                                                |

The CSS limits are those of P1-07A ([matrix](p1-07a-native-compositor-hardening.md)). In viewport mode the containing block must be the viewport, so the rule table applies to every ancestor up to the root.

## 6. Tests and evidence

| Suite                    | Count                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration         | **389** = baseline 372 + 17 new (3 core `ItemManipulator`, 10 dom runtime, 4 dom boundary). By package: core 167, dom 45 (including the 31 containment tests moved from the XR Lab), react 83, playground 14, xr-lab 80 (111 − 31 moved). Every existing test still runs. |
| Browser E2E (repository) | Playground 38 + XR Lab 292 (unchanged, Three.js/Babylon.js, Chromium/Firefox) + **consumer 10** (E1–E5 × Chromium, Firefox) = **340**                                                                                                                                     |
| Package smoke (E6)       | 9 checks plus E1 and E5 against the packaged build (Chromium)                                                                                                                                                                                                             |

Evidence in `docs/evidence/p1-07b/`:

- `pack-smoke.json`: tarball manifests, resolution paths, installed versions.
- `consumer-{chromium,firefox}.json`: poses, presentation instances, diagnostic text.
- `e1-native-*.png`, `e2-manipulated-*.png`, `e3-mui-*.png`, `e5-diagnostic-*.png`: illustrations only; the assertions are in `examples/external-react-consumer/e2e/consumer.spec.ts`.

Findings while building the consumer:

- **Placement liveness:** the consumer at first decided liveness with `controller.placement(id)` alone. That is not reactive: an unmount happens after the render that caused it. So unmounting a native component mid-drag left its presentation alive, and the stale drag kept moving it. E4 caught it. The fix in the app is to subscribe with `useSpatialItems()`, as the lab does. Recorded as a DX gap.
- **Firefox and port 4190:** Firefox refuses port 4190 (ManageSieve, on its unsafe-port list) with a "Blocked Page". The consumer's tests use port 4186.

## 7. External DX evaluation

| Measure                   | Result                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SpatialFlex imports       | 3 packages; 21 named imports (types included), 17 of them in the glue hook `useSpatialRuntime.ts`                                                                                                                                 |
| Configuration             | None: no Vite aliases or conditions, no global setup. One document-level style rule is injected by `NativeCompositor`.                                                                                                            |
| Component wrappers        | One `SpatialItem` per component, plus one `SpatialWorkspace`                                                                                                                                                                      |
| Application files touched | 4 of 6: `Widgets.tsx` (wrappers), `App.tsx` (workspace + controls), and the new `spatial/useSpatialRuntime.ts` (~320 lines) and `spatial/SpatialView.tsx` (~340 lines, of which the SDK-facing part is the camera frame and rays) |
| Diagnostics               | Actionable: the ancestor, property, value and remedy                                                                                                                                                                              |
| Cleanup the app owns      | `binding.dispose()`, `compositor.setTargets([])` / `dispose()`, `items.dispose()`, and restoring natives when the 3D view closes                                                                                                  |

Missing or awkward, kept as follow-ups (no API was invented for them):

1. **No React bindings for the DOM runtime.** Every app writes the same ~150 lines of glue: sync, targets, handles, camera copy. A `useNativePresentation` hook in a React-facing entry point would remove most of it.
2. **Placement is not observable.** An app must subscribe with `useSpatialItems()` to notice an unmount that ends a native presentation (finding above).
3. **The XR Adaptive presentation lifecycle is still in the XR Lab** (`usePresentation`, instance ids, stale-action rejection). The consumer manages its own adaptive instances with public APIs, and checks the registration on actions through `invokeView`.
4. **Pointer lifecycle is duplicated:** `hosts/shared/manipulationPointer.ts` in the lab and `trackManipulationPointer` in dom. The lab's renderer-neutral host layer may not depend on the SDK, by design: baseline mode never loads SpatialFlex.
5. **Packages are private, at version `0.0.0`, with no npm publication**, and the `source` export condition remains in their manifests.
6. **`metersPerPixel`, start poses and the native extent are the app's choice.** There is no SDK default layout.

## 8. Remaining architecture gaps

- The spatial web surface (the whole page as a 3D plane), the lab's inspector UI and the Babylon.js/Three.js hosts stay in the XR Lab by design (class C).
- Items 1–4 above.
- Immersive XR, hand/controller input, persistence and arbitrary-website extraction remain out of scope.
