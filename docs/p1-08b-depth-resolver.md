# P1-08B Depth Resolver — work in progress

This is an internal, renderer-independent extraction of the P1-08A2 planar rectangle experiment. It is not yet ready for Workspace integration or package export.

The research resolver lets a back-facing rectangle occlude, although ray ownership excludes back faces. It also hides both coplanar rectangles while the ray selects the first one. The SDK version filters back-facing targets and occluders and sorts by key, using the lower key for exactly coplanar planes. The research reproductions remain in `depthResolver.research.test.ts` as expected failures; matching assertions against the SDK are in `depthResolver.test.ts`.

The algorithm still uses sequential convex subtraction, so overlapping occluders do not toggle an area visible. World coordinates and surface CSS coordinates follow `coordinates.ts`. Keys must be unique and nonempty. Geometry must have finite positive dimensions, scale and meters per pixel and a unit quaternion within 1e-9; invalid geometry and zero or nonfinite rays throw. Front faces only participate. InputRouter must still consume the closest hit even if that participant is not interactive.

This is incomplete: Ray and region calculations now share a pairwise coplanarity test: normals must agree within 16 machine epsilons and the normal offset within 8 machine epsilons times the largest of one metre, the world position components and the two surface extents. This is an experimental roundoff envelope, not a proof of coplanarity; real separations below it can be treated as ties, particularly at large world coordinates. The comparison is pairwise and can be non-transitive for three near-coplanar planes. A near-parallel true crossing within the angular envelope can also be mistaken for a tie. Projected points within 64 machine epsilons times the relevant CSS dimension of a rectangle edge are snapped to that edge. Projection can fail for planes crossing the eye or near parallel to target and throws in some such cases. The inherited 1e-6 CSS-pixel-squared area cutoff was removed, but near-degenerate numerical noise remains unquantified. Boundaries, partial occluders near the eye, crossing surfaces, keep polygons, extremely large numbers, and 3+ surface ray/visibility equivalence require independent tests. The target must currently be the same object as its entry in the plane array. The clipping helper returns a CSS path for compatibility with the research API, although geometry itself has no renderer dependency.

The coordinator must supply one immutable snapshot of geometry, unique stable keys and eye for both visibility and input, and must not assume public package exports exist. Do not integrate until the numerical policy and independent coverage are complete. A first run of the opt-in benchmark was heavily contended by simultaneous builds and tests and timed out; its timings should not be used for performance conclusions. Run it with `$env:DEPTH_BENCH="1"; pnpm exec vitest run packages/core/src/workspace/depthResolver.bench.test.ts` in an idle environment.

## Exploratory timing (not a performance claim)

Windows, Intel Core i5-9400F, Node 24.12.0; 5 warmups and 20 timed full-scene calculations. Each scene computes visibility for every plane. Geometry and the command are in `depthResolver.bench.test.ts`; results include validation and clipping, but not DOM updates. Other verification processes were still running, so these are contention-sensitive and P95 from 20 samples is especially noisy.

| Scene    | Surfaces | Median ms | P95 ms | Pieces | Vertices |
| -------- | -------: | --------: | -----: | -----: | -------: |
| separate |        1 |     0.018 |  0.040 |      1 |        4 |
| separate |        2 |     0.169 | 12.001 |      2 |        8 |
| separate |        5 |     0.781 |  8.187 |      5 |       20 |
| separate |       10 |     3.090 |  6.973 |     10 |       40 |
| separate |       20 |     8.475 | 23.085 |     20 |       80 |
| overlap  |        1 |     0.002 |  0.003 |      1 |        4 |
| overlap  |        2 |     0.226 |  0.705 |      2 |        8 |
| overlap  |        5 |     1.649 | 10.469 |      5 |       20 |
| overlap  |       10 |     6.011 | 19.494 |     11 |       44 |
| overlap  |       20 |    19.009 | 41.255 |     22 |       88 |
| cross    |        1 |     0.005 |  0.016 |      1 |        4 |
| cross    |        2 |     0.174 |  7.554 |      6 |       24 |
| cross    |        5 |     1.653 | 31.270 |     63 |      258 |
| cross    |       10 |     2.601 |  5.779 |    167 |      674 |
| cross    |       20 |    12.455 | 57.578 |    343 |     1378 |

Run with `--disableConsoleIntercept` to see passing-test output. No optimization is claimed. Broad-phase rejection and state caching are candidates for subsequent measurement after correctness is established.
