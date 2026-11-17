# XR Lab

`apps/xr-lab` is a **vendor-neutral WebXR test environment**. It checks whether
SpatialFlex integrates with an ordinary standards-based XR application under
the same conditions as a conventional, hand-written integration.

It is **not** a showcase tuned for SpatialFlex. The XR scene, application,
input, test data and tests are shared. Only the **integration adapter**
changes between the two modes:

| Mode                 | URL                        | What connects the app to the XR scene        |
| -------------------- | -------------------------- | -------------------------------------------- |
| `baseline` (default) | `?integration=baseline`    | Hand-written code without SpatialFlex        |
| `spatialflex`        | `?integration=spatialflex` | SpatialFlex registration and its React hooks |

## Three models that must not be conflated

| Model                                                                               | What happens                                                                                                                                                                             | Where                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **P0 Same-Host Detachment**                                                         | The original React component is moved visually with CSS. Its React instance stays mounted.                                                                                               | `apps/playground`, `@spatialflex/react` |
| **P1 XR Lab mirror** (this app)                                                     | A **separate 3D view** renders the same logical item and reads and changes the same app-owned state. The original DOM and component stay in the web dashboard. Nothing is moved into XR. | `apps/xr-lab`                           |
| **Future Cross-Host Bridge** ([#7](https://github.com/ppsssj/SpatialFlex/issues/7)) | Separate execution environments exchange snapshots, revisioned updates and semantic action requests.                                                                                     | Not implemented                         |

The XR Lab's "Show in XR" is a mirror. It does **not** convert arbitrary React
components or DOM into XR.

## Architecture

```text
                    main.tsx  ── ?integration=…  (dynamic import, one chunk per mode)
                       │
          ┌────────────┴─────────────┐
          ▼                          ▼
 integrations/baseline       integrations/spatialflex ── @spatialflex/react
          │                          │
          └──────────┬───────────────┘
                     ▼ implements IntegrationModule (integrations/contract.ts)
       integrations/common (shared XR scenario + presentation state)
                     │
   shell/ ───────────┼──────────────► host/      Neutral XR host: R3F, Three.js,
     │               │                           @react-three/xr. No app, no SDK.
     └──────────────►fixtures/                   App state + actions + web widgets.
                                                 No XR, no SDK.
   devtools/xrRuntime.ts ── creates the WebXR store; the only IWER configuration
```

ESLint (`no-restricted-imports` in `eslint.config.js`) enforces the dependency
direction:

- `host/` imports nothing from the lab and no SpatialFlex package.
- `fixtures/` imports no XR library, no host and no integration.
- `integrations/{contract,common,baseline}` and `shell/`, `devtools/` import no
  SpatialFlex package.
- Only `integrations/spatialflex/` imports `@spatialflex/*`.

In baseline mode the SpatialFlex chunk is never downloaded, and an E2E test
checks this.

### Neutral host contract (`src/host/types.ts`)

```ts
interface HostPanel {
  id: string;             // opaque
  title: string;
  position: Vec3;         // meters, world space (y up, -z forward)
  body: { kind: "value" | "bars" | "swatch"; … };
  buttons: { id: string; label: string }[];
  selected: boolean;
}
interface HostEvents {
  onPanelButton(panelId, buttonId): void;
  onPanelSelect(panelId): void;
  onPanelClose(panelId): void;
}
<XRHost store={xrStore} panels={…} {...events} />
```

The host renders panels as Three.js geometry: a textured plane, button meshes
and a close control. It handles mouse and XR ray input through R3F pointer
events (raycasting), and reports interactions as events. Panel faces are drawn
with the 2D canvas API and local system fonts, so there are no remote fonts or
textures. Coordinates are meters. CSS pixels are never interpreted as XR
coordinates.

A read-only **host probe** (`window.__xrHostProbe`) reports where a panel part
is on screen or in the world, frame times, and when each panel last drew. It is
part of the host, so it is identical for both modes, and it never triggers
interactions.

### State ownership

| Owner                                                       | Owns                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| App fixture (`fixtures/labStore.ts`)                        | `sharedCount`, `actionCount`, chart history, image variant, `increment()` and other domain actions |
| Integration adapter (`integrations/common/presentation.ts`) | Which items are shown in XR, panel offsets and selection (presentation only)                       |
| XR host                                                     | Hover feedback and the camera. No app state.                                                       |
| SpatialFlex (`spatialflex` mode only)                       | Registration of the dashboard widgets as SpatialItems                                              |

```text
Web +1  ─┐
         ├─► app.increment() ─► app store ─► web widget  (React subscription)
3D +1   ─┘                                └► adapter ─► HostPanel ─► 3D panel redraw
```

The app store is the only authoritative store; neither the host nor an
adapter copies domain state. Panel buttons map to the app's own actions in the
shared scenario (`integrations/common/scenario.ts`):

| Item id          | XR view                             | Buttons → app action             |
| ---------------- | ----------------------------------- | -------------------------------- |
| `shared-counter` | value panel at (0, 1.4, −1.2) m     | `+1` → `increment()`             |
| `live-chart`     | bar panel at (−0.75, 1.4, −1.0) m   | —                                |
| `image-panel`    | swatch panel at (0.75, 1.4, −1.0) m | `Next` → `setImageVariant(next)` |

The desktop camera is at (0, 1.5, 1.0), aimed at (0, 1.4, −1.2), with a 60°
field of view. An immersive user starts at the origin facing −z, so the panels
are about 1–1.2 m in front of them.

### What differs between the adapters

| Concern                        | `baseline`                                          | `spatialflex`                                                                |
| ------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Which items exist              | Static list in the adapter                          | SpatialItems registered by the mounted dashboard widgets                     |
| Widget unmounts (image toggle) | Adapter must know `imageMounted` and filter by hand | Item unregisters with its component; its panel is removed with no extra code |
| Action validation              | Item must be available and shown                    | Item must be registered and shown                                            |
| Dashboard DOM                  | Widgets as is                                       | Each widget is wrapped in a SpatialItem (two `div`s)                         |

## Setup

```bash
pnpm install
pnpm dev:xr-lab                    # http://localhost:5173
```

No headset is needed. Open `?integration=baseline` or `?integration=spatialflex`.

### Desktop 3D

1. Click **Show in XR** for `shared-counter`. A panel appears in the 3D workspace.
2. Click the 3D **+1** with the mouse. The web counter and the domain action
   count each increase by one.
3. Click the web **+1**. The 3D panel shows the new value.
4. Drag empty space to orbit. **Reset view** restores the camera. Click a panel
   to select it, and use the move buttons to reposition it by 0.1 m.
5. Close the panel with its 3D **x** or **Remove from XR**. The app state is kept.

### IWER emulator (immersive VR without a headset)

`@react-three/xr` bundles the IWER emulator with its devui. The lab's dev tooling
(`src/devtools/xrRuntime.ts`) is the only place that configures it:

| `?xr-emulator=`  | Behavior                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| `auto` (default) | Library default: inject on `localhost` when the browser has no immersive WebXR support |
| `iwer`           | Always inject (used by tests, which run on `127.0.0.1`)                                |
| `off`            | Never inject                                                                           |

Steps: open `http://localhost:5173/?xr-emulator=iwer`. The status shows
"immersive VR available (emulated)". Show the counter, then click **Enter VR**.
The devui shows the emulated headset view and controller inspectors. Aim the
right controller at **+1** and pull the trigger. The web dashboard updates.
Click **Exit VR** to return; the app state is kept.

The XR status distinguishes **native** (the browser's own WebXR supports
immersive VR), **emulated** (an injected emulator actually provides the
session) and **unavailable**. Enter VR is never permanently disabled, because
support can appear later. Rejected requests are shown as an error, and desktop
3D keeps working.

### Physical headset

Not tested in this milestone. WebXR on a headset requires HTTPS on the LAN
(for example `@vitejs/plugin-basic-ssl` and `vite --host`). That is not
configured.

## Library compatibility workarounds (dev tooling only)

These were needed to make the documented emulator work with the installed
versions. They live outside the host, and both modes use them identically.

1. **Aligned emulator packages.** `@react-three/xr` 6.6.32 pins `@iwer/devui`
   1.x and `@iwer/sem` 0.2 next to `iwer` 2.8. That mix loaded a second
   `three` ("e.onBuild is not a function") and let devui 1.x override
   controller poses, so emulated controllers could not be aimed.
   `pnpm-workspace.yaml` overrides `@iwer/devui` and `@iwer/sem` to 2.8.0 and
   their `three` to the app's `~0.187.0`.
2. **Forced runtime install.** IWER 2.8 does not install over an existing
   `navigator.xr`, and Chromium exposes one even without a headset. The dev
   tooling calls IWER's documented `installRuntime({ forceInstall: true })`
   after `@react-three/xr` has injected the emulator. It only injects after the
   native runtime reported no immersive support, so a real headset is never
   hidden.
3. **`offerSession: false`.** `@react-three/xr` re-requests a browser session
   offer after emulator injection and after each session. The superseded offer
   is an unhandled promise rejection. The lab enters XR through its own button.
4. **Controller and hand models off** (`model: false`). Models load from a
   remote CDN. Controller _layout profiles_ are still fetched from
   `cdn.jsdelivr.net` during an XR session (library default `baseAssetPath`).
   Desktop 3D makes no remote requests, which the E2E tests check.

## Automated tests

```bash
pnpm --filter @spatialflex/xr-lab test        # Vitest contract tests (jsdom)
pnpm --filter @spatialflex/xr-lab test:e2e    # Playwright: Chromium + Firefox
```

E2E runs against the production build (`vite preview` on `127.0.0.1:4180`,
strict port, no server reuse), with one worker. Parallel pages starve each
other because headless browsers render WebGL in software. Every test fails on
console errors or warnings except a documented list of third-party messages
(`e2e/lab.ts`), which applies to both modes alike.

**CI (Ubuntu, no GPU):** headless Firefox cannot create a WebGL context there,
even with `webgl.force-enabled`. In CI the Firefox project runs **headed under
Xvfb** (`xvfb-run`, `XR_LAB_FIREFOX_HEADED=1`); Chromium stays headless. Both
integration modes use the same setup. With this, CI passes 22/22 XR Lab tests
in each browser.

### Comparative results

`PASS` / `FAIL` / `BLOCKED` / `NOT_TESTED`, from the local Windows run in
Chromium (Chrome for Testing 159) and Firefox 159.

| #   | Scenario                                                          | baseline | spatialflex |
| --- | ----------------------------------------------------------------- | -------- | ----------- |
| 1   | Original web → XR state update                                    | PASS     | PASS        |
| 2   | XR → original web action (real canvas click)                      | PASS     | PASS        |
| 3   | Exactly-once action processing                                    | PASS     | PASS        |
| 4   | Panel selection and repositioning                                 | PASS     | PASS        |
| 5   | Repeated open/close (10× and 3D close)                            | PASS     | PASS        |
| 6   | Cleanup: widget unmount removes the panel; subscriptions released | PASS     | PASS        |
| 7   | Unsupported immersive XR reported, desktop keeps working          | PASS     | PASS        |
| 8   | Real canvas pointer: hover, orbit, reset                          | PASS     | PASS        |
| —   | SpatialFlex chunk loaded only in `spatialflex` mode               | PASS     | PASS        |

The Vitest contract suite runs the same 12 tests against both adapters (plus
2 mode-specific checks). A mutation check confirmed that it tests each mode's
own wiring: removing the baseline's hand-written lifecycle filter fails only
the baseline's cleanup test.

### Immersive WebXR

| Check                                                     | baseline   | spatialflex |
| --------------------------------------------------------- | ---------- | ----------- |
| Native WebXR (physical device)                            | NOT_TESTED | NOT_TESTED  |
| IWER emulator injected and detected as `emulated`         | PASS       | PASS        |
| Immersive session created (`immersive-vr`)                | PASS       | PASS        |
| Controller input: ray hover on the 3D +1 (IWER `look_at`) | PASS       | PASS        |
| XR panel action: `select` runs `increment()` exactly once | PASS       | PASS        |
| State sync during the session (web change → panel)        | PASS       | PASS        |
| Exit session, state kept, desktop 3D works again          | PASS       | PASS        |

Emulator results come from IWER's documented remote API (`look_at`, `select`),
which drives the real WebXR input source → XR ray → pointer event path. They
passed in Chromium and Firefox. They are not physical-device results.

### Measurements

The same workload, browser and configuration for both modes:

- 2 panels shown and 20 real 3D clicks
- idle frame times over 3 s
- 3 repetitions per mode and browser

Values are ranges across repetitions. Headless browsers render with software
GL, so absolute numbers do not represent real hardware. Firefox reduces timer
precision.

| Metric                                                             | Chromium baseline | Chromium spatialflex | Firefox baseline | Firefox spatialflex |
| ------------------------------------------------------------------ | ----------------- | -------------------- | ---------------- | ------------------- |
| Duplicate actions                                                  | 0                 | 0                    | 0                | 0                   |
| Pointer → web DOM update, median (ms)                              | 1.6–1.8           | 1.8–2.0              | 5                | 4–6                 |
| Pointer → 3D panel redraw, median (ms)                             | 2.5–2.7           | 2.5–2.7              | 6–7              | 5–7                 |
| Idle frame time, median (ms)                                       | 19.8–19.9         | 19.8–20.1            | 17               | 17                  |
| JavaScript loaded (decoded bytes)                                  | 1,327,426         | 1,335,213 (+7.8 kB)  | same             | same                |
| JS heap after workload (MB, Chromium only)                         | 10.1–13.6         | 12.1–12.8            | n/a              | n/a                 |
| Integration adapter code (formatted, non-blank, non-comment lines) | 50                | 52                   |                  |                     |

No difference between the modes stands out from run-to-run variation. These
numbers do not show that either mode is faster.

## Supported and unsupported

**Supported:**

- Desktop 3D preview with mouse orbit, hover, select, close and repositioning.
- Mirroring three registered items.
- App-owned state in both directions with exactly-once actions.
- Emulated immersive VR through IWER with controller ray interaction.

**Not supported or not verified:**

- Physical headsets. Not tested, and HTTPS is not configured.
- Hand input and gaze. They are not exercised.
- Panel dragging in 3D. Panels move with web buttons only.
- Converting arbitrary React components or DOM into XR.
- A cross-host bridge (#7).
- Safari/WebKit.
- Offline XR sessions: controller layout profiles come from a CDN.

## Troubleshooting

- **"immersive VR unavailable (desktop 3D only)":** expected without a headset
  or emulator. Use `?xr-emulator=iwer`, or open the app on `localhost` with the
  default `auto` mode.
- **"The VR session request was rejected…":** the browser refused the session.
  Desktop 3D still works.
- **The Immersive Web Emulator browser extension (IWE 1.x)** prevents the
  bundled devui from activating. Disable it.
- **E2E timeouts when running in parallel:** keep `workers: 1`. Software WebGL
  pages starve each other.
- **A second `three` in the bundle** (warning "Multiple instances of Three.js")
  means the overrides in `pnpm-workspace.yaml` were lost. Run `pnpm why three`.
- **Firefox "WebGL creation failed" on Linux CI:** headless Firefox has no
  WebGL without a GPU. Run it headed under Xvfb, as `.github/workflows/ci.yml`
  does.
