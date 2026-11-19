# P1-07B2 React Runtime Bindings and Presentation Lifecycle

Status: **experimental, desktop.** Follow-up to [P1-07B](p1-07b-external-react-integration.md). Baseline: `main` at `02597a94e9cf6d74ae68b200555f37c456cacced` (389 unit/integration, 340 browser E2E, package smoke passing).

## 1. Audit: who owned what in the P1-07B consumer

`examples/external-react-consumer/src/spatial/useSpatialRuntime.ts` (316 lines) mixed three kinds of responsibility:

| Responsibility                                                        | Class                | Before                                  | After                                                   |
| --------------------------------------------------------------------- | -------------------- | --------------------------------------- | ------------------------------------------------------- |
| Start slots, meters per pixel, adaptive panel size                    | A, application       | consumer                                | **consumer**                                            |
| Presentation instance map and id counter (`native-N`, …)              | B, SDK               | consumer                                | `PresentationRuntime`                                   |
| Registry liveness: unmount and re-registration; the P1-07B finding    | B                    | consumer (`useSpatialItems` workaround) | `PresentationRuntime` + `registry.registrationOf`       |
| `ItemManipulator.sync` of the live presentations                      | B                    | consumer                                | `PresentationRuntime`                                   |
| `NativeCompositor.setTargets`, `bindNativeHandles` and their disposal | B                    | consumer                                | `PresentationRuntime`                                   |
| Containment validation before extraction                              | B                    | consumer (called the rule table)        | `runtime.nativeSupport`                                 |
| Stale action rejection for Adaptive panels                            | B                    | consumer (view epoch only)              | `runtime.invoke` (instance + registration + view epoch) |
| Restore everything when the 3D view closes                            | B                    | consumer (`restoreAll` before unmount)  | the last `host.disconnect()`                            |
| Camera frame copy, rays, default occluders                            | C, renderer contract | consumer                                | `PresentationHost` (`frame`, `rayAt`)                   |
| Three.js scene, meshes, picking, textures, OrbitControls              | A/C, renderer        | consumer                                | **consumer** (unchanged)                                |

Not moved, on purpose: renderer code, layout policy and the app's controls UI.

## 2. Dependency graph

```text
Before (P1-07B)
  core ← dom ← consumer glue (ItemManipulator + NativeCompositor + bindNativeHandles + maps + cleanup)
  core ← react ← consumer

After (P1-07B2)
  core   (no React, no DOM)      + registry.registrationOf
  dom    (DOM, → core)           + PresentationRuntime  (composes ItemManipulator, NativeCompositor, bindNativeHandles)
  react  (React, → core)         + useSpatialPlacement (main entry)
  react/spatial (→ core, dom)    useSpatialPresentations, useSpatialManipulationState   ← consumer (≈50 lines of policy)
```

- `@spatialflex/react` now depends on `@spatialflex/dom`, used only by the `./spatial` entry point. The main entry does not import it, so 2D-only users (P0, the playground) never load the DOM runtime.
- Core stays free of React and the DOM, and dom stays free of React and renderers. Both are enforced by the lint rule and `packages/dom/src/boundary.test.ts`.
- `SpatialManipulator` is still the only transform engine. The runtime keeps no pose; it reads `ItemManipulator`.

## 3. API (implemented)

| Export                                 | Entry                                                    | Purpose                                                                                                |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `registry.registrationOf(id)`          | `@spatialflex/core`                                      | Identity of the current registration (`"<workspace>/<n>"`). Unique across registries and never reused. |
| `useSpatialPlacement(id)`              | `@spatialflex/react`                                     | Reactive `"viewport" \| "external" \| null`. Read-only.                                                |
| `PresentationRuntime`                  | `@spatialflex/dom` (also re-exported by `react/spatial`) | The lifecycle (§5)                                                                                     |
| `useSpatialPresentations()`            | `@spatialflex/react/spatial`                             | `{ runtime, presentations, issues, version }` for the nearest workspace, connected while mounted       |
| `useSpatialManipulationState(runtime)` | `@spatialflex/react/spatial`                             | `{ active, selected }`. Re-renders on manipulation, not on frames.                                     |

