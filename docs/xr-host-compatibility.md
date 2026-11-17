# XR Host Compatibility (P1-02)

This document records whether SpatialFlex's logical item registration, the
application-owned state and the interaction contract work with **more than one
independent XR rendering engine**. It extends the [XR Lab](xr-lab.md) (P1-00),
which used one engine, with a second one: Babylon.js.

The question is renderer portability: can the same app, the same integration
adapters and the same tests drive two engines that share no rendering code?
It is not a comparison of which engine is better.

## Three models, kept apart

| Model                 | What it means                                                                                                                                                                                       | Status                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Mirror to XR**      | A separate spatial representation of a registered logical item, connected to the same application state and actions. The original React component and DOM stay in the web page.                     | Implemented (P1-00, now in two engines)                                |
| **Detach to XR**      | The future user-facing goal: move a registered logical element into a spatial workspace (the XR counterpart of P0's same-page detachment).                                                          | Not implemented                                                        |
| **Cross-Host Bridge** | Communication between separate execution environments (snapshots, revisioned updates, semantic action requests). Required when the renderer does not run in the same JavaScript context as the app. | Not implemented ([#7](https://github.com/ppsssj/SpatialFlex/issues/7)) |

This PR does **not** transfer original React DOM nodes or component instances
into Babylon.js or Three.js. Both engines render a mirror.

## Why Babylon.js

- **Independent:** it shares no code with Three.js, React Three Fiber or
  `@react-three/xr`. It has its own scene graph, materials, picking, camera
  system and WebXR implementation.
- **Standards-based WebXR:** `WebXRDefaultExperience` drives `navigator.xr`
  directly, so it runs against the same browser and emulator runtime.
- **Officially documented React integration:** the engine is created in a
  `useEffect` on a canvas ref and disposed on unmount. No React renderer for
  Babylon (such as `react-babylonjs`) is needed, so the host stays plain
  Babylon.js.
- **Version:** `@babylonjs/core` 9.36.0, the latest release older than pnpm's
  minimum release age. 9.37.0 was one day old.

## Renderer-neutral interfaces

`apps/xr-lab/src/contracts/` holds everything the engines share. It imports no
rendering engine.

| Module         | Contents                                                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xrHost.ts`    | `HostPanel` (id, title, position in meters, body `value`/`bars`/`swatch`, buttons, selected), `HostEvents` (`onPanelButton`, `onPanelSelect`, `onPanelClose`), `XRHostProps`, `HostModule`, panel and button sizes, the desktop camera, and `panelLayout()` (where every panel part goes) |
| `hostProbe.ts` | Read-only diagnostics every host reports: screen and world position of panel parts, hover, frames, panel redraws, live panel textures, mounted hosts                                                                                                                                      |

`hosts/shared/` adds engine-free code both hosts use: the 2D canvas drawing of
panel and button faces (so both engines show identical pixels), the DOM
toolbar, and the availability hook.

World convention for every engine: meters, y up, −z forward (right-handed);
the XR origin is the world origin.

```text
            ┌───────── contracts/xrHost.ts ─────────┐
            │ HostPanel data in  ·  HostEvents out   │
            └──────▲───────────────────────▲─────────┘
                   │                       │
   integrations/{baseline,spatialflex}     │ implements Host
   (unchanged by this PR except imports)   │
                                 ┌─────────┴──────────┐
                           hosts/three           hosts/babylon
                     (R3F, three, @react-three/xr)  (@babylonjs/core)
```

## Dependency boundaries

`eslint.config.js` enforces them with `no-restricted-imports`. Planted
violations were checked to fail.

| Directory                                 | May not import                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `contracts/`, `hosts/shared/`             | any rendering engine, SpatialFlex, the app, integrations, hosts, shell, devtools                    |
| `hosts/three/`                            | Babylon.js, `hosts/babylon`, SpatialFlex, the app, integrations, shell, devtools                    |
| `hosts/babylon/`                          | Three.js, R3F, `@react-three/*`, `hosts/three`, SpatialFlex, the app, integrations, shell, devtools |
| `integrations/` (all)                     | any rendering engine, any host (only the contract)                                                  |
| `integrations/{contract,common,baseline}` | SpatialFlex                                                                                         |
| `fixtures/`                               | any XR library, contracts, hosts, integrations                                                      |
| `shell/`, `devtools/`                     | any rendering engine, hosts, adapters, SpatialFlex                                                  |

`main.tsx` loads the selected engine and integration with dynamic imports. E2E
tests check that only the selected engine is downloaded (the Three.js library
is never loaded for Babylon.js) and that baseline mode never loads SpatialFlex.

## Responsibilities and state ownership

| Owner                            | Responsible for                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application fixture              | Domain state (`sharedCount`, `actionCount`, chart history, image variant), business actions, data updates                                                          |
| SpatialFlex (`spatialflex` mode) | Registering the dashboard widgets as SpatialItems; registry-driven discovery; registration lifecycle; which registered items are eligible for spatial presentation |
| Integration adapter              | Mapping eligible items to `HostPanel` data; presentation state (shown, offsets, selection); routing panel events to the app's actions                              |
| XR host (either engine)          | Scene, camera, lighting, 3D rendering, spatial transforms, pointer and XR input, hover feedback                                                                    |
| Dev tooling                      | Installing the IWER emulator as the WebXR runtime (dev and test builds only)                                                                                       |

Neither engine owns or copies domain state. Both receive the same plain
`HostPanel` data and the same event callbacks. **SpatialFlex Core and the
React package are unchanged** by this PR, and the integration adapters changed
only their import path.

## Test matrix

Engines `three`, `babylon` × integrations `baseline`, `spatialflex` × browsers
Chromium, Firefox. Every combination runs the same specs, steps and assertions
(`apps/xr-lab/e2e/`), against the production build.

### Desktop 3D: 13 scenarios per combination

1. Web action updates the XR panel.
2. A real mouse click on the 3D button runs the app's action.
3. Each click is processed exactly once (3 clicks in 3D + 2 on the web = 5).
4. Panel selection and repositioning (domain state untouched; the button works at its new place).
5. 10 show/hide cycles and the 3D close control keep state and subscriptions.
6. Unmounting a widget removes its XR panel.
7. Unsupported immersive XR is reported; desktop 3D keeps working.
8. Real canvas pointer: hover feedback, orbit, reset.
9. Shared counter flow: web +1 → panel shows 1 → 3D +1 → web 2 (2 actions) → move → 3D +1 → web and panel 3.
10. Chart reflects app data (`[0]` → `[0,1,2]`) without another store.
11. Image follows the web variant; unmount and remount the widget; show it again.
12. Resource cleanup: panel textures released when panels are removed; unmounting the workspace stops the render loop and releases every texture; remounting works with no duplicated actions.
13. Only the selected engine is downloaded, and SpatialFlex only in `spatialflex` mode.

### Results (local Windows run; Chromium = Chrome for Testing 159, Firefox 159)

`PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`. Every row below was run in both
browsers, with all 120 XR Lab tests passing.

| Engine × integration  | Desktop (13) Chromium | Desktop (13) Firefox | Immersive (IWER) Chromium | Immersive (IWER) Firefox | Physical headset |
| --------------------- | --------------------- | -------------------- | ------------------------- | ------------------------ | ---------------- |
| three × baseline      | 13/13 PASS            | 13/13 PASS           | PASS                      | PASS                     | NOT_TESTED       |
| three × spatialflex   | 13/13 PASS            | 13/13 PASS           | PASS                      | PASS                     | NOT_TESTED       |
| babylon × baseline    | 13/13 PASS            | 13/13 PASS           | PASS                      | PASS                     | NOT_TESTED       |
| babylon × spatialflex | 13/13 PASS            | 13/13 PASS           | PASS                      | PASS                     | NOT_TESTED       |

The 26 Vitest contract tests (the same 12 tests for both adapters plus 2
mode-specific checks) need no host and are unchanged.

### WebXR and emulator results

The emulator is IWER 2.8 with its devui, installed by the dev tooling as the
browser's WebXR runtime. Each check is a separate `test.step`. The controller
is driven only through IWER's documented remote API (`look_at`, `select`). No
XR input event is fabricated.

| Check                                                  | Three.js | Babylon.js                                          |
| ------------------------------------------------------ | -------- | --------------------------------------------------- |
| Emulator installed; immersive VR available             | PASS     | PASS                                                |
| Immersive VR session created (Enter VR button)         | PASS     | PASS                                                |
| Controllers detected                                   | PASS     | PASS (Babylon's built-in `generic-trigger` profile) |
| XR ray targets the 3D button (hover feedback)          | PASS     | PASS                                                |
| Controller select runs the app action once             | PASS     | PASS                                                |
| Web change reaches the panel during the session        | PASS     | PASS                                                |
| Exit through the host; state kept; desktop works again | PASS     | PASS                                                |

These are emulator results in both baseline and spatialflex modes, Chromium and
Firefox. They are not physical-device results.

## Differences between the two engine integrations

Each of these was found by the shared tests and resolved inside the Babylon.js
host, without changing the contract, the adapters or SpatialFlex.

| Area                | Three.js host (R3F)                                                          | Babylon.js host                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handedness          | Right-handed                                                                 | Left-handed by default. `scene.useRightHandedSystem = true`. Planes are turned to face +z, which mirrors their UVs, so textures use `uScale = -1, uOffset = 1`.                                                                                    |
| Click picking       | R3F `onClick` on meshes                                                      | Babylon picks on pointer down only. A tap carries no pick, so the host remembers what each pointer pressed and activates it on `POINTERTAP`. A quick second click is a `POINTERDOUBLETAP` (never both), also handled.                              |
| Hover picking       | R3F `onPointerOver/Out`                                                      | Move picking is off by default. Controls set `enablePointerMoveEvents`.                                                                                                                                                                            |
| XR origin           | XR origin = world origin                                                     | On entering XR, Babylon copies the desktop camera's pose into the XR camera. The host resets the initial pose in `onInitialXRPoseSetObservable`, so the XR origin equals the world origin as in Three.js.                                          |
| XR controllers      | Every controller has its own ray                                             | By default only one controller points at a time. `enablePointerSelectionOnAllControllers: true`, with hover tracked per pointer.                                                                                                                   |
| Controller profiles | `@react-three/xr`; layout profiles still fetched from a CDN                  | Online repository and controller meshes off. Babylon 9 registers its built-in `generic-trigger` controller only through the side-effect module `XR/motionController/webXRMotionControllerManager`; `forceInputProfile: "generic-trigger"`. No CDN. |
| Camera reset        | Recreate `OrbitControls`                                                     | `ArcRotateCamera` keeps coasting after a drag (inertia); reset clears the inertial offsets.                                                                                                                                                        |
| Disposal            | R3F disposes the renderer on unmount (Firefox logs "WebGL context was lost") | Panels, materials and textures disposed explicitly, then `scene.dispose()` and `engine.dispose()`.                                                                                                                                                 |

One more observation: Babylon's move picking missed while the page itself was
scrolled, although pointer-down picking still hit. The root cause was not
investigated. The XR Lab layout was fixed so the page never scrolls (it is a
full-viewport app), which removed the condition.

## Resource disposal policy

- A host owns its engine, scene, render loop, panel textures and XR session.
  Unmounting the host releases all of them.
- Removing a panel disposes its meshes, materials and textures immediately.
- The probe counts live panel textures and mounted hosts. The cleanup scenario
  asserts that both return to 0 when the workspace unmounts and that the frame
  counter stops.
- Exiting XR goes through the host's own Exit VR control; the session's end
  restores the desktop camera.
- Only one engine runs at a time: the engine is chosen per page load.

## Comparative evaluation

Same workload in every combination: 2 panels and 20 real 3D clicks, idle frame
intervals over 3 s, and 3 repetitions per cell. Values are ranges across
repetitions. Headless browsers render with software GL. All timings are
**proxies**:

- "pointer → web DOM" is when the dashboard's DOM changed.
- "pointer → CPU texture update" is when the panel's canvas texture finished
  redrawing on the CPU, not when the GPU presented it.
- The frame interval is the time between JavaScript frame callbacks, not GPU
  frame time.

| Engine × integration  | Duplicate actions | Pointer → web DOM, median ms (Chromium / Firefox) | Pointer → CPU texture update, median ms (Chromium / Firefox) | JS frame interval, median ms (Chromium / Firefox) | JS loaded (decoded) | JS heap, Chromium (MB) |
| --------------------- | ----------------- | ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- | ------------------- | ---------------------- |
| three × baseline      | 0                 | 1.6–1.8 / 5–6                                     | 2.1–2.3 / 6–7                                                | 17.8–18.4 / 17                                    | 1,331,275 B         | 10.7–12.1              |
| three × spatialflex   | 0                 | 1.7 / 5                                           | 2.4–2.5 / 6                                                  | 17.9–18.1 / 17                                    | 1,339,062 B         | 12.1                   |
| babylon × baseline    | 0                 | 4.3–4.5 / 5–6                                     | 2.9–3.2 / 5                                                  | 16.6–16.8 / 17                                    | 2,011,868 B         | 14.5–17.4              |
| babylon × spatialflex | 0                 | 4.5–4.7 / 6–13                                    | 3.2 / 5–7                                                    | 16.5–16.8 / 17                                    | 2,019,655 B         | 15.4                   |

- **Within each engine**, baseline and spatialflex do not differ beyond
  run-to-run variation. SpatialFlex adds 7,787 B of JavaScript in both engines.
  No duplicated actions or console problems occurred anywhere.
- **Across engines** these numbers are not a rendering benchmark. The
  workloads go through different input pipelines: Babylon activates on tap, at
  pointer release; R3F on click. No claim is made that either engine is faster
  or slower.

### Code required

Formatted source, non-blank and non-comment lines:

| Part                                                      | Lines             |
| --------------------------------------------------------- | ----------------- |
| Renderer-neutral contract (`contracts/`)                  | 152               |
| Shared host code (`hosts/shared/`)                        | 174               |
| Three.js host (`hosts/three/`)                            | 327               |
| Babylon.js host (`hosts/babylon/`)                        | 464               |
| Baseline adapter / SpatialFlex adapter                    | 50 / 52           |
| Changes to adapters for the second engine                 | import paths only |
| Changes to SpatialFlex Core / React for the second engine | none              |

Adding an engine costs one host implementation. The adapters, the app and
SpatialFlex need no engine-specific code.

## Compatibility limitations

- **Physical headsets:** not tested. HTTPS on the LAN is not configured.
- **Emulator only:** immersive results come from IWER 2.8. The Babylon.js host
  forces the `generic-trigger` input profile, which uses the trigger and the
  ray only; device-specific buttons and controller models are not used.
- **Hands and gaze:** not exercised. Babylon's hand tracking and near
  interaction are disabled.
- **Mirror, not detach:** no DOM or React component moves into XR.
- **Same execution context:** both engines run in the app's page and React
  tree. Separate runtimes need the cross-host bridge (#7).
- **Desktop picking under page scroll (Babylon.js):** observed and avoided by a
  non-scrolling layout; not root-caused.
- **Remote assets:** the Three.js host still fetches controller layout profiles
  from a CDN during XR sessions.
- **Software GL:** all browser results come from headless or Xvfb software
  rendering. One flaky timeout occurred once in a Chromium × Three.js ×
  spatialflex repositioning test and did not reproduce in 12 repeated runs.
