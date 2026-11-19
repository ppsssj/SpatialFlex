# P1-06B Spatial Panel Manipulation Engine

Status: **experimental, desktop.** Follow-up to P1-06A ([#24](https://github.com/ppsssj/SpatialFlex/issues/24), [native DOM extraction](native-dom-spatial-extraction.md)) and P1-06 ([#22](https://github.com/ppsssj/SpatialFlex/issues/22), [spatial web surface](spatial-web-surface.md)).

Panels extracted into space can now be grabbed, moved, rotated and resized with the mouse or the keyboard. This works for both presentation strategies, Native DOM and XR Adaptive, and for both renderers, Three.js and Babylon.js. They all use one shared manipulation engine.

**Demo:** `pnpm --filter @spatialflex/xr-lab dev --host 127.0.0.1 --port 5173 --strictPort`, then open
`http://127.0.0.1:5173/?integration=spatialflex&engine=three&bridge=off&surface=website` (or `engine=babylon`).

1. Select elements → Shared counter → **Native DOM** → Extract to Space.
2. Drag the panel's **title bar** to move it. Drag **⟲** to turn it (yaw). Drag the **corner** to resize it. `+1` and _Local note_ still work.
3. Orbit the camera by dragging empty space. The panel keeps its world pose.
4. Use **Spatial panels** in the left inspector to see poses, the active mode, **Reset transform** and **Restore**.
5. Restore, then extract the same Counter as **XR Adaptive**. Its 3D panel shows **Rotate · Move · Resize** handles below it, driven by the same engine.

## 1. Architecture

```text
SpatialItem ──── React state / registry (unchanged)
   │
   ├── Presentation strategy:  native | adaptive        (P1-06A, unchanged API)
   │
   └── Spatial transform  { position, rotation (quaternion), scale (uniform) }
              │  owned per presentation instance by
              ▼
   SpatialManipulator  (@spatialflex/core — renderer-neutral, DOM-free)
     begin / update / commit / cancel / nudge / reset / shift
              ▲  world rays + handle mode            ▲ keyboard steps
   ┌──────────┴───────────┬────────────────────────┐
 Three.js host       Babylon.js host        Native DOM handles
 (R3F raycast)       (createPickingRay)     (inverse camera of the last frame)
```

| Layer                                                      | Responsibility                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/manipulation.ts`                        | `SpatialTransform`, validation, quaternion math, and `SpatialManipulator`: the **only** place where a pose changes                                                                                                      |
| `packages/react/src/SpatialItem.tsx`                       | In external placement, renders handle affordances (`data-spatialflex-handle="translate \| rotate \| resize"`, `role="button"`, `tabIndex=0`, labelled). They come **after** `children`, so children are never remounted |
| `apps/xr-lab/src/contracts/xrHost.ts`                      | Renderer-neutral `HostManipulation` contract (`begin` returns a token, plus `update` and `end`). `HostPanel.rotation` and `HostPanel.scale` are optional. `handleLayout()` gives the shared handle geometry             |
| `apps/xr-lab/src/hosts/shared/manipulationPointer.ts`      | One pointer lifecycle for every host and for DOM handles                                                                                                                                                                |
| `apps/xr-lab/src/hosts/{three,babylon}`                    | Draw handles, report a handle press as a world ray, suspend their own camera controls. No pose logic                                                                                                                    |
| `apps/xr-lab/src/integrations/spatialflex/manipulation.ts` | Adapter: one manipulation target per **presentation instance** (`native-N`, `presentation-N`), addressed by item id                                                                                                     |
| `apps/xr-lab/src/surface/useSurfaceCompositor.ts`          | Reads poses **every frame**, without React renders, for Native DOM elements and for occluders                                                                                                                           |
| `apps/xr-lab/src/manipulation/`                            | `ManipulatedHost` merges poses into host panel data (only this component re-renders during a drag); `useNativeHandles` binds DOM handles; `ManipulationInspector`                                                       |

The shared shell does not import the SDK. The manipulator belongs to the SpatialFlex integration and reaches the shell through the structural `LabManipulation` interface (`integrations/contract.ts`), so the baseline integration is unaffected.

### Spatial transform

```ts
interface SpatialTransform {
  position: [x, y, z]; // meters, right-handed, y up, -z forward (unchanged world convention)
  rotation: [x, y, z, w]; // unit quaternion; local +z faces the viewer
  scale: number; // uniform spatial scale, 0.4 – 3
}
```

`validateTransform` rejects non-finite numbers (NaN, Infinity), wrong arity, strings, a zero quaternion and out-of-range or non-positive scales, without coercion. A non-unit quaternion is normalized. The UI exposes **yaw** (rotation about world +y); internally rotations compose as quaternions.

This reuses existing structures rather than duplicating them:

- `HostPanel.position` is the transform's position.
- Native DOM keeps its P1-06A `NativeAnchor`, which supplies the initial pose and meters-per-pixel.
- The compositor still writes `data-spatial-pose` in its Euler form (`SpatialWebSurfacePose`), converted with `eulerFromQuaternion`, so the P1-06A checks apply unchanged.

### Native DOM vs XR Adaptive

|                 | Native DOM                                                                                                    | XR Adaptive                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Handles         | SDK DOM elements inside the original element: title bar (Move), ⟲ (Rotate), corner (Resize)                   | Meshes in a row below the panel face (Rotate · Move · Resize)                               |
| Input → ray     | Inverse of the view-projection of the last rendered camera frame (`viewportRay`)                              | Engine raycast: R3F `event.ray` / `Raycaster`, Babylon `createPickingRay`                   |
| Pose applied by | The DOM compositor, `T = translate(-b) · H_page⁻¹ · H_panel(pose)`, every frame                               | The host: Three.js `group` quaternion and scale; Babylon `rotationQuaternion` and `scaling` |
| Resize          | **Spatial scale only.** The element's CSS layout size (`offsetWidth`) is unchanged; only its world size grows | Panel and its hit areas scale together (one transform)                                      |
| Identity        | Same DOM node, React instance, local state and handlers: nothing is cloned, re-parented or remounted          | Separate presentation, same app state and semantic actions                                  |

**CSS layout size vs spatial scale.** Resizing never changes the component's CSS width or height, so its content does not reflow and its design stays identical. Only the world size of the projected plane changes: `width = offsetWidth × metersPerPixel × scale`. Reflowing resize (changing CSS size) is not offered, because it would change the component's own layout.

**Facing / visibility policy.** Panels are one-sided. A Native DOM panel turned away from the camera is hidden (`planeVisibility` returns `back`), as in P1-06A; turning it back shows it again. XR Adaptive panels follow their renderer's material sidedness. Rotation is yaw-only in this milestone, so a panel never tilts.

## 2. Drag computation (perspective-correct)

Screen-pixel deltas are never converted to meters directly. On press:

1. **Grab point P₀:** where the handle's ray hits the panel's own plane. When the ray is edge-on, P₀ is at the center's depth along the ray instead.
2. **Drag plane:** passes through P₀. It is the **panel's own plane** while the ray meets it within about 70° of its normal (`|cos| ≥ MIN_PLANE_FACING = 0.35`); otherwise it is the plane facing the ray (normal `−d₀`).

With the panel's own plane, a panel slides without drifting in depth: an unrotated Native DOM panel stays parallel to the page it came from, 0.3 m in front of it, so it never slips behind the page. An earlier plane that faced the ray did let obliquely grabbed panels drift behind the page; the CI run on Linux Firefox caught it, and the E2E now drags across the page to cover it.

On each move, the ray is intersected with that plane at P:

- **Translate:** `position = start + (P − P₀)`. The grabbed point stays exactly under the pointer at any distance; a farther panel moves farther for the same pixels.
- **Rotate:** `yaw = ((P − P₀) · right) / r`, where `right` is the horizontal axis perpendicular to `d₀` and `r` is half the panel's current width. Dragging one half-width turns the panel by one radian.
- **Resize:** `scale = start × |P − C′| / |P₀ − C′|`, where `C′` is the center projected onto the drag plane. The result is clamped to 0.4 – 3. A press exactly on the center is rejected.

A ray parallel to the plane or pointing away from it is ignored (the last pose is kept). A non-finite ray is rejected.

## 3. Input lifecycle and ownership

| Event                                                          | Effect                                                                                                                                                                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Press on a handle                                              | `begin(presentation, mode, pointer, ray)` returns a **token**, or null for an unknown or ended presentation, an active session (a duplicate press) or an ungrabbable ray. The panel becomes **selected** |
| `pointermove` of that pointer                                  | `update(token, ray)`                                                                                                                                                                                     |
| `pointerup` (or a move with no button pressed: missed release) | `commit(token)`                                                                                                                                                                                          |
| `pointercancel`, window `blur`, unmount, host disposal         | `cancel(token)`: back to the pose at press                                                                                                                                                               |
| Escape                                                         | `cancel(token)`. The press still belongs to the handle until release, so the rest of that drag can never orbit the camera                                                                                |
| Reset transform                                                | Back to this instance's initial pose                                                                                                                                                                     |

**Stale input.** Each session has its own token. `update`, `commit` and `cancel` with any other token are rejected.

- Ending a presentation (Restore, unmount, Native → Adaptive) detaches its instance and cancels its session. Input still in flight cannot reach the next instance of the same component.
- Every extraction is a **new instance** (`native-2`, `presentation-3`, …) with its own initial pose.

**Pose policy (fixed by tests).**

| Situation                                                | Pose                                              |
| -------------------------------------------------------- | ------------------------------------------------- |
| Same presentation instance                               | Kept                                              |
| Camera orbit, surface pose change, window resize         | Kept (world pose)                                 |
| The integration's Move buttons move the layout placement | Initial and current pose shift together (`shift`) |
| Restore, then extract again                              | Default placement (a new instance)                |
| Reset transform                                          | This instance's initial pose                      |

Persisting user placements across extractions is out of scope.

**Ownership records** (`ActiveManipulation`): token, presentation instance id, registration id, mode, input (`pointer` or `keyboard`), pointer id, and the start pose (the cancel target). The current pose is `transform(id)`; the committed pose is the transform after `commit`.

### Camera vs panel input

- **Three.js:** OrbitControls receives the press before R3F does (listener order on the canvas). On a handle press the host sets `controls.enabled = false`; OrbitControls then ignores the moves, and its release handler still cleans up. The host re-enables it on the **actual release**.
- **Babylon.js:** the camera's pointer input observes `onPointerObservable`. While a manipulation pointer is held, an `onPrePointerObservable` observer sets `skipOnPointerObservable` for move and wheel events, so the camera never sees them. Presses and releases still reach it. Handle presses are also excluded from the existing desktop click activation, so the earlier Babylon pointer fixes (blur and drag latch) are unchanged.
- **Native DOM handles** are DOM elements above the canvas; the canvas never sees their events.
- A drag outside panels and handles orbits the camera as before.

### Keyboard

The handles are focusable (`role="button"`, `tabIndex=0`, labelled "Move / Rotate / Resize ‹label› in space"). The steps go through the same controller (`nudge`):

| Key            | Move                | Rotate       | Resize      |
| -------------- | ------------------- | ------------ | ----------- |
| ← → (↑ ↓)      | 2 cm on world x (y) | 5° yaw (← →) | ×1.1 / ÷1.1 |
| Shift + arrows | 10 cm               | 15°          | ×1.25       |

- The steps form one keyboard session per panel, so Tab between the panel's handles continues it.
- **Escape** reverts the whole session. **Enter** or moving focus out of the panel commits it.
- A mouse press commits pending keyboard steps.

### Future input (hand tracking, XR controllers)

The engine consumes `SpatialRay`s and a handle mode, not mouse events. An XR controller ray (`XRInputSource.targetRaySpace`) or a hand pinch ray can call the same `begin`, `update` and `commit` or `cancel` with its own pointer id.

The hook points are:

- `HostManipulation.begin(panelId, mode, pointerId, ray)`, implemented by the integration.
- The host's XR select path. It currently activates, so in immersive sessions handles are hidden (`manipulation` is not passed while a session is active).

Two-handed scale or rotate would need a second concurrent session; the controller currently allows one.

## 4. Performance and resource notes (not benchmarked)

- During a drag, only `ManipulatedHost` (the host) and the inspector re-render. The shell, the dashboard and the integration do not: poses live in the manipulator, an external store.
- The compositor reads poses per frame and writes styles only when they change, as before. The camera copy uses a single reused buffer.
- Each drag adds exactly one capture `pointermove` listener on the window and removes it on release (checked in E2E).
- Handle textures are created with their panel and disposed with it (`liveTextures` returns to baseline in E2E).
- No new dependency. Frame time and memory were **not measured** in this milestone (Phase 3).

## 5. Verification

Unit/integration (Vitest): **338 passed** (P1-06A baseline 287, **+51 new**).

- core `manipulation.test.ts` (34):
  - validation, including NaN, Infinity, 0 and negative values, and Euler/yaw math
  - perspective translate at two depths, grab offset, own-plane drag without depth drift and the edge-on fallback, rotate, resize with limits
  - begin/commit/cancel, duplicate presses, stale tokens, Native → Adaptive instances
  - reset, independence, keyboard sessions, `shift`
- react `manipulationHandles.test.tsx` (3): handles only in external placement, focusable and labelled, Attach stays the bar's button, no remount.
- xr-lab `manipulation.test.ts` (11): adapter instance lifecycle and the shared pointer lifecycle (Escape vs release, pointercancel, blur, missed release, disposal, listener cleanup).
- xr-lab `surfaceMath.test.ts` (+3): quaternion↔Euler, transformed quads and viewport rays equal Three.js `Raycaster` rays.

Browser E2E (Playwright, real mouse and keyboard, Chromium + Firefox, workers 1): `e2e/manipulation.spec.ts` has 3 scenarios × 2 engines × 2 browsers = **12 new**. Full-suite result: see the PR.

| Scenario                                                                                                               | How it is checked                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native drag moves the world pose; the grabbed title stays under the pointer                                            | `elementFromPoint(end)` is the Move handle; the projected center moved with the pointer (< 8 px); the DOM bounding box equals the renderer's projection of the pose (< 2 px) |
| Camera does not move during a panel drag                                                                               | The page's corner markers are unchanged (< 0.5 px)                                                                                                                           |
| Orbit outside panels keeps the world pose                                                                              | Corners move > 5 px, pose unchanged, DOM still matches the projection                                                                                                        |
| Native rotate and resize                                                                                               | Yaw > 0.15 rad, scale > 1.15, CSS `offsetWidth` unchanged, projection match                                                                                                  |
| Original `+1` and _Local note_ work in the manipulated panel; same DOM nodes; React mounts and subscriptions unchanged | Element identity, fixture diagnostics                                                                                                                                        |
| Restore releases styles and listeners; re-extraction is a new instance at its default pose                             | Inline styles, presentation ids, listener counts                                                                                                                             |
| Adaptive move, rotate and resize via 3D handles; the renderer applies exactly that pose                                | Probe `worldPosition` of `background` and `close` equals the transform (< 0.1 mm); the handle is under the pointer (< 4 px)                                                  |
| Adaptive semantic `+1` runs exactly once after manipulation                                                            | `increment-calls` +1                                                                                                                                                         |
| Escape during a held drag; pointercancel; blur                                                                         | Pose returns to the drag start; the camera is unchanged after the release                                                                                                    |
| Keyboard Move, Rotate and Resize; Tab focus; Escape reverts; Enter or leaving commits                                  | Exact step sizes                                                                                                                                                             |
| Three panels (Counter native, Chart native, Image adaptive) are independent; the selection follows                     | Other poses unchanged; `data-selected` / `data-manipulation-selected`                                                                                                        |
| Repeated extract/restore cycles with drags                                                                             | `liveTextures` and window capture-listener counts return to baseline                                                                                                         |

Evidence: `docs/evidence/p1-06b-native-before.png`, `-native-moved.png`, `-native-rotated.png`, `-native-resized.png`, `-adaptive-moved.png`, `-multiple-panels.png`. Pose and projection numbers before and after each drag are in `p1-06b-manipulation.json`. The screenshots are from Three.js on Chromium. The cross-engine exploratory run produced identical poses for identical mouse input on Babylon.js (to ~1e-7 m).

Note on the synthetic events: `pointercancel` and window `blur` are platform events that real mouse input cannot produce in Playwright. The test dispatches them with the real press's pointer id while the real mouse button is held.

## 6. Supported hosts

| Host                              | Native DOM manipulation | XR Adaptive manipulation | Notes                                                                                                |
| --------------------------------- | ----------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Three.js same-context (desktop)   | ✅                      | ✅                       |                                                                                                      |
| Babylon.js same-context (desktop) | ✅                      | ✅                       |                                                                                                      |
| Cross-context iframe Host         | — (no Spatial Website)  | Poses only, no handles   | Rotation and scale are sent only when non-identity, so bridge panel data keeps its allowlisted shape |
| Immersive WebXR session           | — (DOM not composited)  | Pose shown, no handles   | Controller and hand input are future work (§3)                                                       |

## 7. Known limitations

- Desktop mouse and keyboard only; no XR controller or hand manipulation yet.
- One manipulation session at a time (no two-handed or multi-pointer gestures).
- Yaw only; no pitch, roll or depth (z) dragging. Depth changes come from the camera-facing drag plane only when the camera is not head-on.
- Uniform spatial scale only; no reflowing (CSS) resize and no non-uniform scale.
- Poses are not persisted across extractions.
- No collision avoidance between panels.
- Native DOM per-plane occlusion is as in P1-06A; adaptive occluders include the handle row.
- Performance, high-frequency input, complex CSS and long-running behavior are Phase 3 hardening.
