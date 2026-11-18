# Interactive detachment strategies (P1-05)

The XR Lab now offers one control surface for moving an existing mounted React widget or showing its explicitly declared live XR representation. Counter, Live Chart and Image share the existing dashboard, application store, registrations and semantic actions. There is no second dashboard app or cloned React root.

## Supported strategies

| Mode                   | Source policy | Destination | Result                                                                                      |
| ---------------------- | ------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `move`                 | `placeholder` | `web`       | Original mounted DOM floats; the measured source footprint stays reserved.                  |
| `move`                 | `collapse`    | `web`       | The same DOM floats; its source slot stops generating a layout box and siblings reflow.     |
| `mirror`               | `visible`     | `xr`        | Original stays attached and visible; its declared representation is rendered independently. |
| `snapshot`             | any           | any         | Unsupported, with an explicit reason.                                                       |
| all other combinations |               |             | Unsupported, with an explicit reason.                                                       |

In particular, moving the original DOM to XR or to an independent iframe realm is unsupported. A Move request is never silently treated as a Mirror request. The control panel permits selecting every dimension, reports unsupported combinations inline and disables their action.

## API and architecture

Core exports renderer-independent strategy types, defaults, `validateDetachmentStrategy(unknown)` and `assertDetachmentStrategy(unknown)`. The validator returns a supported strategy or a reason; the assertion throws `SpatialFlexError` with code `UNSUPPORTED_STRATEGY`. Unknown or non-string dimensions are rejected. Validation does not invoke user-provided string coercion or modify options.

```tsx
import { useSpatialController } from "@spatialflex/react";
import { validateDetachmentStrategy } from "@spatialflex/core";

const controller = useSpatialController();
controller.detach("cpu-chart"); // Backward-compatible Move / Placeholder / Web.
controller.detach("cpu-chart", {
  mode: "move",
  source: "collapse",
  target: "web",
});
controller.attach("cpu-chart");

const result = validateDetachmentStrategy({
  mode: "move",
  source: "visible",
  target: "xr",
});
// { supported: false, reason: "Original React DOM ..." }
```

The DOM controller accepts only supported Move strategies. XR behavior belongs to the existing adapter and renderer-neutral Host contract. The XR Lab adapter accepts:

```ts
lab.show("shared-counter", {
  mode: "mirror",
  source: "visible",
  target: "xr",
});
lab.hide("shared-counter");
```

`lab.show(id)` remains compatible with the original XR Lab API and means a live XR mirror. The neutral shell receives a structural capability request and a validator supplied by the SpatialFlex adapter. It imports no SDK, and the baseline integration remains SDK-free. `SpatialItem xr` still declares only serializable value/bars/swatch data and parent-realm callbacks. XR Hosts and protocol v1 are unchanged by P1-05.

### Source semantics and original mount preservation

The P0 implementation already keeps each panel in its original DOM and React tree, changing only its CSS positioning to `fixed`. P1-05 retains that approach. Placeholder uses the source slot's measured width and height. Collapse uses `display: contents` on the neutral slot `div`, so the slot has no box and the fixed child contributes no source footprint. This does not hide the panel, move nodes, create a portal, clone children or remount React. Attach removes the temporary styles, restoring normal source order and natural size. Switching a detached panel between Placeholder and Collapse keeps its initial measured footprint.

Source policy and measured placeholder size belong to the DOM Host. Core's existing immutable layout records and attached SSR markup remain compatible. Resizing changes the floating panel size, not the reserved footprint. Browser resizing uses the existing viewport clamping and pointer handlers. Dynamic unmount performs the normal Host disconnect, registration revocation and React cleanup.

### State ownership and identity

The existing parent `LabStore` owns shared count/history/image variant and domain actions. Counter's local React click count and input are separate evidence that Move preserves private component and browser state. Those private fields are not automatically mirrored. XR receives only the explicitly declared shared count, chart bars or image swatch/caption, and action IDs. It never receives DOM, functions or React instances.

| Identity         | Owner and lifetime                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `itemId`         | Application's reusable logical widget ID.                                                                |
| `registrationId` | Registry's current declaration incarnation; changes after same-ID remount or declaration disable/enable. |
| `presentationId` | Adapter's `presentation-N` instance; renewed for each Hide → Show cycle.                                 |
| Bridge `viewId`  | Existing iframe Host view/session identity; independent of any panel instance.                           |

XR presentation membership follows `registrationId`, not the reusable logical item ID. The adapter prunes vanished registrations and their instance metadata. Each shown panel's parent-only action-owner token combines registration and presentation identities. Hide revokes the instance immediately; a later Show creates a new instance. Old same-context callbacks cannot dispatch after Hide → Show, and held iframe requests from the old instance fail the existing publication-revision authorization gate. Registration checks still reject same-ID remount actions.

The existing origin/source/session/connection, schema, current-view, freshness, allowed-action and idempotency checks remain in place. No new protocol fields or cross-realm executable values are added. Reconnection uses the same resynchronization path.

