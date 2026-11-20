# ADR 0001 — Multi-Surface runtime ownership

- **Status:** Accepted for P1-08B (P1-08A, issue #40)
- **Date:** 2026-11-20
- **Context documents:** [`docs/p1-08a-multi-surface-architecture.md`](../p1-08a-multi-surface-architecture.md) §4–§5

## Context

SpatialFlex presents components of one page today. A `<SpatialWorkspace>`
(`@spatialflex/react`) owns one `SpatialRegistry` and one DOM controller, and
`useSpatialPresentations` creates one `PresentationRuntime` over them. P1-08
must place several independent web Surfaces in one shared scene.

Audited facts that constrain the choice:

| #   | Fact (source)                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SpatialRegistry.register` throws `DUPLICATE_ITEM_ID` for an id already in the registry (`core/src/registry.ts`).                                                                       |
| 2   | `registrationOf(id)` is `${registryOrdinal}/${generation}` from module-level counters: unique across registries of one JavaScript realm, never reused for a remount (`registry.ts`).    |
| 3   | `PresentationRuntime` keys entries by item id (`#entries: Map<itemId, Entry>`) and generates instance ids per runtime (`native-1`, `adaptive-1`, …) (`dom/src/presentationRuntime.ts`). |
| 4   | Its controller (`extractNative`, `attach`, `nativeElement`, …) acts on the DOM of one React subtree (`react/src/controller.ts`).                                                        |
| 5   | Each runtime owns one `NativeCompositor` (inline `transform`/`clip-path` of its own elements) and one `ItemManipulator` (poses, sessions, selection).                                   |
| 6   | `HostFrameOptions` already accepts caller-supplied `occluders` and a `surface` per frame call.                                                                                          |

## Options

### A — One runtime per Surface, plus a Workspace coordinator (hybrid)

Each Surface keeps today's stack unchanged: registry, controller,
`PresentationRuntime`, its compositor and manipulator. A new coordinator above
the Surfaces owns only scene-level state:

- Surface identity and lifecycle (`SurfaceTable`).
- Host frame authority (`FrameAuthority`).
- Input ownership and focus (`InputRouter`).
- Layer depth ordering, and cross-surface occluders fed into each runtime's
  `frame(…, { occluders })`.

### B — One runtime per Workspace

A shared registry and runtime hold the items of every Surface.

## Criteria

1. **Identity:** two Surfaces may register the same item id; stale actions
   must not cross Surfaces.
2. **Ownership:** each source subtree's DOM and state stay with its owner,
   and removing a Surface touches nothing else.
3. **Change size:** compatibility with the shipped single-surface API and
   behavior.
4. **Failure isolation:** one Surface's error or teardown is contained.
5. **Feasibility of scene-level concerns:** selection, input, ordering and
   occlusion.

## Evaluation

| criterion         | A (per-Surface runtime + coordinator)                                                                                                                                                                                                                      | B (per-Workspace runtime)                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Identity          | Free: separate registries accept equal ids (fact 1). Registration keys are already distinct (fact 2). Tested: A1.                                                                                                                                          | Needs composite ids in the registry, controller, runtime and React bindings, which breaks `itemId` everywhere. |
| Ownership         | One controller per subtree, as now (fact 4); removal disconnects one runtime. Tested: A3.                                                                                                                                                                  | One runtime needs a controller per Surface inside it: a second ownership layer in the runtime.                 |
| Compatibility     | Zero change to the runtime for one Surface; the coordinator is additive. Tested: A9.                                                                                                                                                                       | Rewrites `#entries`, instance ids, `presentationOf(itemId)` and `invoke`.                                      |
| Failure isolation | Per runtime.                                                                                                                                                                                                                                               | Shared: one Surface's transaction batches with all.                                                            |
| Scene-level       | Selection, manipulation focus, input and ordering need a coordinator, implemented as tested primitives (A5–A7). One manipulator per Surface means "selected" is per runtime, so the coordinator's focus owner decides which runtime's selection is active. | Shared manipulator and selection come for free.                                                                |
| Instance ids      | Collide across runtimes (`adaptive-1` twice; shown in A3), so the workspace addresses presentations structurally (surface + item + registration + instance).                                                                                               | Unique by construction.                                                                                        |

## Decision

**Option A, per-Surface runtime with a Workspace coordinator.**

- **Rationale:** it keeps every existing invariant (registration-scoped
  presentations, view epochs, one compositor per DOM owner) and moves only
  scene-level policy into the new layer.
- **What B would cost:** B's advantages (shared selection, one presentation
  list) are cheap to rebuild in a coordinator. B's costs (identity and
  ownership rewrites) are not.

Ownership statement:

- **A Surface's runtime** owns its presentations, poses, compositor writes
  and handles.
- **The coordinator** owns Surface incarnations, host authority, gesture
  capture and focus, layer order and cross-surface occluders.
- Neither owns the other's state.

## Consequences

- **Identity:** the scene-level name is the _Workspace_ (coordinator), and
  each Surface keeps a `<SpatialWorkspace>` provider as its source scope. The
  React component name is kept for compatibility; its documentation must say
  it scopes one Surface's items.
- **Presentation addressing:** instance ids are per Surface runtime;
  workspace messages use `ScopedPresentationRef`.
- **Selection:** at most one runtime's manipulator has an active session,
  enforced by the `InputRouter` capture: one gesture, one owner.
- **Risks:**
  - Per-Surface compositors each write their own elements, so N
    compositors run per frame.
  - Cross-surface occluders are O(Surfaces × occluders) per frame. This was
    the P1-07C cost centre and is measured in P1-08B B6.

## Evidence

- `packages/core/src/workspace/workspace.test.ts`: A1, A2, A5, A6, A7.
- `packages/dom/src/workspace.test.ts`: A3 and A9, over real
  `PresentationRuntime` and `SpatialRegistry` instances.
- `apps/xr-lab/e2e/multi-surface-spike.spec.ts`: S7 (removing one Surface
  leaves the other valid in a real browser).