`PresentationRuntime` members:

- **Queries:** `nativeSupport(id)`, `adaptiveSupport(id)`, `presentationOf(id)`, `adaptivePanels()`, `subscribe`/`getSnapshot`.
- **Lifecycle:** `extract(id, kind, placement)` returns `{ ok, presentation } | { ok: false, reason }`; also `restore(id)` and `restoreAll()`.
- **Actions and hosts:** `invoke(instanceId, actionId)`; `connectHost()` returns `{ frame, rayAt, disconnect }`.
- **Manipulation:** the `manipulation` property is the runtime's `ItemManipulator`.

## 4. Identity and subscription contract

Identities kept separate:

- **Workspace:** a registry plus its controller. Each `<SpatialWorkspace>` owns one, with no global instance.
- **Registered item:** `id`, unique within a workspace only.
- **Registration:** `registrationOf(id)`. A remount or replacement under the same id is a new registration.
- **XR view epoch:** `SpatialViewRecord.registrationId`, unchanged in meaning. It changes when a view is revoked and declared again.
- **Presentation instance:** `native-N` / `adaptive-N`, per runtime. It records the registration key and, for Adaptive, the view epoch it presents.
- **Rendering host:** `connectHost()`, counted per runtime.

Subscription contract:

- Placement changes are always published with the registry change that causes them. `extractNative` → detach, `attach`, and unmount → unregister all commit after the controller's placement state is updated. So `useSpatialPlacement` and the runtime observe them through the existing `registry.subscribe`, with no second source of truth.
- The runtime publishes an immutable, versioned snapshot only when presentations or composition issues change, never per camera frame.
- Camera frames go to `host.frame`, which keeps a copy for rays outside React.

## 5. Lifecycle policy

- **Create:**
  - Native: `nativeSupport` (registered, detachable, connected, P1-07A containment) → `controller.extractNative` → a new instance bound to the current registration key.
  - Adaptive: `adaptiveSupport` (an `xr` view) → source `visible` or `reserved` → a new instance bound to the registration key and the view epoch.
- **Liveness:** on every registry or view notification the runtime ends any presentation that no longer matches:
  - Native: the registration key differs, or placement is no longer external.
  - Adaptive: the registration key differs, or the view epoch differs.
  - Then it syncs `ItemManipulator`, so stale tokens are rejected, along with the compositor targets and the handle binding.
- **Restore:** Native → `controller.attach`; Adaptive with a reserved source → source visible. A presentation whose registration is gone restores nothing onto a new registration.
- **Switch (transaction):**
  - The new strategy is validated first. **A failed validation keeps the current presentation unchanged.**
  - If starting fails after the old one ended (for example, the controller refuses), **the original is restored**: attached and visible. There is no half state.
- **Actions:** `invoke` requires the live instance, the same registration and the same view epoch, then calls `registry.invokeView`.
- **Hosts:** the last host to disconnect ends every presentation, since nothing can show them.
- **Runtime:** `connect()` returns `disconnect`, which ends everything, unbinds handles, releases compositor-owned styles and detaches every manipulation target. `useSpatialPresentations` connects in a layout effect, so an ended presentation is never painted stale. React StrictMode's cleanup and setup cycle reconnects afresh.
- **Batching:** operations batch registry notifications and reconcile once at the end.

Native DOM keeps P1-06A/P1-07A semantics: same node and React instance, local state, Context, controlled inputs, handlers, placeholder or collapse source, and the containment diagnostics. Adaptive panels are drawn by the renderer from `xr` view data, never from cloned DOM.

## 6. Minimal integration (as in the consumer)

```tsx
import { SpatialItem, SpatialWorkspace } from "@spatialflex/react";
import { useSpatialPresentations } from "@spatialflex/react/spatial";

function Spatial() {
  const { runtime, presentations, issues } = useSpatialPresentations();
  const extract = (id: string) =>
    runtime.extract(id, "native", {
      position: [0, 1.5, -1],
      metersPerPixel: 0.0022,
    });
  // …UI: runtime.nativeSupport(id), extract, runtime.restore(id)
  return <ThreeView runtime={runtime} />;
}

// Renderer adapter (inside its effect):
const host = runtime.connectHost();
// per frame: host.frame({ viewProjection, viewport, eye });
// picking:   runtime.manipulation.begin(itemId, "translate", pointerId, ray) …
// panels:    runtime.adaptivePanels(); actions: runtime.invoke(instanceId, actionId)
// cleanup:   host.disconnect();
```