The demo coordinator keeps one active independent presentation per item: showing a mirror first attaches any moved source; moving first removes its mirror. Consumers composing their own DOM controller and XR adapter should coordinate those operations similarly. Direct raw `registry.detach()` remains a lower-level layout API without DOM measurements or source-policy handling.

## Local demonstration

From the feature checkout:

```bash
pnpm install --frozen-lockfile
pnpm --filter @spatialflex/xr-lab dev --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173/?integration=spatialflex&engine=three&bridge=iframe&xr-emulator=off**. For Babylon, change `engine=three` to `engine=babylon`. For the same-context Host, change `bridge=iframe` to `bridge=off`. All four choices use the same original components and store.

1. Choose **Shared counter** under Interactive detachment. Click **Local clicks** and enter a note in the original widget. Observe its React effect mounts, active instances and application subscription count in Domain diagnostics.
2. Choose **Move original React component**, **Placeholder — reserve space**, **Web — same document**, then **Detach**. Drag the floating panel's title into the right workspace. Its original gap remains. Click its real **+1** button and resize from its blue lower-right handle.
3. Click the panel's **Attach** button. The same local clicks, note and shared count remain. Choose **Collapse — reflow page** and **Detach**. Live Chart and Image move into the released source area. Attach restores source ordering.
4. Choose **Live XR mirror**. The source and destination controls default to **Visible** and **XR**. Click **Show**. The original stays attached; a separate 3D card shows its declared shared count. Click the card's real **+1** in the canvas. The original count and chart update once. **Attach / Hide** removes the mirror.
5. Repeat with **Live Chart** and **Image**. Chart is a live bars representation; Image is an explicit swatch/caption representation with a **Next** semantic action. These are not arbitrary HTML snapshots. Unmount Image while it is detached, then remount it: it registers fresh and starts attached.
6. Choose **Move** with destination **XR**, or **Snapshot**. Read the unsupported reason; no independent presentation is created.

React development StrictMode intentionally runs mount effects twice initially, so **Counter React effect mounts** may start at 2. The meaningful Move evidence is an unchanged value and exactly one active instance, alongside stable DOM identity and subscription counts.

## Automated evidence and validation

The deterministic browser capture is part of the regression test, not a separate UI implementation:

```bash
pnpm --filter @spatialflex/xr-lab exec playwright test e2e/strategies.spec.ts
```

It runs Chromium and Firefox with one worker and a fresh instrumented production build. The same test executes the complete Select → Move → Interact → Attach → Collapse → Mirror → Interact → Hide flow through real controls and canvas raycasting, for both engines and contexts. It also tests source geometry, same DOM identity, focus, private local state, pointer drag/resize, viewport shrink, effect mounts, subscription counts, exact action counts, strategy switching, held stale Hide → Show requests, unsupported choices and detached Image unmount/remount.

Each successful full-flow case attaches source/presentation geometry, strategy names, domain action counts, local state, mount/instance/subscription counts and final status to the Playwright report. Ordinary regression runs leave tracked evidence unchanged. To regenerate checked-in evidence on PowerShell, opt in explicitly:

```powershell
$env:SPATIALFLEX_CAPTURE_EVIDENCE = "1"
pnpm --filter @spatialflex/xr-lab exec playwright test e2e/strategies.spec.ts
Remove-Item Env:SPATIALFLEX_CAPTURE_EVIDENCE
```

This writes `docs/evidence/p1-05-{engine}-{bridge}-{browser}.json`. The representative Three/iframe/Chromium case also captures `p1-05-attached.png`, `p1-05-placeholder.png`, `p1-05-collapse.png` and `p1-05-mirror.png`. Review regenerated artifacts before committing them.

Core tests enumerate all 18 dimension combinations and malformed runtime values. React tests exercise changing source policy while detached without changing state, focus, Context or effects. Adapter integration tests verify switching keeps one presentation and stale callbacks cannot invoke the replacement instance. All existing assertions remain intact. The layout fix is included through a normal Git merge and its regression suite runs with this branch.

Validation status and observed geometry will be recorded after the browser run; pending checks are not claimed as passing.

## Limitations and roadmap

Move retains P0's CSS ancestry restrictions: transformed, filtered, perspective/containment or clipping ancestors can change the fixed containing block or visibility. Supported layouts avoid those ancestor properties. Drag/resize currently uses the existing mouse pointer interaction and one lower-right resize handle. Keyboard users can choose strategies and activate buttons/selects; keyboard panel movement/resizing is deferred.

The demo allows one active independent presentation per logical item. Multi-mirror ownership, independent per-view placement and per-instance action contracts remain future work. Persistence and cross-origin authorization are not implemented. Physical headsets and iframe immersive WebXR are not validated by desktop mouse evidence.

Snapshot is explicitly unsupported. A future snapshot could freeze validated serializable renderer-supported data with no actions; arbitrary HTML screenshot capture would require a separate scoped design and capability review. Richer typed spatial inputs and multi-view lifetimes should be designed before extending that matrix.
