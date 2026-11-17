# XR Lab

`apps/xr-lab` is a **vendor-neutral WebXR test environment**. It checks whether
SpatialFlex integrates with an ordinary standards-based XR application under
the same conditions as a conventional, hand-written integration.

It is **not** a showcase tuned for SpatialFlex. The application, input, test
data and tests are shared. Two things can be swapped independently:

| Dimension   | URL                                                            | Options                                                                                |
| ----------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| XR engine   | `?engine=three` (default) / `?engine=babylon`                  | Three.js (React Three Fiber + `@react-three/xr`) or Babylon.js                         |
| Integration | `?integration=baseline` (default) / `?integration=spatialflex` | Hand-written code without SpatialFlex, or SpatialFlex registration and its React hooks |

The second engine and the four-combination comparison are described in
[xr-host-compatibility.md](xr-host-compatibility.md).

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
            main.tsx ── ?engine=… ?integration=…  (dynamic import, one chunk each)
               │
   ┌───────────┴───────────┐                    ┌──────────────────────┐
   ▼                       ▼                    ▼                      ▼
hosts/three           hosts/babylon     integrations/baseline  integrations/spatialflex
 (R3F, three,          (Babylon.js)             │                      │ @spatialflex/react
  @react-three/xr)          │                   └──────────┬───────────┘
   │                        │                              ▼ IntegrationModule
   └──────────┬─────────────┘                    integrations/common (scenario,
              ▼                                   presentation state)
   contracts/xrHost.ts  ◄── HostPanel data + events ───────┘
   contracts/hostProbe.ts      hosts/shared (2D panel faces, toolbar)

   shell/ ── lays out fixtures/ (app state, actions, widgets) and the selected host
   devtools/emulator.ts ── installs IWER as the WebXR runtime (dev/test only)
