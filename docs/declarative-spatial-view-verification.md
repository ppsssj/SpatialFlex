# P1-04 verification

Local environment: Windows, Node 22.16.0, pnpm 12.21.0, Playwright 1.65.1,
Chromium and Firefox. Date: 2026-11-18 (Asia/Seoul). Base: merged `main` at
`98f2e8f`; PR #16 was confirmed merged. Branch: `feat/p1-04-declarative-xr-view`.

Change/risk: a new experimental declaration API adds view data and private callback
lifecycle to actual SpatialItem registrations. Renderer adapters must reject old
registrations after a logical ID is reused while preserving P0 and protocol v1.

| Gate                       | Local status | Command / evidence                                                                                                |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Dependencies               | PASS         | `pnpm install --frozen-lockfile`; lockfile unchanged                                                              |
| Lint                       | PASS         | `pnpm lint`; React hooks and existing dependency boundaries preserved                                             |
| Formatting                 | PASS         | `pnpm format:check`                                                                                               |
| Typecheck                  | PASS         | `pnpm typecheck`; all packages/apps and new E2E code                                                              |
| Build                      | PASS         | `pnpm build`; public declaration files and both Vite entrypoints                                                  |
| Unit/integration           | PASS         | `pnpm test`; 205 tests: Core 72, React 67, playground 14, XR Lab 52                                               |
| Full browser regression    | PASS         | `pnpm test:e2e`; 206 passed: playground 38 + XR Lab 168, Chromium/Firefox; existing 190 retained                  |
| Focused new-widget browser | PASS         | `pnpm --filter @spatialflex/xr-lab exec playwright test e2e/declarative.spec.ts`; 16 cases passed, both browsers  |
| DX measurement             | PASS         | `node apps/xr-lab/scripts/update-dx-evidence.mjs`; eight evaluation artifacts and unchanged adapter hash verified |
| Diff / compatibility       | PASS         | No existing test/assertion changes; protocol schemas/transport version and renderer implementations unchanged     |
| Accessibility              | PASS         | Source review: existing semantic controls, native mount/step controls; no full accessibility audit claimed        |

Remote CI is recorded separately on the PR with its exact final head SHA and run
URL. Local results are not used as a substitute for remote check/E2E outcomes.

## Added evidence (existing 182 unit/integration and 190 E2E cases retained)

| Contract                                   | Automated protection                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration/data discovery                | Core view snapshots, React discovery, generic adapter with a component ID never named in the fixture                                                                                                  |
| Application state projection               | Original shared counter/chart/image tests now exercise colocated declarations; thermostat web/3D updates                                                                                              |
| Local React state                          | React Counter declares its view and updates local count through Registry dispatch                                                                                                                     |
| Parent-owned action / exact count          | Functions absent from serializable records and wire messages; web/3D thermostat action counters; existing retry/idempotency tests                                                                     |
| Latest handler without stale closure       | Same record/data with replaced callback; React step change with unchanged body; thermostat step=5 in every engine/context/browser                                                                     |
| Revocation and same-ID remount             | Old Core handles cannot mutate new registrations; removed/re-enabled declarations rotate view ownership; old same-context adapter closure cannot invoke new callbacks                                 |
| Cross-context stale requests               | Parent-only revision floor follows the current registration; an actual 3D-click thermostat request held at the parent and replayed is rejected after remount; fresh real pointer action executes once |
| Unknown actions and duplicate registration | Core allowlist/duplicate tests, React duplicate error boundary; prior bridge authorization tests unchanged                                                                                            |
| StrictMode / subscriptions                 | One active declaration, balanced view subscriptions, prior workspace listener and application-store subscription tests                                                                                |
| SSR / hydration                            | Empty server/hydration discovery snapshot, injected registry unchanged on SSR, no recoverable hydration errors                                                                                        |
| P0 original mount and focus                | Local-state Counter with xr survives detach/attach; input identity/focus and exact mount/unmount counts; all original P0 tests retained                                                               |
| Both Hosts and contexts                    | Fourth widget exercises Three/Babylon × baseline/SpatialFlex × same-context/iframe × Chromium/Firefox (16 cases)                                                                                      |
| Disconnect / reconnect                     | Thermostat state changes in original app while disconnected and resyncs; original lease/freshness/idempotency tests retained                                                                          |
| Runtime validation                         | Invalid bodies, sparse/nonfinite bars, invalid/duplicate callbacks, unsupported content; failed updates preserve previous snapshots                                                                   |
| SDK-free baseline                          | Browser script requests verify SpatialFlex chunk absent in baseline; shared fixture imports no SDK                                                                                                    |

## DX / bundle method

[Raw evidence](evidence/p1-04-dx.json) preserves P1-03's completed local evaluation
artifacts before new browser runs. The source tree of that run's `d58f97e` is
identical to merged `98f2e8f` (`git diff d58f97e origin/main --stat` was empty at
task start). After data comes from all eight unchanged evaluation artifacts of
the final full suite. Measurements use decoded script resource bytes, not gzip,
latency or an isolated SDK benchmark. Application fixture code is included.

The new widget starts unmounted for the existing workload. Extra application
component/store/mount-control work is common to both integrations; additional
integration edits are counted separately. The adapter hash was captured before
the fourth widget was added and is verified unchanged by the measurement script.
No performance or total-source-size improvement is claimed.

## Final local observations

The final full XR Lab run passed 168 cases in 9.4 minutes; playground passed 38.
All 23 new unit/integration cases and 16 new E2E cases are additive. An earlier
partial full run was intentionally stopped when rendered-view revision binding
replaced its build; the outcomes above are from the final source. Existing test
assertions and time limits were not weakened.

The fourth widget required zero SpatialFlex adapter edits (verified source hash).
Baseline adds an 11-line manual view entry and 10 widget-specific adapter lines
across two integration files, plus a central ID entry and explicit fixture epoch
bookkeeping. Shared component/store/mount UI work is excluded from those adapter
counts and remains necessary in both modes.

Compared with the recorded P1-03 run, decoded script bytes increased by 2,604
for baseline and 3,765 for SpatialFlex in each engine; Chromium/Firefox agreed.
The selected-mode difference is now 8,948 bytes (previously 7,787). These figures
include fixture changes and are not isolated SDK size or performance claims.

## Limits

The declaration API is experimental. It requires explicit value/bars/swatch data
and parent callbacks; it does not read arbitrary DOM, hidden child state or React
internals. Same-origin desktop coverage does not validate iframe immersive WebXR
or physical headsets. Existing protocol bounds and the 1024-request, non-durable
session ledger remain. No cross-origin authorization, persistence, async action
transactions or npm publication are added. See [API decision and lifecycle](declarative-spatial-view.md).