## 7. DX before and after (consumer)

| Measure                                                             | P1-07B                                                 | P1-07B2                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| SpatialFlex import statements                                       | 6                                                      | 6                                                                    |
| Named SpatialFlex imports                                           | 21                                                     | 7                                                                    |
| Glue hook (`useSpatialRuntime.ts`)                                  | 316 lines (262 code)                                   | **78 lines (54 code)**, application policy only                      |
| Named imports in the glue hook                                      | 17                                                     | 2                                                                    |
| Manual orchestration calls (sync, setTargets, bind, maps, counters) | ~20 lines                                              | 0                                                                    |
| Manual cleanup steps                                                | 4 (binding, compositor, manipulator, restore-on-close) | 0 (+1 `host.disconnect()` in the renderer's own cleanup)             |
| Renderer adapter (`SpatialView.tsx`)                                | 336 lines                                              | 347 lines (host connection; same rendering)                          |
| Application files changed by the migration                          | —                                                      | 3 (`useSpatialRuntime.ts`, `SpatialView.tsx`, `App.tsx`): +83 / −317 |

## 8. Workspace isolation and multi-surface notes

Tested:

- Two `<SpatialWorkspace>` instances registering the same item id get different registries, registration keys, runtimes, manipulation sessions and DOM bindings.
- Extracting in one changes nothing in the other.
- A replaced provider gets a new runtime, and the old one is released.

Nothing global was introduced: no global compositor, presentation map or "current workspace". (The one document-level `<style>` rule that `NativeCompositor` injects is shared by design and stateless.)

Future multi-surface work will need, and this milestone does not add:

- a workspace identity that is meaningful across documents;
- a cross-surface selection model;
- several hosts per runtime with _different_ cameras, since `rayAt` uses the last reported frame;
- page-mode surfaces in `PresentationRuntime` (the XR Lab's transformed page; see below).

## 9. Tests and evidence

| Suite            | Baseline | Now                                                                                                                                |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration | 389      | **409**: +2 core registration identity, +10 dom `PresentationRuntime`, +8 react bindings (StrictMode, isolation, SSR)              |
| Browser E2E      | 340      | **342**: Playground 38, XR Lab 292 (unchanged), consumer 12 (E1–E6 × Chromium/Firefox; E1–E5 unchanged)                            |
| Package smoke    | passing  | passing, plus `@spatialflex/react/spatial` resolution, every export subpath packed, a single React runtime, no `xr-lab` resolution |

Coverage of the required test groups:

- **T1** reactive placement: `packages/react/src/spatialRuntime.test.tsx`.
- **T2** lifecycle, switching, rollback and stale actions: `packages/dom/src/presentationRuntime.test.ts`.
- **T3** bindings, handles and unmount mid-drag: both files above.
- **T4** StrictMode, two workspaces and provider replacement: the React file.
- **T5** the consumer E2E.
- **T6** `pnpm smoke:pack`.

Evidence: `docs/evidence/p1-07b2/` (`pack-smoke.json`, `consumer-*.json`, screenshots). P1-07B evidence is unchanged.

## 10. Limitations and reduced scope

- **The XR Lab still runs its own presentation lifecycle.** It uses page-mode composition through its spatial web surface, its adaptive slot layout and `usePresentation`. Moving it onto `PresentationRuntime` needs a page-surface mode in the runtime and a slot or offset policy. This is follow-up [#33](https://github.com/ppsssj/SpatialFlex/issues/33), not part of this PR. The lab's 292 E2E tests are unchanged and passing.
- The P1-07A CSS limits apply. The runtime reports them before extraction (`nativeSupport`) and at runtime (`issues`).
- Desktop only. Renderer adapters report one camera; there is no immersive Native DOM.
- Packages remain private, at `0.0.0`, and unpublished.
