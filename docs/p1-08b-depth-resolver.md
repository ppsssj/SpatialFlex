# P1-08B Depth Resolver — work in progress

This is an internal, renderer-independent extraction of the P1-08A2 planar rectangle experiment. It is not yet ready for Workspace integration or package export.

The research resolver lets a back-facing rectangle occlude, although ray ownership excludes back faces. It also hides both coplanar rectangles while the ray selects the first one. The SDK version filters back-facing targets and occluders and sorts by key, using the lower key for exactly coplanar planes. The research reproductions remain in `depthResolver.research.test.ts` as expected failures; matching assertions against the SDK are in `depthResolver.test.ts`.

The algorithm still uses sequential convex subtraction, so overlapping occluders do not toggle an area visible. World coordinates and surface CSS coordinates follow `coordinates.ts`. Keys must be unique and nonempty. Geometry must have finite positive dimensions, scale and meters per pixel and a unit quaternion within 1e-9; invalid geometry and zero or nonfinite rays throw. Front faces only participate. InputRouter must still consume the closest hit even if that participant is not interactive.

This remains experimental. Plane normals are derived directly from the pose and normalized; a tie requires matching represented plane directions (zero cross product) and zero represented normal offset. This avoids intentionally merging near-parallel crossings but is not an exact-arithmetic predicate: cancellation, underflow and roundoff can make distinct planes appear coplanar or equivalent planes appear distinct. Large world coordinates, non-transitive ties, and uncertain predicate results are not yet handled robustly. No ambiguity error is currently guaranteed. Projection can fail for planes crossing the eye or near parallel to target and throws in some such cases. Near-degenerate numerical noise remains unquantified. A three-plane X-crossing grid now compares ray owners with regions away from the boundary; zero-length edges created by clipping are ignored in subtraction so they cannot restore the whole subject. More adversarial crossing, keep polygons, extremely large numbers and boundary cases require independent tests. The target must currently be the same object as its entry in the plane array. The clipping helper returns a CSS path for compatibility with the research API, although geometry itself has no renderer dependency.

The coordinator must supply one immutable snapshot of geometry, unique stable keys and eye for both visibility and input, and must not assume public package exports exist. Do not integrate until the numerical policy and independent coverage are complete. Previous benchmark runs were contended and preceded the latest correctness changes; their timings should not be used for performance conclusions. Run it with `$env:DEPTH_BENCH="1"; pnpm exec vitest run scripts/depthResolver.bench.test.ts` in an idle environment.

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

The previously expected-failure near-parallel ray test is now an ordinary passing test. At this scale IEEE-754 rounding limits the strength of the conclusion; exact/adaptive predicates and explicit indeterminate handling remain open.

## Experimental atomic snapshot

`resolveDepthSnapshot(planes, eye)` copies the input array, geometry, pose and eye before calculating. Subsequent changes to caller-owned data cannot alter the returned visibility or ray ownership. All visibility is computed and checked before any snapshot is returned. `IndeterminateDepthError` rejects nonfinite inputs and calculations, eye-to-plane distance within `128 * Number.EPSILON * scale`, non-transitive represented coplanarity, near-coplanar pairs within the preflight bound, unprojectable geometry, and output polygons with zero or nonfinite area. Scale is the maximum of 1 metre, absolute eye and center components, and the surface dimensions. Ray directions are normalized; nonfinite or zero directions, near-parallel rays and ambiguous near-equal intersections of non-coplanar planes throw the same error. On any such error, including a later ray query, the caller must discard the whole snapshot and avoid applying its clips or routing input from it. Duplicate keys remain `TypeError`; unexpected programming exceptions are not reclassified.

These checks do not establish exact geometry predicates or cover every floating-point degeneracy. A ray can still be affected by errors outside the checks; the lower-level functions do not have this snapshot error contract. Back-facing participants are excluded, exact represented coplanar ties use key order, and ordinary X crossings are supported away from boundaries. Curved or non-planar geometry, eye-plane crossing and numerically ambiguous cases are outside this experimental contract. `keep` footprints are not supported by the snapshot. Public package export and Runtime integration remain deferred; in particular preserve input blocking for a non-interactive frontmost Surface.

Independent checks now compare `intersectSurface` hits with ray ownership and visible polygons for sampled two-, three-, and five-plane crossing scenes, excluding points within 0.05 CSS px of hidden-region boundaries. They cover those fixtures, not the full space of floating-point inputs.
