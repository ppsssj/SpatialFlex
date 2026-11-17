# P1-03 verification evidence

Environment: Windows, Node 22+, pnpm 12.21.0, Playwright 1.65.1; Chromium and
Firefox. Final validation: 2026-11-18 (Asia/Seoul). Base: `origin/main` at
`61b9e85`. Branch: `feat/p1-03-cross-host-bridge`.

Changed behavior/risk: the XR Lab optionally crosses an independent iframe
execution boundary. The domain store and actions remain exclusively in the
original app; the new boundary validates schemas, identity, availability,
idempotency and freshness. Existing Core/React APIs and renderer code are unchanged.

| Gate                 | Status  | Command / observation                    | Evidence                                                                                                                                                     |
| -------------------- | ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dependencies         | PASS    | `pnpm install --frozen-lockfile`         | Lockfile unchanged; all five workspace projects                                                                                                              |
| Lint                 | PASS    | `pnpm lint`                              | Includes new bridge dependency restrictions and React hooks rules                                                                                            |
| Formatting           | PASS    | `pnpm format:check`                      | Repository Prettier checks                                                                                                                                   |
| Typecheck            | PASS    | `pnpm typecheck`                         | All four packages/apps; includes new E2E code                                                                                                                |
| Build                | PASS    | `pnpm build`                             | Core, React, playground and XR Lab; separate `index.html` / `host.html` entries                                                                              |
| Unit/integration     | PASS    | `pnpm test`                              | 182 tests: Core 57, React 61, playground 14, XR Lab 50                                                                                                       |
| Browser regression   | PASS    | `pnpm test:e2e`                          | 190 passed: playground 38 + XR Lab 152; includes 32 new bridge cases across Chromium and Firefox                                                             |
| Accessibility        | PASS    | Manual source inspection + browser roles | iframe has descriptive title, connection status is visible, iframe status is a live region, controls are native buttons; no full accessibility audit claimed |
| Security/reliability | PASS    | Contract tests + bridge E2E              | See matrix below                                                                                                                                             |
| Diff hygiene         | PASS    | `git diff --cached --check`              | No modified existing test assertions, dependency changes or generated bundles                                                                                |
| Remote CI            | NOT RUN | `.github/workflows/ci.yml`               | Existing PR workflow runs all seven requested commands; published PR checks provide remote results                                                           |

This report records local validation before PR publication. Remote CI results
are recorded on the published PR checks, independently of these local results.

## Contract and browser evidence

`src/bridge/protocol.test.ts` covers all message shapes, structured-clone
compatibility, unknown fields/types, incorrect versions, malformed identities,
nonfinite coordinates, sparse arrays, invalid panel bodies, unique IDs, exact
origin/source, bounded idempotency, conflicting retries, unknown/unavailable items,
unknown actions, exceptions after a possible mutation and revision ordering.

`e2e/bridge.spec.ts` runs 16 cases in each browser (32 total), including real mouse
raycasts on Three.js and Babylon.js canvases. Receiver-side fault injection is
installed before the application entrypoints and exists only inside tests.
It duplicates requests, drops results/state/disconnects/pongs and reverses held
state messages without adding production backdoors.

| Property                                | Evidence                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent realm and no store transfer | Different Array intrinsics in parent/iframe; iframe resource list excludes app, fixture and integration chunks; ESLint enforces imports         |
| Initial handshake and snapshot          | Valid capability connects; invalid version, session, view, origin, source and capability fail; initial counter is rendered from wire data       |
| Bidirectional live actions              | Real web +1, then real 3D +1, yield count=2 and exactly two domain calls in both engines and integrations                                       |
| Retry safety                            | Duplicate ActionRequests and dropped ActionResults cause repeated same-ID delivery, with only one domain invocation                             |
| Revision safety                         | Reversed state delivery converges to newest content; unit contracts explicitly retain identity for duplicate/older revisions                    |
| Authorization                           | Foreign session/view/connection, undeclared actions, hidden/unknown/unregistered items and extra schema fields cannot invoke domain actions     |
| Widget lifecycle                        | Widget unmount produces protocol unregister and removes its 3D representation; SpatialFlex derives lifecycle from actual mounted Registry items |
| Parent/view lease                       | Missing pongs expire parent authority; lost disconnect expires the view; missing state expires freshness even if ping still arrives             |
| Reconnect/reload                        | Full resync shows latest web state; old connection requests cannot mutate; processed IDs replay across iframe reload without reexecution        |
| Cleanup                                 | Three workspace unmount/remount cycles restore parent listener and app subscription counts; each new iframe has one active engine               |
| Baseline isolation                      | Both engines run baseline with no SpatialFlex chunk downloaded; same iframe entrypoint and protocol are used for both integrations              |
| Existing behavior                       | Full suite includes Same-Host playground, same-context Three/Babylon desktop, evaluation and IWER immersive tests                               |

## Earlier attempts and scope limits

An earlier full local E2E attempt hit the unchanged 30-second limit in the
same-context Three.js/SpatialFlex repeated open/close test while mechanical checks
were also running. The trace showed a timeout during its repetition loop, rather
than a bridge assertion. That run was stopped after further bridge hardening
invalidated its build. The final run executes gates sequentially, with existing
test limits and assertions preserved. Earlier compilation/lint issues were fixed
before the final validation. The final serial run passed all 190 browser tests;
XR Lab completed in 8.5 minutes.

This evidence covers desktop cross-context rendering in both browsers and both
engines. IWER tests cover the existing **same-context** immersive path only.
Immersive iframe WebXR, native headsets, cross-origin security, async transactional
actions and persistence across original-app crashes remain unverified/unsupported.
The 1024-entry in-memory ledger fails closed at capacity; it does not promise
durable exactly-once delivery. See [protocol and limitations](live-bridge.md).
