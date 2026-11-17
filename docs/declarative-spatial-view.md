# P1-04: Declarative spatial views (experimental)

Register once. Declare the spatial view. Let the user compose.

The experimental `SpatialItem xr` prop binds an explicit spatial representation
and its allowed parent-owned actions to an actual mounted SpatialItem. The XR Lab's
SpatialFlex adapter discovers these registrations generically. It no longer imports
`XR_VIEWS`, widget IDs, a domain store, or a per-widget action map. This is an opt-in
**XR mirror**, not automatic conversion or transfer of React/HTML into 3D.

Related: [Issue #17](https://github.com/ppsssj/SpatialFlex/issues/17). PR #16 was
confirmed merged into `main` at `98f2e8f` before starting this milestone.

## Copyable consumer example

This complete React example works with the workspace packages. `Discovery`
illustrates the data-only discovery and guarded dispatch used by an XR adapter;
it uses ordinary DOM for inspection, not a new renderer. The lab provides the
actual Three.js/Babylon.js Hosts and optional iframe transport.

```tsx
import { useState } from "react";
import {
  SpatialItem,
  SpatialWorkspace,
  useSpatialRegistry,
  useSpatialViews,
} from "@spatialflex/react";

function Counter() {
  const [count, setCount] = useState(0);
  const [step, setStep] = useState(1);
  const increment = () => setCount((n) => n + step);
  return (
    <SpatialItem
      id="counter"
      label="Counter"
      detachable
      xr={{
        body: { kind: "value", label: "Count", value: String(count) },
        actions: [{ id: "increment", label: "Add", invoke: increment }],
      }}
    >
      <button onClick={increment}>{count}</button>
      <button onClick={() => setStep(5)}>Use step 5</button>
    </SpatialItem>
  );
}

function Discovery() {
  const views = useSpatialViews();
  const registry = useSpatialRegistry();
  return views.map((view) => (
    <section key={view.registrationId}>
      <pre>{JSON.stringify(view, null, 2)}</pre>
      {view.actions.map((action) => (
        <button
          key={action.id}
          onClick={() =>
            registry.invokeView(view.id, view.registrationId, action.id)
          }
        >
          {action.label}
        </button>
      ))}
    </section>
  ));
}

export default function App() {
  return (
    <SpatialWorkspace>
      <Counter />
      <Discovery />
    </SpatialWorkspace>
  );
}
```

Application-owned state works identically: read an application hook/store and put
its current display values and permitted callback in `xr`. The counter, chart,
image and thermostat fixtures demonstrate this. Local `useState` stays in the
original Counter component in the example; the registry holds only its current
projection and a reference to the latest explicitly declared callback.

For the runnable lab: `pnpm dev:xr-lab`, open
`http://localhost:5173/?integration=spatialflex&engine=three&bridge=iframe`.
Enable **Mount thermostat widget (P1-04)** and select **Show in XR**. Both engine
choices and `bridge=off` work. The fourth widget starts unmounted so the original
three-widget workload, tests and bundle measurements remain comparable.

## API decision and alternatives

| Option                                                | Benefits                                                                                                                | Costs / decision                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A: `SpatialItem xr` prop (chosen)                     | One registration owner and one declaration; state/callbacks use ordinary React composition; existing props remain valid | For child-local state, return the SpatialItem from the component owning that state, as above                                             |
| B: child `useSpatialView` declaration hook (deferred) | Could bind a child inside an already-existing external SpatialItem wrapper                                              | Adds item context, child/parent effect ordering, arbitration between multiple child declarations and another ownership/cleanup mechanism |
| Both declaration mechanisms                           | More composition choices                                                                                                | Conflicting authorities and extra lifecycle rules without evidence they are needed for this milestone                                    |

The smallest selected API handles local and application state, dynamic mount,
SSR/hydration and StrictMode. It does not introspect a child component's private
state. A component that cannot be changed must expose its state/actions to its
caller to use the prop; a child declaration hook remains a potential follow-up.
`useSpatialViews` is a **discovery** hook, not a second declaration mechanism.

## TypeScript and ownership contract

Types are exported from Core and re-exported by React. They are experimental,
workspace-scoped and have no dependency on React DOM, Three.js or Babylon.js.

```ts
type SpatialViewBody =
  | { readonly kind: "value"; readonly label: string; readonly value: string }
  | {
      readonly kind: "bars";
      readonly label: string;
      readonly values: readonly number[];
    }
  | {
      readonly kind: "swatch";
      readonly color: string;
      readonly caption: string;
    };

interface SpatialViewBinding {
  readonly title?: string;
  readonly body: SpatialViewBody;
  readonly actions?: readonly {
    readonly id: string;
    readonly label: string;
    readonly invoke: () => void;
  }[];
}

interface SpatialViewRecord {
  readonly id: string;
  readonly registrationId: string;
  readonly title: string;
  readonly body: SpatialViewBody;
  readonly actions: readonly { readonly id: string; readonly label: string }[];
}
```

| Layer                                                  | Responsibility                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Original application                                   | Authoritative local/store state, callbacks, business validation                                                                |
| SpatialItem registration                               | Logical ID, actual mount lifecycle and ownership token                                                                         |
| Registry `views()` / `getView()` / `useSpatialViews()` | Immutable data snapshots; no executable handlers and no renderer transforms                                                    |
| Registry private handler map                           | Latest allowed callbacks, separated from serializable records                                                                  |
| `invokeView(id, registrationId, actionId)`             | Checks live item, exact view ownership and declared action before synchronous callback invocation; returns false when rejected |
| Renderer / adapter presentation                        | Placement, selection, visibility and transforms; no domain-state ownership                                                     |
| Existing Live Bridge                                   | Session/source/lease checks, revisioned state, request ledger and reconnect                                                    |

The default view title is `xr.title ?? label ?? id`. Actions default to empty.
Runtime normalization accepts only the supported body fields and action metadata,
copies/freeze-protects data and retains functions privately. Strings/IDs are
limited to 256 characters, bar values to 64 finite numbers, actions to 8 unique
IDs, and swatches to `#rrggbb`, matching protocol v1's vocabulary. The bridge's
32-panel limit remains. Arbitrary extra object fields are not serialized.

## Registration and cleanup

1. SpatialItem continues to register its P0 item in the commit effect. Its handle
   is tied to the registry's existing ownership token. `setView` can only affect
   that handle's current item registration.
2. The prop is synchronized in a layout effect; initial registration publishes
   the latest binding. SSR executes neither effect and does not register anything.
   Discovery returns an empty server/hydration snapshot, then current views after
   commit, including with an injected registry.
3. A view has an opaque `registrationId`. Data/handler updates retain this ID.
   Handler-only changes replace private callbacks without replacing an unchanged
   data snapshot or notifying view subscribers. This avoids stale closures and
   render loops when a component supplies a new inline function each render.
4. Removing `xr` revokes the view and callbacks while keeping the P0 item alive.
   Reenabling it allocates a new view ID. Component unmount removes both the item
   and view; remounting the same logical ID also creates a new view ID.
5. Old registration handles cannot update/unregister a new registration. Old
   view IDs and old same-context adapter callbacks cannot invoke new handlers.
   Duplicate item IDs retain the original `DUPLICATE_ITEM_ID` rejection.
6. View subscriptions are independent of layout subscriptions and have explicit
   unsubscribe functions. StrictMode cleanup/setup leaves one active view and
   balanced subscriptions. Data updates and P0 detach/attach keep the original
   React child position/mount, local state and focus.

```mermaid
sequenceDiagram
  participant Component as Original React component
  participant Registry as Workspace Registry
  participant Adapter as Generic adapter
  participant Host as Three/Babylon Host
  Component->>Registry: registration.setView(data + private callbacks)
  Registry->>Adapter: immutable view snapshot, registrationId
  Adapter->>Host: HostPanel data + renderer placement
  Host->>Adapter: semantic button ID
  Adapter->>Registry: invokeView(itemId, captured registrationId, actionId)
  Registry->>Component: latest allowed callback
  Component->>Registry: updated data projection after React state change
  Component->>Registry: unmount / unregister
  Registry->>Adapter: view removed; handlers revoked
  Note over Adapter,Registry: Old registrationId cannot call a later same-ID component
```

## Cross-context safety and compatibility

| Renderer   | Same-context                | Same-origin iframe          |
| ---------- | --------------------------- | --------------------------- |
| Three.js   | Supported, real pointer E2E | Supported, real pointer E2E |
| Babylon.js | Supported, real pointer E2E | Supported, real pointer E2E |

The existing HostPanel body/buttons contract is reused. The adapter maps data
only, without fixture IDs or state/action switches. `registrationId` and callbacks
remain in the parent. Neither functions nor Core registry records are sent over
postMessage. **Protocol v1 schemas and transport are unchanged.**

A demonstrated lifecycle incompatibility is handled using existing revisions:
an old, delayed request with the same logical item/action IDs could otherwise
arrive after a new registration reused them. Parent-only `actionOwners` metadata
lets the bridge associate a registration with the first snapshot revision that
publishes it. A different/new registration after initial synchronization requires
that newer observed revision. Ownership changes force a state publication even
if serialized panel content is identical. Removed owners are deleted, so this
metadata is bounded by current declarations, not a retained incarnation history.

The iframe binds action callbacks to the revision of the committed Host view,
rather than a newer network snapshot that may not yet be rendered. Requests from
an earlier registration's revision are denied before invoking any
callback. Already processed IDs may replay their cached result without invoking
again. Current item/button availability, exact origin/source, app/view/connection
identity, leases, state freshness and the existing bounded session-wide idempotency
ledger still apply. No permissions or action allowlists are broadened. Baseline
performs equivalent incarnation accounting manually using fixture mount epochs.
See [P1-03 protocol/security](live-bridge.md) for its unchanged limits.

## Before/after developer work

Previously SpatialFlex consumers had to declare an item, then add a separate
entry for every ID in `XR_VIEWS`, including body(state), position, button metadata
and a button-to-domain-action function. Eligibility and dispatch went through
`hasXRView(id)` and `XR_VIEWS[id]` inside the SpatialFlex adapter.

The previous pattern required two separate places (excerpt):

```tsx
// Component registration:
<SpatialItem id="counter">
  <CounterWidget />
</SpatialItem>;

// Separate application-specific adapter table:
const XR_VIEWS = {
  counter: {
    label: "Counter",
    position: [0, 1.4, -1.2],
    body: (state: { count: number }) => ({
      kind: "value",
      label: "Count",
      value: String(state.count),
    }),
    buttons: [{ id: "increment", label: "Add" }],
    actions: {
      increment: (actions: { increment(): void }) => actions.increment(),
    },
  },
};
```

Now state and permitted actions are colocated at the component, as in the example.
A single generic discovery/dispatch adapter serves all registered declarations.
The application fixture uses an SDK-free structural `WidgetView` and renderer
callback so both integration modes render the exact same React components. In
SpatialFlex mode that callback directly returns `<SpatialItem xr={view}>`.
This harness indirection is not required in a normal SDK consumer.

Baseline continues to use its manual `ALL_ITEMS`, `XR_VIEWS`, explicit mount
filtering and action dispatch. It ignores the component's declarative binding.
The table remains in `common/scenario.ts` for baseline only; SpatialFlex's import
graph no longer reaches that module or the manual `usePanels` mapper.

### Fourth-widget extensibility proof

`fixtures/ThermostatWidget.tsx` declares its value body and `heat` action beside
the original component, reading the same application-owned temperature/step as
the web controls. Its mount checkbox makes it dynamically available; changing
the heat step changes the permitted handler without changing the body or button
labels. Both rendering modes, contexts and browsers run the same workload.

The SpatialFlex adapter SHA-256 immediately before adding this widget was
`5648733395A713965A31CEFE7EC0976E32A377279FCF0281C02AF4C86146794F`.
It is unchanged afterward. An additional unit test declares a component whose
ID does not appear anywhere in the application fixture and exercises registration,
local state/actions and stale-callback rejection without changing the adapter.

| Work for one additional widget                                                | Declarative SpatialFlex  | Manual baseline                                                             |
| ----------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Shared application component/store/mount UI                                   | Required                 | Same required work                                                          |
| View/state projection beside component                                        | One explicit declaration | Same fixture declaration is present, but baseline ignores it                |
| Additional integration files                                                  | 0                        | 2: `scenario.ts`, `baseline/index.ts`                                       |
| Total widget-addition source files (shared component/store/mount UI included) | 3                        | 5; also adds a manual ID entry in the already-edited Dashboard file         |
| Additional adapter lines                                                      | 0                        | Manual entry plus eligibility/epoch/guard wiring (counted in evidence JSON) |
| Additional manual body/action table entries                                   | 0 / 0                    | 1 / 1                                                                       |
| Per-widget SDK cleanup branches                                               | 0                        | Explicit mounted filter, fixture epoch and stale-handler guard              |

This reduces application-specific duplication in SpatialFlex's consumer path.
It does not reduce all framework source code: the SDK now implements the shared
lifecycle machinery, and baseline deliberately retains duplicate declarations
for comparison. Counted lines are defined in the evidence, not used as a proxy
for design quality.

### Bundle and regression evidence

Raw before/after JavaScript resource bytes, source provenance, adapter hash and
manual wiring counts are recorded in [DX evidence](evidence/p1-04-dx.json).
The before measurements were preserved from P1-03's completed local evaluation
artifacts before P1-04 browser tests overwrote them; `d58f97e` and merged `98f2e8f`
have identical trees. After measurements use the unchanged evaluation test's
three-widget workload, both browsers and engines, test-hooks production builds,
and the optional fourth widget initially unmounted.

The measured results below are identical in Chromium and Firefox (bytes):

| Engine / mode         | P1-03 before | P1-04 after | Change |
| --------------------- | -----------: | ----------: | -----: |
| Three / baseline      |    1,331,664 |   1,334,268 | +2,604 |
| Three / SpatialFlex   |    1,339,451 |   1,343,216 | +3,765 |
| Babylon / baseline    |    2,012,404 |   2,015,008 | +2,604 |
| Babylon / SpatialFlex |    2,020,191 |   2,023,956 | +3,765 |

The mode differential grows from 7,787 to 8,948 bytes. The measured baseline
integration increment is 11 nonblank view-entry lines plus 10 widget-specific
adapter lines in two files, with an additional central ID entry and explicit
fixture epoch bookkeeping. SpatialFlex adds no adapter lines/files or manual
state/action table entries; its co-located declaration replaces that extra work.

These are decoded JavaScript resource bytes (`decodedBodySize`), not gzip transfer
size, runtime speed or isolated SDK size. They include application/fixture changes.
No performance improvement is claimed. After the full E2E suite, reproduce the
current observation with `node apps/xr-lab/scripts/update-dx-evidence.mjs`.
The script verifies eight result artifacts and the unchanged adapter hash.
See [validation report](declarative-spatial-view-verification.md) for commands,
new security/lifecycle cases and the separately recorded local/CI outcomes.

## Milestone boundaries and limitations

- **P0 Detach:** same-host CSS presentation of the original React component;
  keeps its original mount, state, focus and functionality.
- **P1 XR Mirror:** an independent 3D representation of the logical component;
  explicit value/bars/swatch content and semantic actions.
- **P1-03 Cross-Context Mirror:** serialized data/action communication in a
  separate iframe realm, with the original application as authority.
- **P1-04 Declarative View:** declares that representation beside the component
  and ties it to actual registration ownership/lifecycle.
- **Future Generalized Detach to XR:** broader presentation reuse subject to
  renderer/runtime capabilities, without assuming automatic DOM conversion.

Unsupported: arbitrary HTML/React/DOM extraction or serialization, functions over
the wire, automatic private-child-state inspection, text-input/form mirroring,
arbitrary image URLs, cross-origin authorization, cloud persistence, async action
transactions, durable exactly-once execution after app crashes, npm publication
and new engine implementations. Iframe immersive WebXR and physical headsets
remain unvalidated; existing IWER tests cover same-context emulation only.

Recommended next milestone: validate a child-scoped declaration hook only against
real integration cases where component-local state cannot own a SpatialItem wrapper,
then define capability negotiation for richer typed input/value semantics. Keep
native headset/iframe permission validation separate from the declarative API's
desktop compatibility evidence. Stabilize the public API before publication.