```

ESLint (`no-restricted-imports` in `eslint.config.js`) enforces the dependency
direction:

- `contracts/` and `hosts/shared/` import no rendering engine, app, SDK or
  integration.
- Each `hosts/<engine>/` imports only the contract, the shared host code and
  its own engine: never the other engine, the app, an integration or
  SpatialFlex.
- `fixtures/` imports no XR library, no contract, no host and no integration.
- Integrations reach hosts only through the contract.
- Only `integrations/spatialflex/` imports `@spatialflex/*`.

Only the selected engine's chunk is downloaded, and in baseline mode the
SpatialFlex chunk is never downloaded. E2E tests check both.

### Neutral host contract (`src/contracts/xrHost.ts`)

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
<Host panels={…} {...events} />   // HostModule.Host, one per engine
```

Each host renders panels with its own engine: a textured plane, button meshes
and a close control, placed by the shared `panelLayout()`. It picks with its
own engine (R3F raycasting, Babylon `scene.onPointerObservable`) for both mouse
and XR controller rays, and reports interactions as events. Panel faces are
drawn by shared 2D canvas code with local system fonts, so both engines show
the same pixels and need no remote fonts or textures. Coordinates are meters.
CSS pixels are never interpreted as XR coordinates.

A read-only **host probe** (`contracts/hostProbe.ts`, `window.__xrHostProbe`)
reports where a panel part is on screen or in the world, frame callback
intervals, when each panel last drew, live panel textures and mounted hosts.
Every host fills it the same way and it never triggers interactions. It is
exposed only in development and in builds made with `VITE_XR_LAB_TEST_HOOKS=1`
(the E2E builds).

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

No headset is needed. Choose the engine and integration with `?engine=` and
`?integration=` (links in the header switch them).

### Desktop 3D

1. Click **Show in XR** for `shared-counter`. A panel appears in the 3D workspace.
2. Click the 3D **+1** with the mouse. The web counter and the domain action
   count each increase by one.
3. Click the web **+1**. The 3D panel shows the new value.
4. Drag empty space to orbit. **Reset view** restores the camera. Click a panel
   to select it, and use the move buttons to reposition it by 0.1 m.
5. Close the panel with its 3D **x** or **Remove from XR**. The app state is kept.

### IWER emulator (immersive VR without a headset)

The lab's dev tooling (`src/devtools/emulator.ts`) installs the IWER emulator
and its devui as the browser's WebXR runtime (`navigator.xr`) **before any
engine loads**. Hosts never configure emulation: to every engine the emulator
is simply a WebXR runtime. The emulator is installed only when all of these
hold:

1. It is requested with `?xr-emulator=iwer`.
2. The build allows it: development (`pnpm dev:xr-lab`) or a test build made
   with `VITE_XR_LAB_TEST_HOOKS=1`. A normal production build never installs
   it, whatever the URL says.
3. The browser has no immersive VR support of its own. If a headset or native
   runtime is present, the emulator is not installed and the status says so.

Steps: open `http://localhost:5173/?xr-emulator=iwer` (add `&engine=babylon`
for Babylon.js). The workspace shows "Emulator: IWER emulator installed…" and
"XR: immersive VR available". Show the counter, then click **Enter VR**. The
devui shows the emulated headset view and controller inspectors. Aim the right
controller at **+1** and pull the trigger. The web dashboard updates. Click
**Exit VR** to return; the app state is kept.

Enter VR is never permanently disabled, because support can appear later.
Rejected requests are shown as an error, and desktop 3D keeps working.

### Physical headset

Not tested in this milestone. WebXR on a headset requires HTTPS on the LAN
(for example `@vitejs/plugin-basic-ssl` and `vite --host`). That is not
configured.

## Library compatibility workarounds (dev tooling only)

These were needed to make the emulator work with the installed versions. They
live outside the hosts, and every engine and integration uses them alike.

1. **Single `three`.** `@iwer/devui` and `@iwer/sem` declare `three` as a regular
   dependency (`^0.184`). `pnpm-workspace.yaml` overrides it to the app's
   `~0.187.0`, so only one `three` is loaded. It also keeps the emulator
   packages that `@react-three/xr` 6.6 depends on at 2.8.0; P1-00 found that
   the 1.x devui it pins overrides controller poses.
2. **Forced runtime install.** IWER 2.8 does not install over an existing
   `navigator.xr`, and Chromium exposes one even without a headset. After
   checking that the native runtime reports no immersive VR, the dev tooling
   calls IWER's documented `installRuntime({ forceInstall: true })`.
3. **No library-injected emulation.** The Three.js host creates its
   `@react-three/xr` store with `emulate: false` and `offerSession: false` (the
   automatic session offer is re-requested after each session and the
   superseded promise is an unhandled rejection).
4. **No remote controller assets.** Three.js: controller and hand models off
   (`model: false`); controller _layout profiles_ are still fetched from
   `cdn.jsdelivr.net` during an XR session. Babylon.js: controller meshes and the
   online profile repository off; controllers use Babylon's built-in
   `generic-trigger` profile. Desktop 3D makes no remote requests, which the E2E
   tests check.

## Automated tests

```bash
pnpm --filter @spatialflex/xr-lab test        # Vitest contract tests (jsdom)
pnpm --filter @spatialflex/xr-lab test:e2e    # Playwright: Chromium + Firefox
```

E2E runs against the production build (`vite preview` on `127.0.0.1:4180`,
strict port, no server reuse), with one worker. Parallel pages starve each
other because headless browsers render WebGL in software. Every test fails on
console errors or warnings except a documented list of third-party messages
(`e2e/lab.ts`), which applies to every engine and integration alike.

**CI (Ubuntu, no GPU):** headless Firefox cannot create a WebGL context there,
even with `webgl.force-enabled`. In CI the Firefox project runs **headed under
Xvfb** (`xvfb-run`, `XR_LAB_FIREFOX_HEADED=1`); Chromium stays headless. Every
engine and integration uses the same setup.

### Results

The XR Lab's results now cover two XR engines × two integrations × two
browsers: 13 desktop scenarios, the emulated immersive scenario and the
measurements for each of the four combinations. They are reported in
[xr-host-compatibility.md](xr-host-compatibility.md#test-matrix).

The Vitest contract suite runs the same 12 tests against both adapters (plus
2 mode-specific checks). A mutation check (P1-00) confirmed that it tests each
mode's own wiring: removing the baseline's hand-written lifecycle filter fails
only the baseline's cleanup test.

All timings the lab records are proxies: CPU-side texture updates and
JavaScript frame callback intervals, not GPU presentation.

## Supported and unsupported

**Supported:**

- Two independent XR engines (Three.js, Babylon.js) behind one renderer-neutral host contract.
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
- Offline XR sessions with the Three.js host: controller layout profiles come from a CDN.

## Troubleshooting

- **"immersive VR unavailable (desktop 3D only)":** expected without a headset
  or emulator. In development, add `?xr-emulator=iwer`.
- **"Emulator: disabled in this build":** production builds never install the
  emulator. Use `pnpm dev:xr-lab`, or build with `VITE_XR_LAB_TEST_HOOKS=1`.
- **"The VR session request was rejected…":** the browser refused the session.
  Desktop 3D still works.
- **The Immersive Web Emulator browser extension (IWE 1.x)** prevents the
  bundled devui from activating. Disable it.
- **E2E timeouts when running in parallel:** keep `workers: 1`. Software WebGL
  pages starve each other.
- **A second `three` in the bundle** (warning "Multiple instances of Three.js")
  means the overrides in `pnpm-workspace.yaml` were lost. Run `pnpm why three`.
- **Babylon.js panels invisible or mirrored, or clicks ignored:** see the engine
  differences in [xr-host-compatibility.md](xr-host-compatibility.md#differences-between-the-two-engine-integrations).
- **Firefox "WebGL creation failed" on Linux CI:** headless Firefox has no
  WebGL without a GPU. Run it headed under Xvfb, as `.github/workflows/ci.yml`
  does.
